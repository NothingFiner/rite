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

// The Notes list rows (S-001): the story overview first, then every section
// in document order, then the single orphaned draft. sectionId exists only on
// section rows, so the pane can map a row back to its section. Hidden
// sections still list, as in NavigationDrawer.vue. The overview and orphaned
// titles are display-only.
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
