// Notes record helpers (SPEC.md 5.17).
//
// The record is document-level and separate from `Document`. Its shape is
//   { overview: String, sections: { [sectionId]: String }, orphaned: String }
//
// NotesView.vue edits these values. This module owns the pure translations.
// They are the ordered entry list, the read/write helpers, the assistant
// context, and the move of a deleted section's note into the single orphaned
// draft. It also hosts the draft undo session the macOS menu routes through
// (S-026).

import { sectionDisplayTitle } from './useSectionFormat.js'

export function emptyNotes() {
  return { overview: '', sections: {}, orphaned: '' }
}

// Pairs each section with its render-derived chapter index, the same walk
// `flattenSections` does: only Chapter-type sections advance the counter, so a
// Section between two chapters does not shift the numbering. The index is what
// `sectionDisplayTitle` turns into "Chapter 3". Never read `section.title` raw
// for a Chapter — it is the subtitle, and a subtitle-less chapter is blank.
function sectionsWithChapterIndex(sections) {
  let chapterIndex = 0
  return sections.map((section) => ({
    section,
    chapterIndex: section.sectionType === 'chapter' ? ++chapterIndex : null,
  }))
}

// Rows for the Notes pane, in this order: the story overview, every section
// in document order, then the orphaned draft (S-001). `kind` mirrors the
// section type and separates chapter rows from section rows. `sectionId`
// appears only on rows backed by a real section, so the pane resolves a
// selected row back to that section through it. Hidden sections keep their
// row, the way NavigationDrawer.vue lists them, so the note stored on a
// hidden section stays reachable. The overview and orphaned rows carry
// fixed, display-only titles.
//
// Section rows carry the DISPLAY title from `sectionDisplayTitle`, the same one
// the navigation outline shows: "Chapter 3: Ash", "Chapter 3" for a
// subtitle-less chapter, or "Untitled Section" for a blank section. A raw
// `section.title` is blank for an unnamed chapter, which rendered the row —
// and the note header it opens — with no title at all.
export function noteEntries(doc) {
  const sections = Array.isArray(doc?.sections) ? doc.sections : []
  return [
    { id: 'overview', kind: 'overview', title: 'Story Overview' },
    ...sectionsWithChapterIndex(sections).map(({ section, chapterIndex }) => ({
      id: section.id,
      kind: section.sectionType === 'chapter' ? 'chapter' : 'section',
      title: sectionDisplayTitle(section, chapterIndex),
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

  for (const { section, chapterIndex } of sectionsWithChapterIndex(list)) {
    const text = storedNotes.sections?.[section.id] ?? ''
    if (!text.trim()) {
      continue
    }
    // The same display title the Notes list shows, so the model is never handed
    // a bare "## " heading for an unnamed chapter.
    lines.push(`## ${sectionDisplayTitle(section, chapterIndex)}`, text)
  }

  return lines.join('\n\n')
}

// Moves one deleted section's note into the single orphaned draft under that
// section's title. Successive calls append after a blank line, so the one
// draft accumulates deletions in the order they happen. A blank note still
// deletes the key, because an empty section note is "no note" (the rule
// `writeNote` states).
//
// `displayTitle` is the heading to write, and a caller that can still derive the
// section's chapter index should pass `sectionDisplayTitle(section, index)`:
// `section.title` alone is blank for an unnamed chapter, which would land the
// note under a bare "## " heading. It defaults to `section.title` so a caller
// with nothing better still works.
export function orphanSectionNote(notes, section, displayTitle = section?.title) {
  const record = {
    overview: notes?.overview ?? '',
    sections: { ...notes?.sections },
    orphaned: notes?.orphaned ?? '',
  }
  const text = record.sections[section.id] ?? ''
  delete record.sections[section.id]
  if (!text.trim()) return record

  const heading = `## ${displayTitle || 'Untitled Section'}`
  record.orphaned = record.orphaned.trim()
    ? `${record.orphaned.trim()}\n\n${heading}\n\n${text}`
    : `${heading}\n\n${text}`
  return record
}

// Orphans one section's note as part of its deletion. The caller passes the
// pre-deletion document, because a deleted section keeps no title or chapter
// index to derive the heading from. When the document holds no section with
// the id, `writeNote` with blank text just cleans the record's key.
export function orphanDeletedSection(doc, notes, sectionId) {
  const sections = Array.isArray(doc?.sections) ? doc.sections : []
  const found = sectionsWithChapterIndex(sections).find(({ section }) => section.id === sectionId)
  if (!found) return writeNote(notes, sectionId, '')
  return orphanSectionNote(notes, found.section, sectionDisplayTitle(found.section, found.chapterIndex))
}

// --- Note draft undo (S-026) ---
//
// The macOS menu owns Undo and Redo. While a note draft session is open, the
// menu action must unwind the draft text, and the manuscript history must not
// move. useMenu.js consults tryUndo/tryRedo first and runs the document store
// only when both return false.
//
// The undo stack holds every state the session saw, seed included, so its top
// reads as the live draft text. The stack has no cap, because drafts are small
// and it dies with the session.

export function createNoteDraftUndo() {
  let session = null

  // Opens the one session. A begin on an open session changes nothing. The
  // seed starts the undo stack, so an undo can return to the text the
  // session opened on.
  function begin(getText, setText) {
    if (session) return
    session = { getText, setText, undo: [], redo: [] }
    session.undo.push(getText())
  }

  // Closes the session, so menu undo/redo reach the manuscript again.
  function end() {
    session = null
  }

  // A repeated text is no typing and no step. Any real edit kills the redo
  // branch first, because an edit past an undone state has no redo left.
  function record(text) {
    if (!session) return
    if (session.undo[session.undo.length - 1] === text) return
    session.redo.length = 0
    session.undo.push(text)
  }

  // Pops the live text onto redo and restores the state under it. False means
  // no session, the signal useMenu.js needs to run the document store. Even
  // with no step left, a session consumes the action. A fall-through would
  // undo the manuscript under a visible draft.
  function tryUndo() {
    if (!session) return false
    if (session.undo.length < 2) return true
    session.redo.push(session.undo.pop())
    session.setText(session.undo[session.undo.length - 1])
    return true
  }

  // Moves the newest undone state back under the live text. An empty redo
  // stack consumes the action too, since there is no step to replay.
  function tryRedo() {
    if (!session) return false
    const value = session.redo.pop()
    if (value !== undefined) {
      session.undo.push(value)
      session.setText(value)
    }
    return true
  }

  return { begin, end, record, tryUndo, tryRedo }
}

// The one app-wide session. App.vue passes it to the menu deps, and
// NotesView.vue opens and closes it with each draft edit.
export const noteDraftUndo = createNoteDraftUndo()
