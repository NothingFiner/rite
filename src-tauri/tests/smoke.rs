//! Proves the Rust integration-test seam works end to end.
//!
//! This file is intentionally trivial — it is the smoke test for the *harness*,
//! not for any feature. It exists so that a `cargo test` run fails loudly here
//! (rather than mysteriously inside a later feature's spec) if the library
//! target, the `tauri::test` dev-dependency, or the mock-app wiring regresses.
//!
//! Two routes are demonstrated, because the spec workflow needs both:
//!
//! 1. Pure library functions (`compute_doc_ops`) — no Tauri runtime at all.
//! 2. `#[tauri::command]` functions, which take `State<AppState>` — reached
//!    through a mock app, since `State` cannot be constructed by hand.

use rite_lib::{commands, document::Document, state::AppState};
use tauri::Manager;

#[test]
fn lib_target_exposes_document_functions_to_an_integration_test() {
    let doc = Document::default();

    let ops = rite_lib::document::compute_doc_ops(&doc, &doc);

    assert!(
        ops.is_empty(),
        "comparing a document with itself must produce no doc ops, got {ops:?}"
    );
}

#[test]
fn mock_tauri_app_supplies_state_to_a_command() {
    let app = tauri::test::mock_builder()
        .manage(AppState::new())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app builds without a window or event loop");
    let state = app.state::<AppState>();

    let doc = commands::get_document(state).expect("get_document returns the managed document");

    // NOT `assert_eq!(doc, Document::default())`: `Document::default()` mints a
    // fresh UUID for the starter section and paragraph on every call, so two
    // default documents are never `PartialEq`. Assert on the stable shape.
    assert_eq!(doc.title, "Untitled", "fresh state holds the starter document");
    assert_eq!(doc.sections.len(), 1, "the starter document has one section");
}
