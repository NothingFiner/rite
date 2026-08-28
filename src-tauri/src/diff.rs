//! Structural diff between two `Document`s, for the history "diff against
//! current" view.
//!
//! The diff is structural-by-id at both levels: a two-cursor walk over
//! `old.sections` / `current.sections` matched by `Section.id`, then a
//! matching walk over each modified section's `paragraphs` by `Paragraph.id`.
//! This mirrors the id-match walk `compute_doc_ops` uses, but emits diff blocks
//! (what changed) instead of ops (how to mutate). Inside a paragraph whose text
//! changed, the `similar` crate produces a word-level diff so the UI can
//! highlight added/removed words inline.
//!
//! Semantics: `compute_diff(old, current)` describes how to get from `old` to
//! `current` — `Added` = in `current` not `old`, `Removed` = in `old` not
//! `current`. For the history view the caller passes `old = past version` and
//! `current = live document`, so "Added" is new work since that version and
//! "Removed" is text since deleted.

use crate::document::{Document, Paragraph, Section, SectionType};
use serde::Serialize;
use similar::{ChangeTag, TextDiff};

/// One word-level change span. Adjacent same-tag words are coalesced so the
/// frontend renders a handful of spans, not one per word.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", content = "text", rename_all = "snake_case")]
pub enum WordDiff {
    Equal(String),
    Added(String),
    Removed(String),
}

/// One paragraph-level change within a modified section.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ParagraphDiff {
    Unchanged { paragraph: Paragraph },
    Added { paragraph: Paragraph },
    Removed { paragraph: Paragraph },
    Modified(ModifiedParagraphDiff),
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModifiedParagraphDiff {
    pub old: Paragraph,
    pub new: Paragraph,
    pub word_diff: Vec<WordDiff>,
}

/// One section-level change between two documents.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SectionDiff {
    Unchanged { section: Section },
    Added { section: Section },
    Removed { section: Section },
    Modified(ModifiedSectionDiff),
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModifiedSectionDiff {
    pub section_id: String,
    pub old_title: String,
    pub new_title: String,
    pub old_type: SectionType,
    pub new_type: SectionType,
    pub paragraph_diffs: Vec<ParagraphDiff>,
}

/// Concatenated run text of a paragraph — the basis for the word diff.
fn paragraph_text(p: &Paragraph) -> String {
    p.elements
        .iter()
        .map(|e| e.text_run.content.as_str())
        .collect()
}

/// Word-level diff of two strings, with adjacent same-tag spans coalesced.
fn word_diff(old: &str, new: &str) -> Vec<WordDiff> {
    let diff = TextDiff::from_words(old, new);
    let mut out: Vec<WordDiff> = Vec::new();
    for change in diff.iter_all_changes() {
        let text = change.value().to_string();
        let next = match change.tag() {
            ChangeTag::Equal => WordDiff::Equal(text),
            ChangeTag::Insert => WordDiff::Added(text),
            ChangeTag::Delete => WordDiff::Removed(text),
        };
        // Coalesce into the previous span when the tag matches.
        let coalesced = match (&mut out[..], &next) {
            ([.., WordDiff::Equal(prev)], WordDiff::Equal(t)) => {
                prev.push_str(t);
                true
            }
            ([.., WordDiff::Added(prev)], WordDiff::Added(t)) => {
                prev.push_str(t);
                true
            }
            ([.., WordDiff::Removed(prev)], WordDiff::Removed(t)) => {
                prev.push_str(t);
                true
            }
            _ => false,
        };
        if !coalesced {
            out.push(next);
        }
    }
    out
}

/// Paragraph-level id-match diff, mirroring `compute_paragraph_ops`'s walk shape
/// but emitting `ParagraphDiff` blocks.
fn compute_paragraph_diffs(old: &[Paragraph], new: &[Paragraph]) -> Vec<ParagraphDiff> {
    let mut diffs = Vec::new();
    let mut i = 0usize;
    let mut j = 0usize;

    while i < old.len() || j < new.len() {
        if i < old.len() && j < new.len() && old[i].id == new[j].id {
            if old[i] == new[j] {
                diffs.push(ParagraphDiff::Unchanged {
                    paragraph: old[i].clone(),
                });
            } else {
                let old_text = paragraph_text(&old[i]);
                let new_text = paragraph_text(&new[j]);
                // Only compute a word diff when the text actually differs — a
                // style/indent-only change has no word spans to show.
                let words = if old_text == new_text {
                    Vec::new()
                } else {
                    word_diff(&old_text, &new_text)
                };
                diffs.push(ParagraphDiff::Modified(ModifiedParagraphDiff {
                    old: old[i].clone(),
                    new: new[j].clone(),
                    word_diff: words,
                }));
            }
            i += 1;
            j += 1;
        } else if j < new.len()
            && (i >= old.len() || !old.iter().skip(i).any(|p| p.id == new[j].id))
        {
            diffs.push(ParagraphDiff::Added {
                paragraph: new[j].clone(),
            });
            j += 1;
        } else if i < old.len()
            && (j >= new.len() || !new.iter().skip(j).any(|p| p.id == old[i].id))
        {
            diffs.push(ParagraphDiff::Removed {
                paragraph: old[i].clone(),
            });
            i += 1;
        } else {
            // Both paragraphs exist elsewhere in the opposite list: a reorder.
            // Treat as remove + add (correct, not optimal — reordering
            // paragraphs is rare and out of scope for a clean diff).
            diffs.push(ParagraphDiff::Removed {
                paragraph: old[i].clone(),
            });
            diffs.push(ParagraphDiff::Added {
                paragraph: new[j].clone(),
            });
            i += 1;
            j += 1;
        }
    }

    diffs
}

/// Section-level id-match diff between two documents.
pub fn compute_diff(old: &Document, current: &Document) -> Vec<SectionDiff> {
    let mut diffs = Vec::new();
    let mut i = 0usize;
    let mut j = 0usize;
    let old_secs = &old.sections;
    let new_secs = &current.sections;

    while i < old_secs.len() || j < new_secs.len() {
        if i < old_secs.len() && j < new_secs.len() && old_secs[i].id == new_secs[j].id {
            if old_secs[i] == new_secs[j] {
                diffs.push(SectionDiff::Unchanged {
                    section: old_secs[i].clone(),
                });
            } else {
                diffs.push(SectionDiff::Modified(ModifiedSectionDiff {
                    section_id: old_secs[i].id.clone(),
                    old_title: old_secs[i].title.clone(),
                    new_title: new_secs[j].title.clone(),
                    old_type: old_secs[i].section_type,
                    new_type: new_secs[j].section_type,
                    paragraph_diffs: compute_paragraph_diffs(
                        &old_secs[i].paragraphs,
                        &new_secs[j].paragraphs,
                    ),
                }));
            }
            i += 1;
            j += 1;
        } else if j < new_secs.len()
            && (i >= old_secs.len() || !old_secs.iter().skip(i).any(|s| s.id == new_secs[j].id))
        {
            diffs.push(SectionDiff::Added {
                section: new_secs[j].clone(),
            });
            j += 1;
        } else if i < old_secs.len()
            && (j >= new_secs.len() || !new_secs.iter().skip(j).any(|s| s.id == old_secs[i].id))
        {
            diffs.push(SectionDiff::Removed {
                section: old_secs[i].clone(),
            });
            i += 1;
        } else {
            // Reorder: treat as remove + add.
            diffs.push(SectionDiff::Removed {
                section: old_secs[i].clone(),
            });
            diffs.push(SectionDiff::Added {
                section: new_secs[j].clone(),
            });
            i += 1;
            j += 1;
        }
    }

    diffs
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Element, TextRun, TextStyle};

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

    fn doc_with(section: Section) -> Document {
        create_document(vec![section])
    }

    #[test]
    fn identical_documents_have_only_unchanged_sections() {
        let s = create_section("s1", "Intro", SectionType::Section, vec![create_paragraph("p1", "hi")]);
        let diffs = compute_diff(&doc_with(s.clone()), &doc_with(s));
        assert_eq!(diffs.len(), 1);
        assert!(matches!(diffs[0], SectionDiff::Unchanged { .. }));
    }

    #[test]
    fn added_section_in_current_is_added() {
        let old = create_document(vec![create_section("s1", "A", SectionType::Section, vec![])]);
        let current = create_document(vec![
            create_section("s1", "A", SectionType::Section, vec![]),
            create_section("s2", "B", SectionType::Section, vec![]),
        ]);
        let diffs = compute_diff(&old, &current);
        assert!(diffs.iter().any(|d| matches!(d, SectionDiff::Added { .. })));
    }

    #[test]
    fn removed_section_in_current_is_removed() {
        let old = create_document(vec![
            create_section("s1", "A", SectionType::Section, vec![]),
            create_section("s2", "B", SectionType::Section, vec![]),
        ]);
        let current = create_document(vec![create_section("s1", "A", SectionType::Section, vec![])]);
        let diffs = compute_diff(&old, &current);
        assert!(diffs.iter().any(|d| matches!(d, SectionDiff::Removed { .. })));
    }

    #[test]
    fn renamed_section_is_modified_with_changed_title_and_unchanged_paragraphs() {
        let old = doc_with(create_section("s1", "Old", SectionType::Section, vec![create_paragraph("p1", "body")]));
        let current = doc_with(create_section("s1", "New", SectionType::Section, vec![create_paragraph("p1", "body")]));
        let diffs = compute_diff(&old, &current);
        match &diffs[0] {
            SectionDiff::Modified(m) => {
                assert_eq!(m.old_title, "Old");
                assert_eq!(m.new_title, "New");
                assert_eq!(m.old_type, m.new_type);
                assert!(matches!(&m.paragraph_diffs[0], ParagraphDiff::Unchanged { .. }));
            }
            other => panic!("expected Modified, got {other:?}"),
        }
    }

    #[test]
    fn section_type_change_is_modified_with_changed_type() {
        let old = doc_with(create_section("s1", "X", SectionType::Section, vec![]));
        let current = doc_with(create_section("s1", "X", SectionType::Chapter, vec![]));
        let diffs = compute_diff(&old, &current);
        match &diffs[0] {
            SectionDiff::Modified(m) => {
                assert_eq!(m.old_type, SectionType::Section);
                assert_eq!(m.new_type, SectionType::Chapter);
            }
            other => panic!("expected Modified, got {other:?}"),
        }
    }

    #[test]
    fn added_paragraph_in_current_is_added() {
        let old = doc_with(create_section("s1", "A", SectionType::Section, vec![create_paragraph("p1", "one")]));
        let current = doc_with(create_section("s1", "A", SectionType::Section, vec![
            create_paragraph("p1", "one"),
            create_paragraph("p2", "two"),
        ]));
        let diffs = compute_diff(&old, &current);
        match &diffs[0] {
            SectionDiff::Modified(m) => {
                assert!(matches!(&m.paragraph_diffs[1], ParagraphDiff::Added { .. }));
            }
            other => panic!("expected Modified, got {other:?}"),
        }
    }

    #[test]
    fn removed_paragraph_in_current_is_removed() {
        let old = doc_with(create_section("s1", "A", SectionType::Section, vec![
            create_paragraph("p1", "one"),
            create_paragraph("p2", "two"),
        ]));
        let current = doc_with(create_section("s1", "A", SectionType::Section, vec![create_paragraph("p1", "one")]));
        let diffs = compute_diff(&old, &current);
        match &diffs[0] {
            SectionDiff::Modified(m) => {
                assert!(matches!(&m.paragraph_diffs[1], ParagraphDiff::Removed { .. }));
            }
            other => panic!("expected Modified, got {other:?}"),
        }
    }

    #[test]
    fn modified_paragraph_carries_word_diff() {
        let old = doc_with(create_section("s1", "A", SectionType::Section, vec![create_paragraph("p1", "the quick brown fox")]));
        let current = doc_with(create_section("s1", "A", SectionType::Section, vec![create_paragraph("p1", "the slow brown fox")]));
        let diffs = compute_diff(&old, &current);
        match &diffs[0] {
            SectionDiff::Modified(m) => match &m.paragraph_diffs[0] {
                ParagraphDiff::Modified(mp) => {
                    // Equal "the " + Removed "quick " + Equal " brown " + Added "slow " + Equal " fox"
                    // (exact spans depend on similar's word tokenizer, so just
                    // assert both an Added and a Removed span exist.)
                    assert!(mp.word_diff.iter().any(|w| matches!(w, WordDiff::Added(_))));
                    assert!(mp.word_diff.iter().any(|w| matches!(w, WordDiff::Removed(_))));
                    assert!(mp.word_diff.iter().any(|w| matches!(w, WordDiff::Equal(_))));
                }
                other => panic!("expected Modified paragraph, got {other:?}"),
            },
            other => panic!("expected Modified section, got {other:?}"),
        }
    }

    #[test]
    fn style_only_paragraph_change_has_no_word_diff() {
        let mut old_p = create_paragraph("p1", "same text");
        old_p.left_indent = None;
        let mut new_p = create_paragraph("p1", "same text");
        new_p.left_indent = Some(0.5);
        let old = doc_with(create_section("s1", "A", SectionType::Section, vec![old_p]));
        let current = doc_with(create_section("s1", "A", SectionType::Section, vec![new_p]));
        let diffs = compute_diff(&old, &current);
        match &diffs[0] {
            SectionDiff::Modified(m) => match &m.paragraph_diffs[0] {
                ParagraphDiff::Modified(mp) => assert!(mp.word_diff.is_empty()),
                other => panic!("expected Modified paragraph, got {other:?}"),
            },
            other => panic!("expected Modified section, got {other:?}"),
        }
    }

    #[test]
    fn word_diff_coalesces_adjacent_same_tag_spans() {
        let words = word_diff("a b c", "a b c");
        // All equal → coalesces into a single Equal span (with the inter-word
        // whitespace included by the word tokenizer).
        assert_eq!(words.len(), 1);
        assert!(matches!(&words[0], WordDiff::Equal(_)));
    }
}