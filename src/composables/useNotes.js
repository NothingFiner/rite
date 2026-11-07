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

// Returns the stored note text for an entry id. The overview and orphaned
// rows have their own record fields, so only those two ids read them. A
// section with no note has no key in sections, and every miss returns ''.
export function readNote(notes, id) {
  if (id === 'overview') return notes?.overview ?? ''
  if (id === 'orphaned') return notes?.orphaned ?? ''
  return notes?.sections?.[id] ?? ''
}

// Returns a new record with one entry's text set. The caller swaps the record
// in, so the input record and its sections stay untouched. Blank text for a
// section deletes the key instead of storing one. An empty note is "no note",
// which keeps `readNote` misses and `notesToText` skips consistent.
export function writeNote(notes, id, text) {
  const record = {
    overview: notes?.overview ?? '',
    sections: { ...notes?.sections },
    orphaned: notes?.orphaned ?? '',
  }
  const value = text ?? ''
  if (id === 'overview') {
    record.overview = value
  } else if (id === 'orphaned') {
    record.orphaned = value
  } else if (!value.trim()) {
    delete record.sections[id]
  } else {
    record.sections[id] = value
  }
  return record
}

// Builds the context string for the Notes scope (S-009). The preamble is
// unconditional, so `emptyNotes()` still tells the assistant what the text
// is. Whitespace-only notes count as empty. The orphaned draft stays out
// because it describes text the manuscript does not contain.
export function notesToText(notes, sections) {
  const storedNotes = notes ?? emptyNotes()
  const list = Array.isArray(sections) ? sections : []
  const lines = ["These are the author's notes about the manuscript, not manuscript prose."]

  const overview = storedNotes.overview ?? ''
  if (overview.trim()) {
    lines.push('## Story overview', overview)
  }

  for (const section of list) {
    const text = storedNotes.sections?.[section.id] ?? ''
    if (!text.trim()) {
      continue
    }
    lines.push(`## ${section.title}`, text)
  }

  return lines.join('\n\n')
}

// Moves one deleted section's note into the single orphaned draft under that
// section's title. Successive calls append after a blank line, so the one
// draft accumulates deletions in the order they happen. A blank note still
// deletes the key, because an empty section note is "no note" (the rule
// `writeNote` states).
export function orphanSectionNote(notes, section) {
  const record = {
    overview: notes?.overview ?? '',
    sections: { ...notes?.sections },
    orphaned: notes?.orphaned ?? '',
  }
  const text = record.sections[section.id] ?? ''
  delete record.sections[section.id]
  if (!text.trim()) return record

  const heading = `## ${section.title}`
  record.orphaned = record.orphaned.trim()
    ? `${record.orphaned.trim()}\n\n${heading}\n\n${text}`
    : `${heading}\n\n${text}`
  return record
}
