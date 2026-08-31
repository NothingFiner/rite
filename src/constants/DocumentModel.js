// Factories for building document content in the frontend. These mirror the
// Rust Document model (src-tauri/src/document.rs): the id shapes and text-run
// style shape must stay aligned with what Rust serializes, so they live in one
// place rather than being re-defined at each call site.
//
// generateParagraphId / generateSectionId: stable client-side ids. Combines a
//   timestamp with randomness so ids generated within the same millisecond
//   still differ. Sections use an `s-` prefix, paragraphs a `p-` prefix, so a
//   raw id tells you which entity it refers to (useful in the editor's flat DOM
//   where section-title and paragraph elements sit side by side).
// createParagraph: one empty unstyled paragraph — the unit the editor inserts
//   and the importer emits.
// createSection: an empty section of a given type with one empty paragraph
//   inside (so there is always something to type into — mirrors the old
//   "ensure an editable normal paragraph after the heading").
// defaultTextStyle: the zeroed text-run style new runs start from.

export function generateParagraphId() {
  return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

export function generateSectionId() {
  return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

export function createParagraph(text = '') {
  return {
    id: generateParagraphId(),
    elements: [{ textRun: { content: text, textStyle: defaultTextStyle() } }],
    leftIndent: null,
    rightIndent: null,
    firstLineIndent: null,
  }
}

export function createSection({ title = '', sectionType = 'section', paragraphs = null } = {}) {
  return {
    id: generateSectionId(),
    title,
    sectionType,
    paragraphs: paragraphs ?? [createParagraph()],
  }
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