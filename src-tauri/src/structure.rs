//! Structural-signal layer for the analytical assistant (Phase 4.6).
//!
//! The assistant's "Whole document" Feedback Target sends the entire manuscript
//! verbatim — token-heavy, and truncated against the context window on a long
//! novel. Phase 4.4 added cosine retrieval ("Relevant passages") for localized-
//! evidence questions. This module is the complementary *compact* context for
//! structural / pacing-shape questions: a per-chapter word / paragraph /
//! scene-break breakdown, recomputed on demand.
//!
//! It is a **standalone alternative context, not a supplement** to the full
//! dump. If the complete prose already fits the model's window, the model can
//! count words and scene breaks itself, so prepending this breakdown would add
//! ~nothing; the breakdown earns its keep when the prose is too big to send in
//! full (it is never truncated — every chapter's shape in a few hundred tokens)
//! or the question is shape-only ("are my chapters balanced", "where does the
//! middle sag"). The frontend exposes it as a new "Structure" Feedback Target.
//!
//! Like `retrieval::chunk_document`, the core is pure — it walks the document
//! model and counts, doing no I/O and holding no `State`. The
//! `#[tauri::command]` wrapper (`structural_signals`) snapshots the live
//! `state.document` and delegates to it, the same testable-layer split
//! `reembed_pass` / `retrieve_passages` use. No embeddings, no network — the
//! whole call is a lock + a walk, sub-millisecond for a novel-length document.

use crate::document::{Document, Paragraph, Section, SectionType};
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

/// One chapter's structural counts, grouped the way the manuscript RENDERS
/// chapters: a `Chapter`-type section plus any `Section`-type sections that
/// follow it until the next `Chapter` (those inherit the nearest preceding
/// chapter's index, exactly as `retrieval::chunk_document` and `export_text`
/// derive it). `chapter_index` is the 1-based positional number among
/// `Chapter`-type sections, so it matches the "Chapter N" the editor renders.
#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChapterSignals {
    pub chapter_index: u32,
    pub title: String,
    pub words: u32,
    pub paragraphs: u32,
    pub scene_breaks: u32,
    /// How many sections (the Chapter itself + its trailing `Section`-type
    /// sections) make up this chapter group.
    pub section_count: u32,
}

/// Structural counts for a group of sections with no chapter context — the
/// front matter (everything before the first `Chapter`). Same fields as a
/// chapter minus the index/title, since front matter has no derived number.
#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SectionGroupSignals {
    pub words: u32,
    pub paragraphs: u32,
    pub scene_breaks: u32,
    pub section_count: u32,
}

/// Document-wide totals, so the model gets the whole-picture scale in one line
/// without summing the per-chapter list itself.
#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TotalsSignals {
    pub chapters: u32,
    pub sections: u32,
    pub words: u32,
    pub paragraphs: u32,
    pub scene_breaks: u32,
}

/// The full structural breakdown returned to the frontend: the per-chapter
/// list, the front-matter aggregate, and the document totals. `Serialize` with
/// `camelCase` so the JS side reads `frontMatter` / `sceneBreaks` /
/// `chapterIndex` etc., matching `Chunk` and the other RAG response shapes.
#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct StructuralReport {
    pub chapters: Vec<ChapterSignals>,
    pub front_matter: SectionGroupSignals,
    pub totals: TotalsSignals,
}

/// Does this paragraph's text mark a scene break? Matches
/// `src/composables/useParagraphHTML.js::isSceneBreak` exactly: the trimmed
/// run-concatenated text is one of `#`, `*`, `***`, `###`. Keeping the Rust
/// detection in lock-step with the render's is what makes the scene-break COUNT
/// here match what the writer sees on the page (a `***` rendered as a centered
/// break is the same `***` counted here). A parity test pins the set on both
/// sides.
fn is_scene_break(text: &str) -> bool {
    matches!(text.trim(), "#" | "*" | "***" | "###")
}

/// Concatenate a paragraph's text runs into a plain string — no HTML, no
/// styling. This is the same one-liner `retrieval.rs::paragraph_text`,
/// `diff.rs::paragraph_text`, and every export module inline; per the
/// codebase's stated convention it isn't worth cross-module coupling to share,
/// so it is re-implemented here.
fn paragraph_text(paragraph: &Paragraph) -> String {
    paragraph
        .elements
        .iter()
        .map(|element| element.text_run.content.as_str())
        .collect()
}

/// Whitespace-delimited word count of a string. `str::split_whitespace` treats
/// any run of whitespace as one separator and ignores leading/trailing
/// whitespace — the same measure `retrieval::count_words` uses for chunk sizing.
fn count_words(text: &str) -> u32 {
    text.split_whitespace().count() as u32
}

/// A running tally for one group of sections (a chapter group, or the front
/// matter). Accumulating into one of these while walking keeps the grouping
/// logic in `compute_structural_signals` flat and readable.
#[derive(Default)]
struct GroupAccumulator {
    words: u32,
    paragraphs: u32,
    scene_breaks: u32,
    section_count: u32,
}

impl GroupAccumulator {
    /// Fold one section's paragraphs into this group's tally.
    ///
    /// Empty / whitespace-only paragraphs are skipped — they carry no content
    /// and no structure (mirrors `chunk_document`'s "blank paragraphs carry no
    /// content"). A scene-break paragraph (`#`/`*`/`***`/`###`) is non-empty, so
    /// it counts as a paragraph AND as a scene break, but it does NOT add to the
    /// word count — `***` is a marker, not prose, and counting it as a word
    /// would inflate the very lengths this layer exists to measure honestly.
    fn add_section(&mut self, section: &Section) {
        self.section_count += 1;
        for paragraph in &section.paragraphs {
            let text = paragraph_text(paragraph);
            if text.trim().is_empty() {
                continue;
            }
            self.paragraphs += 1;
            if is_scene_break(&text) {
                self.scene_breaks += 1;
                continue;
            }
            self.words += count_words(&text);
        }
    }
}

impl From<GroupAccumulator> for SectionGroupSignals {
    fn from(acc: GroupAccumulator) -> Self {
        SectionGroupSignals {
            words: acc.words,
            paragraphs: acc.paragraphs,
            scene_breaks: acc.scene_breaks,
            section_count: acc.section_count,
        }
    }
}

/// Build the `ChapterSignals` for one flushed chapter group.
fn chapter_signals(chapter_index: u32, title: String, acc: GroupAccumulator) -> ChapterSignals {
    ChapterSignals {
        chapter_index,
        title,
        words: acc.words,
        paragraphs: acc.paragraphs,
        scene_breaks: acc.scene_breaks,
        section_count: acc.section_count,
    }
}

/// Compute the structural breakdown of a document. Pure — no I/O, no state — so
/// it is the unit-testable core; the `structural_signals` command delegates to
/// it after snapshotting the live document.
///
/// Walks `doc.sections` in order, carrying a running `chapter_index` that
/// advances ONLY on `SectionType::Chapter` (the same render-derived numbering
/// rule `retrieval::chunk_document` and `export_text` use: the first Chapter is
/// 1, and a `Section` between two Chapters does not advance the counter). Each
/// Chapter opens a fresh group that absorbs itself plus every following
/// `Section`-type section until the next Chapter; leading `Section`-type
/// sections before the first Chapter aggregate into `front_matter`. After the
/// walk, totals sum every group.
pub fn compute_structural_signals(doc: &Document) -> StructuralReport {
    let mut chapters: Vec<ChapterSignals> = Vec::new();
    let mut front_matter = GroupAccumulator::default();
    // The in-progress chapter group: its 1-based index, title, and running
    // tally. `None` until the first Chapter is seen (so leading Sections land
    // in `front_matter`), and after a flush when a new Chapter starts one.
    let mut current: Option<(u32, String, GroupAccumulator)> = None;
    let mut chapter_index: u32 = 0;

    for section in &doc.sections {
        if section.section_type == SectionType::Chapter {
            // A new Chapter closes the in-progress chapter group (if any) before
            // the new one opens. Front matter is never "in progress" here — it
            // accrues directly while `current` is None.
            if let Some((idx, title, acc)) = current.take() {
                chapters.push(chapter_signals(idx, title, acc));
            }
            chapter_index += 1;
            let mut acc = GroupAccumulator::default();
            acc.add_section(section);
            current = Some((chapter_index, section.title.clone(), acc));
        } else {
            // A Section-type section belongs to the current chapter's group, or
            // to front matter if no Chapter has appeared yet.
            match current.as_mut() {
                Some((_, _, acc)) => acc.add_section(section),
                None => front_matter.add_section(section),
            }
        }
    }

    // Flush the last in-progress chapter group (the loop only flushes on the
    // NEXT Chapter, so the final one is left open).
    if let Some((idx, title, acc)) = current.take() {
        chapters.push(chapter_signals(idx, title, acc));
    }

    // Totals: chapters counted, then sum every group's fields across front
    // matter + all chapter groups. `sections` is every section in the document
    // (front-matter sections + each chapter group's sections, where the group
    // includes the Chapter itself + its trailing Sections).
    let mut totals = TotalsSignals {
        chapters: chapters.len() as u32,
        ..Default::default()
    };
    totals.sections += front_matter.section_count;
    totals.words += front_matter.words;
    totals.paragraphs += front_matter.paragraphs;
    totals.scene_breaks += front_matter.scene_breaks;
    for chapter in &chapters {
        totals.sections += chapter.section_count;
        totals.words += chapter.words;
        totals.paragraphs += chapter.paragraphs;
        totals.scene_breaks += chapter.scene_breaks;
    }

    StructuralReport {
        chapters,
        front_matter: front_matter.into(),
        totals,
    }
}

/// Compute the structural breakdown of the LIVE document and return it for the
/// frontend to inject as the "Structure" Feedback Target's context. Snapshots
/// `state.document` under a brief lock and computes outside any concern about
/// I/O (there is none — no embeddings, no network), then delegates to the pure
/// `compute_structural_signals`. `Result` surfaces lock-poison, matching the
/// other `State<'_, AppState>`-bearing commands. The JS side calls
/// `invoke('structural_signals')` with no arguments — `State` is auto-injected
/// by Tauri.
#[tauri::command]
pub fn structural_signals(state: State<'_, AppState>) -> Result<StructuralReport, String> {
    let doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    Ok(compute_structural_signals(&doc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Element, TextRun, TextStyle};

    // --- test fixtures (mirror retrieval.rs / document.rs) -----------------

    fn create_paragraph(id: &str, text: &str) -> Paragraph {
        Paragraph {
            id: id.to_string(),
            elements: vec![Element {
                text_run: TextRun {
                    content: text.to_string(),
                    text_style: TextStyle::default(),
                },
            }],
            left_indent: None,
            right_indent: None,
            first_line_indent: None,
        }
    }

    fn create_section(id: &str, title: &str, section_type: SectionType, paras: Vec<Paragraph>) -> Section {
        Section {
            id: id.to_string(),
            title: title.to_string(),
            section_type,
            hidden: false,
            paragraphs: paras,
        }
    }

    fn create_document(sections: Vec<Section>) -> Document {
        Document {
            title: "T".to_string(),
            author: "A".to_string(),
            author_contact: "C".to_string(),
            has_toc: false,
            has_epigram: false,
            epigram_text: String::new(),
            sections,
        }
    }

    // A paragraph holding `count` words of filler ("w1 w2 w3 …"). Cheaper than
    // typing exact counts by hand for the word-count assertions.
    fn paragraph_with_words(id: &str, count: u32) -> Paragraph {
        let text: String = (1..=count)
            .map(|n| format!("w{n}"))
            .collect::<Vec<_>>()
            .join(" ");
        create_paragraph(id, &text)
    }

    // --- is_scene_break parity with useParagraphHTML.js ---------------------

    #[test]
    fn is_scene_break_matches_the_javascript_set() {
        // The exact set the render treats as a scene break.
        for marker in ["#", "*", "***", "###"] {
            assert!(is_scene_break(marker), "{marker:?} should be a scene break");
            // Surrounding whitespace is trimmed, matching the JS `.trim()`.
            assert!(is_scene_break(&format!("  {}  ", marker)), "trimmed {marker:?} should be a scene break");
        }
        // Anything else is NOT a scene break — including near-misses that a
        // looser check would wrongly catch.
        for not_break in ["**", "##", "# scene", "****", "", "   ", "Chapter 3"] {
            assert!(!is_scene_break(not_break), "{not_break:?} should NOT be a scene break");
        }
    }

    // --- compute_structural_signals -----------------------------------------

    #[test]
    fn empty_document_yields_empty_report() {
        let report = compute_structural_signals(&create_document(vec![]));
        assert!(report.chapters.is_empty());
        assert_eq!(report.front_matter, SectionGroupSignals::default());
        assert_eq!(report.totals, TotalsSignals::default());
    }

    #[test]
    fn sections_before_any_chapter_aggregate_into_front_matter() {
        // Only Section-type sections, no Chapter → all front matter, no chapters.
        let doc = create_document(vec![
            create_section("s1", "Epigraph", SectionType::Section, vec![paragraph_with_words("p1", 12)]),
            create_section("s2", "Dedication", SectionType::Section, vec![paragraph_with_words("p2", 8)]),
        ]);
        let report = compute_structural_signals(&doc);
        assert!(report.chapters.is_empty());
        assert_eq!(report.front_matter.section_count, 2);
        assert_eq!(report.front_matter.words, 20);
        assert_eq!(report.front_matter.paragraphs, 2);
        assert_eq!(report.front_matter.scene_breaks, 0);
        // Totals reflect the front matter only.
        assert_eq!(report.totals.chapters, 0);
        assert_eq!(report.totals.sections, 2);
        assert_eq!(report.totals.words, 20);
    }

    #[test]
    fn single_chapter_counts_its_words_and_paragraphs() {
        let doc = create_document(vec![create_section(
            "c1",
            "The Door",
            SectionType::Chapter,
            vec![paragraph_with_words("p1", 50), paragraph_with_words("p2", 50)],
        )]);
        let report = compute_structural_signals(&doc);
        assert_eq!(report.chapters.len(), 1);
        let chapter = &report.chapters[0];
        assert_eq!(chapter.chapter_index, 1);
        assert_eq!(chapter.title, "The Door");
        assert_eq!(chapter.words, 100);
        assert_eq!(chapter.paragraphs, 2);
        assert_eq!(chapter.scene_breaks, 0);
        assert_eq!(chapter.section_count, 1);
        assert_eq!(report.front_matter, SectionGroupSignals::default());
        assert_eq!(report.totals.chapters, 1);
        assert_eq!(report.totals.words, 100);
    }

    #[test]
    fn trailing_sections_group_under_their_preceding_chapter() {
        // Chapter 1, then a Section (belongs to Chapter 1's group), then
        // Chapter 2. Chapter 1's group has section_count 2; Chapter 2's has 1.
        let doc = create_document(vec![
            create_section("c1", "One", SectionType::Chapter, vec![paragraph_with_words("p1", 10)]),
            create_section("s1", "Notes", SectionType::Section, vec![paragraph_with_words("p2", 20)]),
            create_section("c2", "Two", SectionType::Chapter, vec![paragraph_with_words("p3", 30)]),
        ]);
        let report = compute_structural_signals(&doc);
        assert_eq!(report.chapters.len(), 2);
        assert_eq!(report.chapters[0].chapter_index, 1);
        assert_eq!(report.chapters[0].section_count, 2);
        assert_eq!(report.chapters[0].words, 30); // 10 + 20
        assert_eq!(report.chapters[1].chapter_index, 2);
        assert_eq!(report.chapters[1].section_count, 1);
        assert_eq!(report.chapters[1].words, 30);
        assert_eq!(report.totals.sections, 3);
    }

    #[test]
    fn chapter_index_is_one_based_and_positional_among_chapters_only() {
        // A Section between two Chapters does NOT advance the counter, mirroring
        // chunk_document / export_text. Indexes are 1, 2 — not 1, 3.
        let doc = create_document(vec![
            create_section("c1", "One", SectionType::Chapter, vec![create_paragraph("p1", "a b")]),
            create_section("s1", "Inter", SectionType::Section, vec![create_paragraph("p2", "c d")]),
            create_section("c2", "Two", SectionType::Chapter, vec![create_paragraph("p3", "e f")]),
        ]);
        let report = compute_structural_signals(&doc);
        assert_eq!(report.chapters[0].chapter_index, 1);
        assert_eq!(report.chapters[1].chapter_index, 2);
    }

    #[test]
    fn scene_break_markers_each_count_as_a_paragraph_and_a_scene_break() {
        // One of each accepted marker. Each is 1 paragraph + 1 scene break, and
        // a real prose paragraph rounds out the count.
        let doc = create_document(vec![create_section(
            "c1",
            "Scenes",
            SectionType::Chapter,
            vec![
                create_paragraph("p1", "#"),
                create_paragraph("p2", "*"),
                create_paragraph("p3", "***"),
                create_paragraph("p4", "###"),
                paragraph_with_words("p5", 7),
            ],
        )]);
        let report = compute_structural_signals(&doc);
        let chapter = &report.chapters[0];
        assert_eq!(chapter.scene_breaks, 4);
        // All five non-empty paragraphs count (4 breaks + 1 prose).
        assert_eq!(chapter.paragraphs, 5);
    }

    #[test]
    fn a_scene_break_does_not_inflate_the_word_count() {
        // `***` is a marker, not prose — it counts as a paragraph + scene break
        // but adds zero words. The prose paragraph's 7 words are the only words.
        let doc = create_document(vec![create_section(
            "c1",
            "Break",
            SectionType::Chapter,
            vec![create_paragraph("p1", "***"), paragraph_with_words("p2", 7)],
        )]);
        let report = compute_structural_signals(&doc);
        let chapter = &report.chapters[0];
        assert_eq!(chapter.words, 7);
        assert_eq!(chapter.scene_breaks, 1);
        assert_eq!(chapter.paragraphs, 2);
    }

    #[test]
    fn empty_paragraphs_are_skipped_from_counts() {
        // Blank and whitespace-only paragraphs count toward neither words,
        // paragraphs, nor scene breaks (mirrors chunk_document's blank-skip).
        let doc = create_document(vec![create_section(
            "c1",
            "Gaps",
            SectionType::Chapter,
            vec![
                paragraph_with_words("p1", 5),
                create_paragraph("p2", ""),
                create_paragraph("p3", "   "),
                paragraph_with_words("p4", 5),
            ],
        )]);
        let report = compute_structural_signals(&doc);
        let chapter = &report.chapters[0];
        assert_eq!(chapter.paragraphs, 2); // only the two prose paragraphs
        assert_eq!(chapter.words, 10);
        assert_eq!(chapter.scene_breaks, 0);
    }

    #[test]
    fn front_matter_then_multi_chapter_totals_aggregate_everything() {
        // Front matter (1 section, 20 words) + Chapter 1 (1 section, 100 words,
        // 1 scene break) + a Section under Chapter 1 (1 section, 40 words) +
        // Chapter 2 (1 section, 60 words). Totals should sum all groups.
        let doc = create_document(vec![
            create_section("fm", "Epigraph", SectionType::Section, vec![paragraph_with_words("p0", 20)]),
            create_section("c1", "One", SectionType::Chapter, vec![
                paragraph_with_words("p1", 100),
                create_paragraph("p2", "***"),
            ]),
            create_section("s1", "Notes", SectionType::Section, vec![paragraph_with_words("p3", 40)]),
            create_section("c2", "Two", SectionType::Chapter, vec![paragraph_with_words("p4", 60)]),
        ]);
        let report = compute_structural_signals(&doc);
        assert_eq!(report.chapters.len(), 2);
        // Chapter 1 absorbed the trailing Section s1 → 2 sections, 140 words,
        // 1 scene break, 3 paragraphs (100-word prose + the break + 40-word).
        assert_eq!(report.chapters[0].section_count, 2);
        assert_eq!(report.chapters[0].words, 140);
        assert_eq!(report.chapters[0].scene_breaks, 1);
        assert_eq!(report.chapters[0].paragraphs, 3);
        assert_eq!(report.chapters[1].section_count, 1);
        assert_eq!(report.chapters[1].words, 60);
        // Totals across front matter + both chapters.
        assert_eq!(report.totals.chapters, 2);
        assert_eq!(report.totals.sections, 4); // fm + c1 + s1 + c2
        assert_eq!(report.totals.words, 220); // 20 + 140 + 60
        assert_eq!(report.totals.paragraphs, 5); // 1 + 3 + 1
        assert_eq!(report.totals.scene_breaks, 1);
    }

    // The command is a thin snapshot+delegate over the pure core, so the pure
    // tests above fully cover the logic; no live/I-O path exists to exercise.
}