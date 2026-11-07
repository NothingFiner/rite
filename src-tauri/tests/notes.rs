//! Notes storage (SPEC.md 5.17, S-011 and S-012).
//!
//! The sentences drive the real command surface through a mock Tauri app. A
//! note is set through `update_notes`, the document is saved, and the file is
//! read back. The point is that notes travel inside the `.rite` file, and that
//! nothing else in the file picks them up.

use rite_lib::export_text::{document_to_text, ExportFormat};
use rite_lib::history::{read_rite_file, HistoryRecord};
use rite_lib::notes::Notes;
use rite_lib::state::AppState;
use rite_lib::commands;
use std::collections::HashMap;
use tauri::Manager;

/// The text every sentence below searches for. Distinctive enough that a loose
/// substring match in a document, export or snapshot is unambiguous.
const MARKER: &str = "NOTES-MARKER-5-17";

fn notes_fixture() -> Notes {
    Notes {
        overview: format!("{MARKER} overview"),
        sections: HashMap::from([
            ("s1".to_string(), format!("{MARKER} section one")),
            ("s2".to_string(), format!("{MARKER} section two")),
        ]),
        orphaned: format!("{MARKER} orphaned"),
    }
}

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(AppState::new())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app builds without a window or event loop")
}

#[test]
fn s_011_notes_round_trip_through_the_rite_file() {
    let dir = tempfile::tempdir().expect("scratch dir");
    let path = dir.path().join("notes.rite");
    let path_string = path.to_string_lossy().into_owned();

    let writer = mock_app();
    let notes = notes_fixture();
    commands::update_notes(notes.clone(), writer.state::<AppState>())
        .expect("update_notes accepts the record");
    commands::save_document(
        path_string.clone(),
        writer.handle().clone(),
        writer.state::<AppState>(),
    )
    .expect("save_document writes the .rite file");

    let reader = mock_app();
    commands::open_document(
        path_string,
        reader.handle().clone(),
        reader.state::<AppState>(),
    )
    .expect("open_document reads the .rite file");
    let loaded = commands::retrieve_notes(reader.state::<AppState>())
        .expect("retrieve_notes reads the managed record");

    assert_eq!(
        loaded, notes,
        "the notes written into the .rite file must come back unchanged"
    );
}

#[test]
fn s_012_notes_stay_out_of_the_document_text_export_and_history_snapshots() {
    let dir = tempfile::tempdir().expect("scratch dir");
    let path = dir.path().join("notes.rite");

    let app = mock_app();
    let notes = notes_fixture();
    commands::update_notes(notes.clone(), app.state::<AppState>())
        .expect("update_notes accepts the record");
    commands::save_document(
        path.to_string_lossy().into_owned(),
        app.handle().clone(),
        app.state::<AppState>(),
    )
    .expect("save_document writes the .rite file");

    let json = std::fs::read_to_string(&path).expect("the .rite file exists");
    let file = read_rite_file(&json).expect("the .rite file parses");

    // Non-vacuity guard: the notes really are in the file, so the assertions
    // below are about separation, not about a note that was never stored.
    assert_eq!(file.notes, notes, "the saved file carries the notes");

    let document_json = serde_json::to_string(&file.document).expect("document serializes");
    assert!(
        !document_json.contains(MARKER),
        "note text must not appear in the document, got: {document_json}"
    );
    assert!(
        !document_json.contains("\"notes\""),
        "the document model has no notes field, got: {document_json}"
    );

    for format in [ExportFormat::PlainText, ExportFormat::Markdown] {
        let exported = document_to_text(&file.document, format);
        assert!(
            !exported.contains(MARKER),
            "note text must not reach the text export, got: {exported}"
        );
    }

    assert!(
        !file.history.is_empty(),
        "saving records a snapshot the sentence can inspect"
    );
    for record in &file.history {
        if let HistoryRecord::Snapshot { document, .. } = record {
            let snapshot = serde_json::to_string(document).expect("snapshot serializes");
            assert!(
                !snapshot.contains(MARKER),
                "a version-history snapshot must hold manuscript text only, got: {snapshot}"
            );
        }
    }
}
