//! Reference entries (SPEC.md 5.19a, S-001 and S-020).
//!
//! The record lives beside `Notes` in the `.rite`, and never inside
//! `Document`. These sentences pin both halves: the file round trip, and the
//! exclusion from exports and history snapshots.

use rite_lib::document::{Document, Element, Paragraph, Section, SectionType, TextRun};
use rite_lib::export_text::{document_to_text, ExportFormat};
use rite_lib::history::RiteFile;
use rite_lib::references::{self, ReferenceEntry, ReferenceKind, References};
use rite_lib::state::AppState;

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

fn document_with_text(text: &str) -> Document {
    Document {
        title: "Reference Test".into(),
        author: "Author Name".into(),
        author_contact: String::new(),
        has_toc: false,
        sections: vec![Section {
            id: "s1".into(),
            title: "The Square".into(),
            section_type: SectionType::Section,
            hidden: false,
            paragraphs: vec![paragraph(text)],
        }],
    }
}

#[test]
fn s_001_stores_references_in_the_rite_file_and_reads_a_missing_record_as_empty() {
    let state = AppState::new();
    let entry = ReferenceEntry {
        id: "r1".into(),
        kind: ReferenceKind::Term,
        name: "Ashfall".into(),
        definition: "The seasonal fall of grey ash.".into(),
        ..Default::default()
    };

    let saved = references::save_references(
        &state,
        References {
            entries: vec![entry.clone()],
        },
    )
    .expect("save references");
    assert_eq!(saved.entries, vec![entry.clone()]);

    let loaded = references::load_references(&state);
    assert_eq!(loaded.entries.len(), 1);
    assert_eq!(loaded.entries[0].name, "Ashfall");

    let file = state.build_rite_file().expect("build the rite file");
    assert_eq!(file.references.entries.len(), 1);

    let mut value = serde_json::to_value(&file).expect("serialize the file");
    value
        .as_object_mut()
        .expect("a serialized file is an object")
        .remove("references");
    let legacy: RiteFile = serde_json::from_value(value).expect("read a file without references");
    assert!(legacy.references.entries.is_empty());
}

#[test]
fn s_020_keeps_references_out_of_exports_and_history_snapshots() {
    let state = AppState::new();
    references::save_references(
        &state,
        References {
            entries: vec![ReferenceEntry {
                id: "r1".into(),
                kind: ReferenceKind::Place,
                name: "Qualen Square".into(),
                definition: "Named for Izildar Qualen.".into(),
                ..Default::default()
            }],
        },
    )
    .expect("save references");

    let doc = document_with_text("The square was empty at dawn.");
    {
        let mut live = state.document.lock().expect("document lock");
        *live = doc.clone();
    }
    state.set_history_baseline(&doc);
    state.append_history_snapshot(&doc).expect("append a snapshot");

    let exported = document_to_text(&doc, ExportFormat::PlainText);
    assert!(!exported.contains("Qualen Square"));
    assert!(!exported.contains("Named for Izildar Qualen"));

    let file = state.build_rite_file().expect("build the rite file");
    let history = serde_json::to_string(&file.history).expect("serialize history");
    assert!(!history.contains("Qualen Square"));
    assert!(!history.contains("Named for Izildar Qualen"));
}

/// S-040: DOCX is built from `Document` alone. The record sits beside it in the
/// state, so a change that appends glossary content to exports fails here.
#[test]
fn s_040_keeps_reference_entries_out_of_the_docx_export() {
    use std::io::Read;

    let state = AppState::new();
    let seeded = document_with_text("Izildar Qualen kept the record.");
    state.document.lock().unwrap().clone_from(&seeded);
    references::save_references(
        &state,
        References {
            entries: vec![ReferenceEntry {
                id: "r1".into(),
                kind: ReferenceKind::Character,
                name: "Ashfall".into(),
                definition: "The seasonal fall of grey ash.".into(),
                ..Default::default()
            }],
        },
    )
    .unwrap();

    let document = state.document.lock().unwrap().clone();
    let bytes = rite_lib::export_docx::document_to_docx(&document);

    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("docx is a zip");
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .expect("document part")
        .read_to_string(&mut xml)
        .expect("read document part");

    assert!(xml.contains("Izildar Qualen"), "manuscript text is exported");
    assert!(!xml.contains("Ashfall"), "reference entries stay out of the export");
    assert!(
        !xml.contains("seasonal fall of grey ash"),
        "entry definitions stay out of the export"
    );
}
