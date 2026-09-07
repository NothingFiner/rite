//! Manuscript chunking for RAG retrieval (Phase 4.1).
//!
//! The analytical assistant's "Whole document" Feedback Target currently sends
//! the entire manuscript verbatim as one context message — expensive in tokens
//! and unfocused. Phase 4 replaces that with retrieval: chunk the manuscript,
//! embed each chunk, and at send time inject only the chunks most relevant to
//! the question. This module is the head of that chain.
//!
//! `chunk_document` is pure: it walks the document model and groups paragraphs
//! into roughly target-sized chunks. It does no I/O and holds no `State` — the
//! `retrieve_passages` Tauri command that consumes these chunks lands later
//! (4.4). The `Chunk` shape is the contract 4.2 (embedding) / 4.3 (vector
//! store) / 4.4 (retrieval + injection) build on, so it is defined here and
//! `Serialize`-derived so 4.4 can return chunks to the frontend unchanged.

use crate::document::{Document, Paragraph, Section, SectionType};
use serde::Serialize;

/// Rough target size for a chunk, in words. Chunks accumulate paragraphs until
/// adding the next would exceed this; a single paragraph longer than this
/// becomes its own over-target chunk (we never split mid-paragraph). 256 is a
/// balance: small enough to keep each embedded passage focused on one beat,
/// large enough that short paragraphs coalesce instead of fragmenting into
/// near-empty chunks. Tunable.
const TARGET_CHUNK_WORDS: u32 = 256;

/// A contiguous slice of one section's prose, ready to embed.
///
/// `id` is `"{section_id}:{ordinal}"`, where `ordinal` is the 0-based position
/// of this chunk among the chunks produced from its section. It is stable
/// within a single `chunk_document` call (4.3 keys the in-memory vector store
/// by `id` + a content hash).
///
/// `section_id` + `chapter_index` carry the chunk's structural context so
/// retrieval (4.4) can label a passage ("from Chapter 3") without re-walking
/// the document. `chapter_index` is `Option<u32>`: `Some(n)` is the 1-based
/// number of the nearest preceding `Chapter` (inclusive — a chunk inside a
/// Chapter carries that Chapter's number); `None` means the chunk comes from
/// front matter before any Chapter (an epigram section, etc.). Using `Option`
/// rather than a `0` sentinel keeps "no chapter yet" distinct from a
/// hypothetical "Chapter 0" — the Rust idiom.
///
/// A chunk never spans two sections: the buffer is flushed at every section
/// boundary, so `section_id` and `chapter_index` are unambiguous for the whole
/// chunk.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    pub id: String,
    pub section_id: String,
    pub chapter_index: Option<u32>,
    pub text: String,
}

/// Concatenate a paragraph's text runs into a plain string — no HTML, no
/// styling. This is the same one-liner `diff.rs::paragraph_text` and every
/// export module inline; it isn't worth cross-module coupling to share, so it
/// is re-implemented here. A paragraph's text is the concatenation of its
/// elements' `text_run.content` fields.
fn paragraph_text(paragraph: &Paragraph) -> String {
    paragraph
        .elements
        .iter()
        .map(|element| element.text_run.content.as_str())
        .collect()
}

/// Whitespace-delimited word count of a string. `str::split_whitespace` treats
/// any run of whitespace as a single separator and ignores leading/trailing
/// whitespace, which is what we want for a chunk-size estimate.
fn count_words(text: &str) -> u32 {
    text.split_whitespace().count() as u32
}

/// Split a document into embedding-sized chunks.
///
/// Walks `doc.sections` in order, carrying a running `chapter_index` that
/// advances only on `SectionType::Chapter` (matching the render-derived
/// chapter numbering used in `export_text` / `export_docx`: the first Chapter
/// is 1, and a `Section` between two Chapters does not advance the counter).
/// Within each section, paragraphs are greedily merged into a buffer until
/// adding the next would push the chunk over `TARGET_CHUNK_WORDS`, at which
/// point the buffer is flushed as a `Chunk` and the next paragraph starts a
/// fresh buffer. Empty paragraphs are skipped (they add embedding noise). The
/// buffer is also flushed at every section boundary, so a chunk never crosses
/// a section — keeping each chunk's `section_id` / `chapter_index` clean.
pub fn chunk_document(doc: &Document) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    // None until the first Chapter is seen; Some(n) thereafter, advancing only
    // on Chapter sections.
    let mut chapter_index: Option<u32> = None;

    for section in &doc.sections {
        // Advance the chapter counter for a Chapter (1-based, position among
        // Chapter-type sections only). Sections of type `Section` inherit the
        // nearest preceding Chapter's index (or None if none has appeared).
        if section.section_type == SectionType::Chapter {
            chapter_index = Some(chapter_index.unwrap_or(0) + 1);
        }

        let mut buffer = String::new();
        let mut buffer_words: u32 = 0;
        let mut ordinal: u32 = 0;

        for paragraph in &section.paragraphs {
            let text = paragraph_text(paragraph);
            // Skip blank paragraphs — they carry no semantic content for
            // embedding and would only dilute a chunk. Scene-break `***` / `#`
            // paragraphs are non-empty, so they survive.
            if text.trim().is_empty() {
                continue;
            }
            let words = count_words(&text);

            // Flush the in-progress chunk before adding this paragraph if doing
            // so would exceed the target. We flush BEFORE appending (not after)
            // so the new paragraph starts the next chunk rather than tipping
            // the current one over. `buffer_words > 0` guards the case of a
            // single paragraph larger than the target: with an empty buffer we
            // don't flush, so that paragraph becomes its own over-target chunk
            // rather than producing an empty leading chunk.
            if buffer_words > 0 && buffer_words + words > TARGET_CHUNK_WORDS {
                chunks.push(Chunk {
                    id: format!("{}:{}", section.id, ordinal),
                    section_id: section.id.clone(),
                    chapter_index,
                    text: std::mem::take(&mut buffer),
                });
                buffer_words = 0;
                ordinal += 1;
            }

            // Join paragraphs within a chunk with a newline. The first
            // paragraph in a buffer (after a flush or at section start) has an
            // empty buffer, so it gets no leading separator.
            if !buffer.is_empty() {
                buffer.push('\n');
            }
            buffer.push_str(&text);
            buffer_words += words;
        }

        // Flush whatever remains at the section boundary so the next section's
        // chunks carry the next section's id / chapter index (a chunk never
        // spans sections).
        if buffer_words > 0 {
            chunks.push(Chunk {
                id: format!("{}:{}", section.id, ordinal),
                section_id: section.id.clone(),
                chapter_index,
                text: buffer,
            });
        }
    }

    chunks
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Element, TextRun, TextStyle};

    // --- test fixtures (mirror diff.rs:240-274) -----------------------------

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
    // typing 256 words by hand for the merge/split tests.
    fn paragraph_with_words(id: &str, count: u32) -> Paragraph {
        let text: String = (1..=count)
            .map(|n| format!("w{n}"))
            .collect::<Vec<_>>()
            .join(" ");
        create_paragraph(id, &text)
    }

    // --- tests --------------------------------------------------------------

    #[test]
    fn empty_document_yields_no_chunks() {
        assert!(chunk_document(&create_document(vec![])).is_empty());
    }

    #[test]
    fn section_with_only_empty_paragraphs_yields_no_chunks() {
        let doc = create_document(vec![create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![create_paragraph("p1", ""), create_paragraph("p2", "   ")],
        )]);
        assert!(chunk_document(&doc).is_empty());
    }

    #[test]
    fn single_short_paragraph_becomes_one_chunk() {
        let doc = create_document(vec![create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![create_paragraph("p1", "The door opened.")],
        )]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].id, "s1:0");
        assert_eq!(chunks[0].section_id, "s1");
        assert_eq!(chunks[0].text, "The door opened.");
    }

    #[test]
    fn short_paragraphs_under_target_merge_into_one_chunk() {
        // 50 + 50 = 100 words, well under the 256 target → one chunk.
        let doc = create_document(vec![create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![
                paragraph_with_words("p1", 50),
                paragraph_with_words("p2", 50),
            ],
        )]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].id, "s1:0");
        // The two paragraphs are joined by a newline inside the chunk.
        assert_eq!(chunks[0].text.matches('\n').count(), 1);
    }

    #[test]
    fn paragraphs_split_when_adding_the_next_would_exceed_target() {
        // 200 + 200 = 400 > 256, and 200 alone < 256, so the second paragraph
        // tips the first over → two chunks (each 200 words, under target).
        let doc = create_document(vec![create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![
                paragraph_with_words("p1", 200),
                paragraph_with_words("p2", 200),
            ],
        )]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].id, "s1:0");
        assert_eq!(chunks[1].id, "s1:1");
        // Each chunk holds exactly one paragraph (no newline join).
        assert!(!chunks[0].text.contains('\n'));
        assert!(!chunks[1].text.contains('\n'));
    }

    #[test]
    fn a_single_over_target_paragraph_becomes_one_chunk() {
        // One 300-word paragraph (> 256). With an empty buffer the flush guard
        // (buffer_words > 0) is false, so it is NOT split and becomes a single
        // over-target chunk. We never split mid-paragraph.
        let doc = create_document(vec![create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![paragraph_with_words("p1", 300)],
        )]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].id, "s1:0");
        // 300 words → 300 whitespace-separated tokens.
        assert_eq!(count_words(&chunks[0].text), 300);
    }

    #[test]
    fn over_target_paragraph_then_short_one_makes_two_chunks() {
        // 300 (over target) then 10. The 300 becomes its own chunk; the 10
        // starts a fresh chunk (the flush before appending fires because
        // buffer_words=300 > 0 and 300+10 > 256).
        let doc = create_document(vec![create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![paragraph_with_words("p1", 300), paragraph_with_words("p2", 10)],
        )]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 2);
        assert_eq!(count_words(&chunks[0].text), 300);
        assert_eq!(count_words(&chunks[1].text), 10);
        assert_eq!(chunks[1].id, "s1:1");
    }

    #[test]
    fn chapter_index_advances_only_on_chapters_not_sections() {
        // Chapter 1, then a Section (sandwiched), then Chapter 2. The Section
        // does NOT advance the counter, so its chunks inherit Chapter 1's
        // index. Mirrors export_text's chapter_number_increments_across_chapters_only.
        let doc = create_document(vec![
            create_section("c1", "One", SectionType::Chapter, vec![create_paragraph("p1", "a b c")]),
            create_section("s1", "Notes", SectionType::Section, vec![create_paragraph("p2", "d e f")]),
            create_section("c2", "Two", SectionType::Chapter, vec![create_paragraph("p3", "g h i")]),
        ]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].chapter_index, Some(1)); // Chapter 1
        assert_eq!(chunks[1].chapter_index, Some(1)); // Section → nearest preceding
        assert_eq!(chunks[2].chapter_index, Some(2)); // Chapter 2
    }

    #[test]
    fn front_matter_before_any_chapter_has_no_chapter_index() {
        let doc = create_document(vec![
            create_section("front", "Epigraph", SectionType::Section, vec![create_paragraph("p1", "a b")]),
            create_section("c1", "One", SectionType::Chapter, vec![create_paragraph("p2", "c d")]),
        ]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks[0].chapter_index, None); // before any Chapter
        assert_eq!(chunks[1].chapter_index, Some(1));
    }

    #[test]
    fn empty_paragraphs_between_content_are_skipped() {
        // A blank paragraph between two short ones does not break the merge and
        // does not itself produce a chunk.
        let doc = create_document(vec![create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![
                paragraph_with_words("p1", 10),
                create_paragraph("p2", "   "),
                paragraph_with_words("p3", 10),
            ],
        )]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 1); // p1 + p3 merged; p2 skipped
        // The chunk holds p1 and p3 (one newline join); the blank is absent.
        assert_eq!(chunks[0].text.matches('\n').count(), 1);
    }

    #[test]
    fn chunks_never_span_sections() {
        // Two one-paragraph sections → two chunks with distinct section_ids,
        // even though each is tiny (no cross-section merging).
        let doc = create_document(vec![
            create_section("a", "A", SectionType::Section, vec![create_paragraph("p1", "one")]),
            create_section("b", "B", SectionType::Section, vec![create_paragraph("p2", "two")]),
        ]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].section_id, "a");
        assert_eq!(chunks[1].section_id, "b");
        assert_eq!(chunks[0].text, "one");
        assert_eq!(chunks[1].text, "two");
    }

    #[test]
    fn chunk_ids_are_section_scoped_ordinals() {
        // Three short paragraphs that exceed the target in total split into
        // multiple chunks; ids are s1:0, s1:1, … within the section.
        let doc = create_document(vec![create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![
                paragraph_with_words("p1", 200),
                paragraph_with_words("p2", 200),
                paragraph_with_words("p3", 200),
            ],
        )]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].id, "s1:0");
        assert_eq!(chunks[1].id, "s1:1");
        assert_eq!(chunks[2].id, "s1:2");
    }
}