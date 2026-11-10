// Reference entry helpers (SPEC.md 5.19a).
//
// One flat record with a kind — `term`, `character` or `place`. Entries are
// authored source. Where an entry appears is derived from the manuscript and is
// never stored; `includedSections` and `excludedSections` are the writer's
// manual corrections and those are source.
//
// The record shape:
//   { entries: [ { id, kind, name, definition, aliases, tags, facts,
//                   includedSections, excludedSections } ] }

import { sectionDisplayTitle } from './useSectionFormat.js'

export function emptyReferences() {
  throw new Error('not implemented')
}

/// Append an entry of `kind`. Refuses a name another entry owns; returns
/// `{ references, entry, error }`. `error` is null or
/// `{ code: 'name-taken', ownerId, ownerName }`.
export function addEntry(references, kind, name = '') {
  throw new Error('not implemented')
}

/// Rename an entry. Refuses a name another entry owns; returns
/// `{ references, error }` with the same error shape as `addEntry`.
export function renameEntry(references, entryId, name) {
  throw new Error('not implemented')
}

/// The row label: the name, or `Untitled term` / `Untitled character` /
/// `Untitled place` until it is named.
export function entryDisplayName(entry) {
  throw new Error('not implemented')
}

/// The rows a surface lists: `characters` shows characters; `glossary` shows
/// terms and places.
export function entriesForSurface(references, surface) {
  throw new Error('not implemented')
}

/// The entry that owns `name`, case-insensitively, or null. `exceptId` lets a
/// rename keep its own name.
export function nameOwner(references, name, exceptId = null) {
  throw new Error('not implemented')
}

/// Derived mentions for every entry, keyed by entry id. Each mention is
/// `{ sectionId, chapterIndex, title }` in document order. A mention belongs to
/// the longest matching name or alias, so `Izildar Qualen` is not also
/// `Izildar`. Excluded sections are dropped; included sections are added.
export function deriveMentions(references, doc) {
  throw new Error('not implemented')
}

/// Remove a derived mention by excluding its section. Returns a new record.
export function excludeSection(references, entryId, sectionId) {
  throw new Error('not implemented')
}

/// Add a section to an entry's appears-in list by hand. Returns a new record.
export function includeSection(references, entryId, sectionId) {
  throw new Error('not implemented')
}

/// Merge `mergedId` into `survivorId`: the survivor keeps its name, absorbs the
/// other's name and aliases, unions tags and facts, keeps its non-empty
/// definition, and takes over the other's inclusions and exclusions. The
/// merged entry is removed.
export function mergeEntries(references, survivorId, mergedId) {
  throw new Error('not implemented')
}

/// Shared by `deriveMentions`: pairs sections with their render-derived chapter
/// index, the walk `useNotes.js` uses.
export function sectionsWithChapterIndex(doc) {
  const sections = Array.isArray(doc?.sections) ? doc.sections : []
  let chapterIndex = 0
  return sections.map((section) => {
    if (section.sectionType === 'chapter') chapterIndex += 1
    return {
      section,
      chapterIndex: section.sectionType === 'chapter' ? chapterIndex : null,
    }
  })
}

/// A section's display title, for a mention row.
export function mentionTitle(section, chapterIndex) {
  return sectionDisplayTitle(section, chapterIndex)
}
