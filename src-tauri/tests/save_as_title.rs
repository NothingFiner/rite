//! The document title round-trips through the `.rite` file (SPEC.md S-010).
//!
//! The bug this spec fixes lives in the frontend: `saveDocument()` in
//! `src/stores/document.js` rewrote `doc.title` from the filename on every
//! save, so a title the writer had set was discarded. The Rust side was already
//! correct — `Document.title` is a serialised field and `open_document` returns
//! it verbatim — and this test is the guard that keeps it that way. If a future
//! change makes the title derivable from the path on the Rust side, the title
//! stops being a property of the document and this test fails.
//!
//! Driven through a mock app (the pattern from `tests/smoke.rs`) because
//! `save_document` / `open_document` take `AppHandle` + `State<AppState>`, and
//! reopening uses a SECOND app so nothing is remembered in memory: what the
//! assertion sees can only have come off disk.

use rite_lib::commands::{open_document, save_document};
use rite_lib::document::Document;
use rite_lib::state::AppState;
use tauri::Manager;

fn mock_app_with(doc: Document) -> tauri::App<tauri::test::MockRuntime> {
    let app = tauri::test::mock_builder()
        .manage(AppState::new())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app builds without a window or event loop");
    *app.state::<AppState>().document.lock().unwrap() = doc;
    app
}

#[test]
fn s_010_saving_and_reopening_returns_the_same_title() {
    let dir = tempfile::tempdir().expect("scratch dir");
    let path = dir.path().join("novel.rite");
    let path = path.to_string_lossy().into_owned();

    // The title is deliberately nothing like the filename: a title derived from
    // the path would read "novel" here, not this.
    let doc = Document {
        title: "The Long Winter".to_string(),
        ..Document::default()
    };

    let writer = mock_app_with(doc);
    save_document(
        path.clone(),
        writer.handle().clone(),
        writer.state::<AppState>(),
    )
    .expect("save_document writes the file");

    let reader = tauri::test::mock_builder()
        .manage(AppState::new())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("second mock app builds");
    let reopened = open_document(
        path,
        reader.handle().clone(),
        reader.state::<AppState>(),
    )
    .expect("open_document reads the file back");

    assert_eq!(
        reopened.title, "The Long Winter",
        "the title stored in the file must come back unchanged, not be derived from the path"
    );
}
