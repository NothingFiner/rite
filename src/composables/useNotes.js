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

export function noteEntries(doc) {
  return []
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
