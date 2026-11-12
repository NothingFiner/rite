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
/// `{ references, error }` with the same error shape as `addEntry`. A refusal
/// or a missing entry returns the input record unchanged.
export function renameEntry(references, entryId, name) {
  const entries = Array.isArray(references?.entries) ? references.entries : []
  const target = entries.find((entry) => entry.id === entryId)
  if (!target) return { references, error: null }
  // nameOwner reads `name.trim()` directly, so a null new name needs the
  // empty fallback.
  const owner = nameOwner(references, name ?? '', entryId)
  if (owner) {
    return {
      references,
      error: { code: 'name-taken', ownerId: owner.id, ownerName: owner.name },
    }
  }
  return {
    references: {
      ...references,
      entries: entries.map((entry) => (entry === target ? { ...entry, name } : entry)),
    },
    error: null,
  }
}

/// The row label: the name, or `Untitled term` / `Untitled character` /
/// `Untitled place` until it is named.
export function entryDisplayName(entry) {
  // A whitespace-only name still counts as unnamed, as in `nameOwner`.
  if (entry?.name?.trim()) return entry.name
  const kind = entry?.kind ?? ''
  return `Untitled ${kind}`
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

/// Append a trimmed alias to an entry and return a new record. Returns the
/// input record unchanged for a blank alias, a missing entry, or a key an
/// existing alias already holds. An alias is its trimmed lowercase key, the
/// identity `absorbAlias` and `entryScanTerms` dedupe spellings on.
export function addAlias(references, entryId, alias) {
  const value = (alias ?? '').trim()
  const entries = Array.isArray(references?.entries) ? references.entries : []
  const target = entries.find((entry) => entry.id === entryId)
  if (!value || !target) return references
  const key = aliasKey(value)
  const existing = Array.isArray(target.aliases) ? target.aliases : []
  if (existing.some((stored) => aliasKey(stored) === key)) return references
  const updated = { ...target, aliases: [...existing, value] }
  return { ...references, entries: entries.map((entry) => (entry === target ? updated : entry)) }
}

/// Remove every alias spelling whose key matches and return a new record.
/// Refusals mirror `addAlias`: a blank alias, a missing entry or an absent
/// key returns the input unchanged. All spellings drop, so removing one
/// casing clears a case-only duplicate.
export function removeAlias(references, entryId, alias) {
  const key = aliasKey(alias)
  const entries = Array.isArray(references?.entries) ? references.entries : []
  const target = entries.find((entry) => entry.id === entryId)
  if (!key || !target) return references
  const existing = Array.isArray(target.aliases) ? target.aliases : []
  if (!existing.some((stored) => aliasKey(stored) === key)) return references
  const updated = { ...target, aliases: existing.filter((stored) => aliasKey(stored) !== key) }
  return { ...references, entries: entries.map((entry) => (entry === target ? updated : entry)) }
}

/// Switch an entry between term and place. Returns the plain record. Only
/// those two kinds are accepted: a character cannot move to another surface
/// (SPEC.md 5.20). A refused kind or a missing entry returns the input
/// record unchanged.
export function setEntryKind(references, entryId, kind) {
  if (kind !== 'term' && kind !== 'place') return references
  const entries = Array.isArray(references?.entries) ? references.entries : []
  const target = entries.find((entry) => entry.id === entryId)
  if (!target) return references
  return {
    ...references,
    entries: entries.map((entry) => (entry === target ? { ...entry, kind } : entry)),
  }
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
  const entries = Array.isArray(references?.entries) ? references.entries : []
  const mentions = new Map(entries.map((entry) => [entry.id, []]))
  for (const { section, chapterIndex } of sectionsWithChapterIndex(doc)) {
    const matched = mentionedEntryIds(entries, section)
    for (const entry of entries) {
      if ((entry?.excludedSections ?? []).includes(section.id)) continue
      const included = (entry?.includedSections ?? []).includes(section.id)
      if (!included && !matched.has(entry.id)) continue
      mentions.get(entry.id).push({
        sectionId: section.id,
        chapterIndex,
        title: mentionTitle(section, chapterIndex),
      })
    }
  }
  return Object.fromEntries(mentions)
}

/// Remove a derived mention by excluding its section. Returns a new record,
/// or the input unchanged when the section is already excluded or the entry
/// is missing.
export function excludeSection(references, entryId, sectionId) {
  const entries = Array.isArray(references?.entries) ? references.entries : []
  const target = entries.find((entry) => entry.id === entryId)
  const excluded = Array.isArray(target?.excludedSections) ? target.excludedSections : []
  if (!target || !sectionId || excluded.includes(sectionId)) return references
  const updated = { ...target, excludedSections: [...excluded, sectionId] }
  return { ...references, entries: entries.map((entry) => (entry === target ? updated : entry)) }
}

/// Add a section to an entry's appears-in list by hand. Returns a new record,
/// or the input unchanged when the section is already included or the entry
/// is missing. The addition drops the section from `excludedSections` too,
/// because `deriveMentions` refuses an excluded section before it reads
/// inclusions, so the mention row would never return.
export function includeSection(references, entryId, sectionId) {
  const entries = Array.isArray(references?.entries) ? references.entries : []
  const target = entries.find((entry) => entry.id === entryId)
  const included = Array.isArray(target?.includedSections) ? target.includedSections : []
  if (!target || !sectionId || included.includes(sectionId)) return references
  const excluded = Array.isArray(target?.excludedSections) ? target.excludedSections : []
  const updated = {
    ...target,
    includedSections: [...included, sectionId],
    excludedSections: excluded.filter((id) => id !== sectionId),
  }
  return { ...references, entries: entries.map((entry) => (entry === target ? updated : entry)) }
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

// Names an alias spelling the way `absorbAlias` and `entryScanTerms` do:
// trimmed and lowercase.
function aliasKey(value) {
  return (value ?? '').trim().toLowerCase()
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

/// The entry ids whose name or alias appears in `section`, after the
/// longest-match arbitration the `deriveMentions` contract defines.
function mentionedEntryIds(entries, section) {
  const claimed = []
  const mentioned = new Set()
  for (const paragraph of Array.isArray(section?.paragraphs) ? section.paragraphs : []) {
    const text = paragraphContent(paragraph)
    const candidates = []
    for (const entry of entries) {
      for (const term of entryScanTerms(entry)) {
        for (const span of termSpans(text, term)) {
          candidates.push({ entryId: entry.id, ...span, length: term.length })
        }
      }
    }
    // The longest claim sorts first, and a candidate overlapping a claimed span
    // drops, so the full name wins the shared text.
    candidates.sort((a, b) => b.length - a.length || a.start - b.start)
    for (const candidate of candidates) {
      const overlaps = claimed.some((span) => candidate.start < span.end && candidate.end > span.start)
      if (overlaps) continue
      claimed.push(candidate)
      mentioned.add(candidate.entryId)
    }
  }
  return mentioned
}

/// The strings that name `entry` in prose: its name first, then its aliases,
/// deduped like `absorbAlias` so a repeated spelling scans once.
function entryScanTerms(entry) {
  const terms = []
  const seen = new Set()
  for (const value of [entry?.name, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])]) {
    const key = (value ?? '').trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    terms.push(value.trim())
  }
  return terms
}

/// The whole-word start/end spans of `term` in `text`, case-insensitive as
/// `nameOwner` treats names in this file.
function termSpans(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const spans = []
  for (const match of text.matchAll(new RegExp(`\\b${escaped}\\b`, 'gi'))) {
    spans.push({ start: match.index, end: match.index + match[0].length })
  }
  return spans
}

/// The prose a paragraph contributes, flattened the way `useChat.js` reads it.
function paragraphContent(paragraph) {
  return (paragraph?.elements ?? [])
    .map((element) => element?.textRun?.content ?? '')
    .join('')
}
