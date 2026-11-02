//! EPUB (`.epub`) export of the live document.
//!
//! Stub only — signatures are fixed so the integration tests in
//! `src-tauri/tests/epub_export.rs` compile and fail on their assertions rather
//! than on a missing symbol. See `SPEC.md` (S-001…S-018) for the behaviour and
//! `export_docx.rs` for the hand-rolled-OPC pattern this should follow.

use crate::document::Document;
use crate::state::AppState;
use tauri::State;

/// Render `doc` as a complete EPUB byte vector.
///
/// Pure over the document — no I/O, no state — so the integration tests can
/// call it directly. The bytes should be a valid EPUB 3 OPC package.
pub fn document_to_epub(doc: &Document) -> Vec<u8> {
    let _ = doc;
    todo!("document_to_epub is not implemented yet")
}

/// Read the live document out of `AppState`, render it, and write the package.
#[tauri::command]
pub fn export_epub(path: String, state: State<AppState>) -> Result<(), String> {
    let _ = (path, state);
    todo!("export_epub is not implemented yet")
}
