// Factories for building document content in the frontend. These mirror the
// Rust Document model (src-tauri/src/document.rs): the paragraph-id shape and
// the text-run style shape must stay aligned with what Rust serializes, so
// they live in one place rather than being re-defined at each call site.
//
// generateParagraphId: a stable client-side id for a paragraph. Used both when
//   the editor synthesizes a new paragraph and when import builds paragraphs
//   from a parsed file. Combines a timestamp with randomness so that ids
//   generated within the same millisecond still differ.
// defaultTextStyle: the zeroed text-run style (no bold/italic/underline, no
//   font-size override) that new text runs start from. Overrides merge on top.

export function generateParagraphId() {
  return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

export function defaultTextStyle(overrides = {}) {
  return {
    bold: false,
    italic: false,
    underline: false,
    fontSize: null,
    ...overrides,
  }
}