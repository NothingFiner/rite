// Notes record helpers (SPEC.md 5.17).
//
// The record is document-level and separate from `Document`. Its shape is
//   { overview: String, sections: { [sectionId]: String }, orphaned: String }
//
// NotesView.vue edits these values. This module owns the pure translations.
// They are the ordered entry list, the read/write helpers, the assistant
// context, and the move of a deleted section's note into the single orphaned
// draft.

export function emptyNotes() {
  return { overview: '', sections: {}, orphaned: '' }
}

// Rows for the Notes pane, in this order: the story overview, every section
// in document order, then the orphaned draft (S-001). `kind` mirrors the
// section type and separates chapter rows from section rows. `sectionId`
// appears only on rows backed by a real section, so the pane resolves a
// selected row back to that section through it. Hidden sections keep their
// row, the way NavigationDrawer.vue lists them, so the note stored on a
// hidden section stays reachable. The overview and orphaned rows carry
// fixed, display-only titles.
export function noteEntries(doc) {
  const sections = Array.isArray(doc?.sections) ? doc.sections : []
  return [
    { id: 'overview', kind: 'overview', title: 'Story Overview' },
    ...sections.map((section) => ({
      id: section.id,
      kind: section.sectionType === 'chapter' ? 'chapter' : 'section',
      title: section.title,
      sectionId: section.id,
    })),
    { id: 'orphaned', kind: 'orphaned', title: 'Orphaned notes' },
  ]
}

export function readNote(notes, id) {
  return ''
}

export function writeNote(notes, id, text) {
  return notes
}

export function notesToText(notes, sections) {
  return ''
}

export function orphanSectionNote(notes, section) {
  return notes
}
