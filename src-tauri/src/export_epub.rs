//! EPUB (`.epub`) export of the live document.
//!
//! Stub only — signatures are fixed so the integration tests in
//! `src-tauri/tests/epub_export.rs` compile and fail on their own expectations
//! rather than on a missing symbol. See `SPEC.md` (S-001…S-018) for the
//! behaviour and `export_docx.rs` for the hand-rolled-OPC pattern this should
//! follow.
//!
//! Why the stubs return empty values instead of `todo!()`: `todo!()` panics
//! inside the implementation, so every test dies with "not yet implemented" and
//! the failure says nothing about what was expected. Returning nothing instead
//! pushes the failure into the test, where the assertion message names the
//! behaviour that is missing.

use crate::document::Document;
use crate::state::AppState;
use tauri::State;

/// Render `doc` as a complete EPUB byte vector.
///
/// Pure over the document — no I/O, no state — so the integration tests can
/// call it directly. The bytes should be a valid EPUB 3 OPC package.
pub fn document_to_epub(doc: &Document) -> Vec<u8> {
    let _ = doc;
    Vec::new()
}

/// Read the live document out of `AppState`, render it, and write the package.
#[tauri::command]
pub fn export_epub(path: String, state: State<AppState>) -> Result<(), String> {
    let _ = (path, state);
    Ok(())
}
