//! The document-level recap (SPEC.md 5.20b, S-030 … S-033).
//!
//! The overview page's summary is the manuscript's, not a section's: the model
//! reads every section in order under its title, and the staleness baseline is
//! the whole document. These sentences drive the pure half — the ordering and
//! naming rules, the hash, and the entry the frontend renders — plus the
//! sidecar field that carries it. No network and no Tauri state.

use rite_lib::document::{Document, Element, Paragraph, Section, SectionType, TextRun};
use rite_lib::sidecar::Sidecar;
use rite_lib::summary::{build_document_summary_entry, document_text, document_text_hash, SectionSummary};

fn paragraph(text: &str) -> Paragraph {
    Paragraph {
        id: format!("p-{}", text.len()),
        elements: vec![Element {
            text_run: TextRun {
                content: text.to_string(),
                text_style: Default::default(),
            },
        }],
        left_indent: None,
        right_indent: None,
        first_line_indent: None,
    }
}

fn section(id: &str, title: &str, section_type: SectionType, paragraphs: Vec<Paragraph>) -> Section {
    Section {
        id: id.to_string(),
        title: title.to_string(),
        section_type,
        hidden: false,
        paragraphs,
    }
}

/// Three sections in one chapter, in manuscript order, with a title-less
/// chapter in the middle — the shape that catches an order or a naming bug.
fn manuscript() -> Document {
    Document {
        title: "A Novel".into(),
        author: "Author".into(),
        author_contact: String::new(),
        has_toc: false,
        sections: vec![
            section(
                "c1",
                "The Arrival",
                SectionType::Chapter,
                vec![paragraph("The door opened on an empty street.")],
            ),
            section("s1", "Interlude", SectionType::Section, vec![paragraph("A pause.")]),
            section("c2", "", SectionType::Chapter, vec![paragraph("The letter is opened.")]),
        ],
    }
}

#[test]
fn s_030_a_sidecar_without_a_document_summary_loads_with_none() {
    // Every sidecar written before 5.20b — schema v2 included — has no
    // `documentSummary` key. It must load, not fail, and read as "not
    // generated yet".
    let json = r#"{
        "schemaVersion": 2,
        "sectionHashes": {},
        "vectors": [],
        "summaries": {}
    }"#;

    let sidecar: Sidecar = serde_json::from_str(json).expect("a pre-5.20b sidecar loads");

    assert_eq!(sidecar.document_summary, None);
}

#[test]
fn s_030_a_document_summary_round_trips_through_the_sidecar() {
    let stored = SectionSummary {
        section_id: String::new(),
        section_hash: 42,
        summary: "A whole-manuscript recap.".to_string(),
    };

    let sidecar = Sidecar::new(Default::default(), Vec::new(), Default::default())
        .with_document_summary(Some(stored.clone()));

    let json = serde_json::to_string(&sidecar).expect("the sidecar serializes");
    let back: Sidecar = serde_json::from_str(&json).expect("and reads back");

    assert_eq!(back.document_summary, Some(stored));
}

#[test]
fn s_031_document_text_lists_every_section_in_manuscript_order() {
    let text = document_text(&manuscript());

    let arrival = text.find("The Arrival").expect("the first chapter's title is in the input");
    let interlude = text.find("Interlude").expect("the section title is in the input");
    let second_chapter = text.find("The letter is opened.").expect("the last section's text is in the input");

    assert!(arrival < interlude, "sections keep manuscript order");
    assert!(interlude < second_chapter, "sections keep manuscript order");

    // The text the model reads is the source prose, under each heading.
    assert!(text.contains("The door opened on an empty street."));
    assert!(text.contains("A pause."));
}

#[test]
fn s_031_document_text_names_an_untitled_chapter_by_its_number() {
    // A Chapter's stored title is only its subtitle and may be empty (5.9), so
    // a bare join would give the model a blank heading for chapter two.
    let text = document_text(&manuscript());

    assert!(
        text.contains("Chapter 2"),
        "the second chapter is named by its derived number: {text}"
    );
}

#[test]
fn s_032_hash_is_stable_for_the_same_document() {
    assert_eq!(
        document_text_hash(&manuscript()),
        document_text_hash(&manuscript())
    );
}

#[test]
fn s_032_hash_changes_when_any_section_text_changes() {
    let before = document_text_hash(&manuscript());

    let mut edited = manuscript();
    edited.sections[1].paragraphs = vec![paragraph("A longer pause, rewritten.")];

    assert_ne!(before, document_text_hash(&edited));
}

#[test]
fn s_033_no_stored_summary_reads_as_none_not_an_error() {
    // A view's empty state, unlike the Summaries Feedback Target, which turns
    // an empty store into an error on purpose.
    assert_eq!(build_document_summary_entry(None, &manuscript()), None);
}

#[test]
fn s_033_a_current_document_summary_is_returned_unstale() {
    let doc = manuscript();
    let stored = SectionSummary {
        section_id: String::new(),
        section_hash: document_text_hash(&doc),
        summary: "Four characters, one letter, no sender.".to_string(),
    };

    let entry = build_document_summary_entry(Some(&stored), &doc).expect("a stored summary is returned");

    assert_eq!(entry.summary, "Four characters, one letter, no sender.");
    assert!(!entry.stale, "the manuscript it was generated from is unchanged");
}

#[test]
fn s_033_a_document_summary_of_an_edited_manuscript_is_stale() {
    let stored = SectionSummary {
        section_id: String::new(),
        section_hash: document_text_hash(&manuscript()),
        summary: "Four characters, one letter, no sender.".to_string(),
    };

    let mut edited = manuscript();
    edited.sections[2].paragraphs = vec![paragraph("The letter is burned unopened.")];

    let entry = build_document_summary_entry(Some(&stored), &edited).expect("a stored summary is returned");

    assert!(entry.stale, "any section edit invalidates the whole-manuscript recap");
}
