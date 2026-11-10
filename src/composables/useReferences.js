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
  return { entries: [] }
}

/// Append an entry of `kind`. Refuses a name another entry owns; returns
/// `{ references, entry, error }`. `error` is null or
/// `{ code: 'name-taken', ownerId, ownerName }`.
export function addEntry(references, kind, name = '') {
  const owner = nameOwner(references, name)
  if (owner) {
    return {
      references,
      entry: null,
      error: { code: 'name-taken', ownerId: owner.id, ownerName: owner.name },
    }
  }
  const entry = {
    id: freshEntryId(),
    kind,
    name,
    definition: '',
    aliases: [],
    tags: [],
    facts: [],
    includedSections: [],
    excludedSections: [],
  }
  const entries = Array.isArray(references?.entries) ? references.entries : []
  // The caller swaps the record in, so the input record stays untouched.
  return { references: { ...references, entries: [...entries, entry] }, entry, error: null }
}

/// Rename an entry. Refuses a name another entry owns; returns
/// `{ references, error }` with the same error shape as `addEntry`.
export function renameEntry(references, entryId, name) {
  throw new Error('not implemented')
}

/// The row label: the name, or `Untitled term` / `Untitled character` /
/// `Untitled place` until it is named.
export function entryDisplayName(entry) {
  // A whitespace-only name still counts as unnamed, as in `nameOwner`.
  if (entry?.name?.trim()) return entry.name
  const kind = entry?.kind ?? ''
  return `Untitled ${kind.charAt(0).toUpperCase()}${kind.slice(1)}`
}

/// The rows a surface lists: `characters` shows characters; `glossary` shows
/// terms and places.
export function entriesForSurface(references, surface) {
  const entries = Array.isArray(references?.entries) ? references.entries : []
  if (surface === 'characters') return entries.filter((entry) => entry.kind === 'character')
  if (surface === 'glossary') {
    return entries.filter((entry) => entry.kind === 'term' || entry.kind === 'place')
  }
  return []
}

/// The entry that owns `name`, case-insensitively, or null. `exceptId` lets a
/// rename keep its own name.
export function nameOwner(references, name, exceptId = null) {
  const wanted = name.trim().toLowerCase()
  if (!wanted) return null
  const entries = Array.isArray(references?.entries) ? references.entries : []
  const found = entries.find((entry) => {
    return entry.id !== exceptId && (entry.name ?? '').trim().toLowerCase() === wanted
  })
  return found ?? null
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
/// merged entry is removed. Returns the new record directly. The input record
/// and its entries stay untouched.
export function mergeEntries(references, survivorId, mergedId) {
  const entries = Array.isArray(references?.entries) ? references.entries : []
  if (!survivorId || !mergedId) return references
  const survivor = entries.find((entry) => entry.id === survivorId)
  const absorbed = entries.find((entry) => entry.id === mergedId)
  // A self-merge has nothing to absorb, and the removal step would delete the survivor.
  if (!survivor || !absorbed || survivor === absorbed) return references

  const definition = survivor.definition?.trim()
    ? survivor.definition
    : (absorbed.definition ?? '')

  const aliasKeys = new Set()
  const aliases = []
  // Alias identity is the trimmed lowercase key the nameOwner comparison uses.
  // A blank names nothing and the first spelling wins.
  const absorbAlias = (value) => {
    const key = (value ?? '').trim().toLowerCase()
    if (!key || aliasKeys.has(key)) return
    aliasKeys.add(key)
    aliases.push(value)
  }
  for (const alias of survivor.aliases ?? []) absorbAlias(alias)
  absorbAlias(absorbed.name)
  for (const alias of absorbed.aliases ?? []) absorbAlias(alias)

  const facts = []
  const factKeys = new Set()
  const absorbFact = (fact) => {
    if (!fact) return
    // A fact's identity is the label and value together, so a shared label or
    // value alone does not dedupe two facts.
    const key = JSON.stringify([fact.label ?? '', fact.value ?? ''])
    if (factKeys.has(key)) return
    factKeys.add(key)
    facts.push(fact)
  }
  for (const fact of survivor.facts ?? []) absorbFact(fact)
  for (const fact of absorbed.facts ?? []) absorbFact(fact)

  const mergedEntry = {
    ...survivor,
    definition,
    aliases,
    tags: uniqueValues(survivor.tags, absorbed.tags),
    facts,
    includedSections: uniqueValues(survivor.includedSections, absorbed.includedSections),
    excludedSections: uniqueValues(survivor.excludedSections, absorbed.excludedSections),
  }
  return {
    ...references,
    entries: entries
      .map((entry) => (entry === survivor ? mergedEntry : entry))
      .filter((entry) => entry !== absorbed),
  }
}

// Unioned value list for `mergeEntries` fields: blank values dropped, exact
// duplicates dropped, first occurrence kept.
function uniqueValues(first, second) {
  const seen = new Set()
  const values = []
  for (const value of [...(first ?? []), ...(second ?? [])]) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    values.push(value)
  }
  return values
}

// A fresh id for a new entry. jsdom may not expose `crypto.randomUUID`, so the
// fallback pairs `Date.now()` with a counter, which stays unique in one session.
let idCounter = 0
function freshEntryId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  idCounter += 1
  return `r-${Date.now()}-${idCounter}`
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
