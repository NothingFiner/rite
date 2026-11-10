import { describe, it, expect } from 'vitest'
import {
  emptyReferences,
  addEntry,
  renameEntry,
  entryDisplayName,
  entriesForSurface,
  deriveMentions,
  excludeSection,
  includeSection,
  mergeEntries,
} from './useReferences.js'

// SPEC.md 5.19a's record and mention sentences: S-002, S-003, S-005, S-007,
// S-010 through S-015 and S-017. Pure helpers, no components.

const textStyle = { bold: false, italic: false, underline: false, fontSize: null }

const paragraph = (id, text) => ({
  id,
  elements: [{ textRun: { content: text, textStyle } }],
  leftIndent: null,
  rightIndent: null,
  firstLineIndent: null,
})

const section = (id, title, sectionType, paragraphs) => ({
  id,
  title,
  sectionType,
  hidden: false,
  paragraphs,
})

const doc = (sections) => ({ title: 'Novel', author: '', sections })

const referenceDoc = doc([
  section('c1', 'Chapter One', 'chapter', [paragraph('p1', 'Izildar Qualen met Izildar at the square.')]),
  section('s1', 'The Square', 'section', [paragraph('p2', 'Essidor Agjadoff spoke of the Ashfall.')]),
  section('c2', 'Chapter Two', 'chapter', [paragraph('p3', 'The square stayed empty.')]),
])

function withEntries(specs) {
  let references = emptyReferences()
  const ids = {}
  for (const [key, kind, name] of specs) {
    const created = addEntry(references, kind, name)
    expect(created.error).toBeNull()
    references = created.references
    ids[key] = created.entry.id
  }
  return { references, ids }
}

describe('reference entries', () => {
  it('S-002: keeps one flat record whose entries carry every field', () => {
    const { references, entry } = addEntry(emptyReferences(), 'character')

    expect(references.entries).toHaveLength(1)
    expect(entry).toMatchObject({
      kind: 'character',
      name: '',
      definition: '',
      aliases: [],
      tags: [],
      facts: [],
      includedSections: [],
      excludedSections: [],
    })
    expect(entry.id).toBeTruthy()
  })

  it('S-003: gives a place the same shape as a term', () => {
    const term = addEntry(emptyReferences(), 'term').entry
    const place = addEntry(emptyReferences(), 'place').entry

    expect(place.kind).toBe('place')
    expect(Object.keys(place).sort()).toEqual(Object.keys(term).sort())
  })

  it('S-005: lists characters on the Characters surface and terms and places on the Glossary', () => {
    const { references, ids } = withEntries([
      ['term', 'term', 'Ashfall'],
      ['character', 'character', 'Maren'],
      ['place', 'place', 'Qualen Square'],
    ])

    const characters = entriesForSurface(references, 'characters')
    expect(characters.map((entry) => entry.id)).toEqual([ids.character])

    const glossary = entriesForSurface(references, 'glossary')
    expect(glossary.map((entry) => entry.id).sort()).toEqual([ids.term, ids.place].sort())
  })

  it('S-007: creates an entry of the chosen kind and labels it Untitled until named', () => {
    const created = addEntry(emptyReferences(), 'term')

    expect(created.error).toBeNull()
    expect(created.entry.kind).toBe('term')
    expect(created.entry.name).toBe('')
    expect(entryDisplayName(created.entry)).toBe('Untitled term')

    const character = addEntry(emptyReferences(), 'character').entry
    expect(entryDisplayName(character)).toBe('Untitled character')

    const place = addEntry(emptyReferences(), 'place').entry
    expect(entryDisplayName(place)).toBe('Untitled place')
  })

  it('S-010: derives the sections an entry appears in from the manuscript text', () => {
    const { references, ids } = withEntries([['ashfall', 'term', 'Ashfall']])

    const mentions = deriveMentions(references, referenceDoc)

    expect(mentions[ids.ashfall].map((mention) => mention.sectionId)).toEqual(['s1'])
  })

  it('S-011: gives a mention to the longest matching name or alias', () => {
    const { references, ids } = withEntries([
      ['qualen', 'character', 'Izildar Qualen'],
      ['izildar', 'character', 'Izildar'],
    ])
    references.entries[0].aliases = ['Essidor Agjadoff']

    const mentions = deriveMentions(references, referenceDoc)

    // The full name belongs to the full-name entry; the bare name belongs to
    // the minor character, in the same section.
    expect(mentions[ids.qualen].map((mention) => mention.sectionId)).toEqual(['c1', 's1'])
    expect(mentions[ids.izildar].map((mention) => mention.sectionId)).toEqual(['c1'])

    // With only the full name present, the minor character has no mention.
    const onlyFullName = doc([
      section('c1', 'Chapter One', 'chapter', [paragraph('p1', 'Izildar Qualen waited.')]),
    ])
    const narrowed = deriveMentions(references, onlyFullName)
    expect(narrowed[ids.qualen].map((mention) => mention.sectionId)).toEqual(['c1'])
    expect(narrowed[ids.izildar]).toEqual([])
  })

  it('S-012: removes a derived mention by excluding its section, and keeps the exclusion', () => {
    const { references, ids } = withEntries([['ashfall', 'term', 'Ashfall']])

    const after = excludeSection(references, ids.ashfall, 's1')

    expect(after.entries[0].excludedSections).toEqual(['s1'])
    expect(references.entries[0].excludedSections).toEqual([])
    expect(deriveMentions(after, referenceDoc)[ids.ashfall]).toEqual([])
  })

  it('S-013: adds a section by hand and keeps the inclusion', () => {
    const { references, ids } = withEntries([['ashfall', 'term', 'Ashfall']])

    const after = includeSection(references, ids.ashfall, 'c2')

    expect(after.entries[0].includedSections).toEqual(['c2'])
    expect(references.entries[0].includedSections).toEqual([])
    const mentioned = deriveMentions(after, referenceDoc)[ids.ashfall]
    expect(mentioned.map((mention) => mention.sectionId)).toEqual(['s1', 'c2'])
  })

  it('S-014: merges two entries into the survivor, absorbing names, aliases, tags, facts and definition', () => {
    const { references, ids } = withEntries([
      ['qualen', 'character', 'Izildar Qualen'],
      ['essidor', 'character', 'Essidor Agjadoff'],
    ])
    const survivor = references.entries.find((entry) => entry.id === ids.qualen)
    survivor.definition = 'The historian who kept the record.'
    survivor.aliases = ['Qualen']
    survivor.tags = ['history']
    survivor.facts = [{ label: 'Wants', value: 'the record back' }]

    const absorbed = references.entries.find((entry) => entry.id === ids.essidor)
    absorbed.definition = 'A name he used in exile.'
    absorbed.aliases = ['Essidor']
    absorbed.tags = ['history', 'disguise']
    absorbed.facts = [{ label: 'Role', value: 'alias' }]

    const after = mergeEntries(references, ids.qualen, ids.essidor)

    expect(after.entries).toHaveLength(1)
    const merged = after.entries[0]
    expect(merged.id).toBe(ids.qualen)
    expect(merged.name).toBe('Izildar Qualen')
    expect(merged.definition).toBe('The historian who kept the record.')
    expect(merged.aliases.sort()).toEqual(['Essidor', 'Essidor Agjadoff', 'Qualen'])
    expect(merged.tags.sort()).toEqual(['disguise', 'history'])
    expect(merged.facts).toEqual([
      { label: 'Wants', value: 'the record back' },
      { label: 'Role', value: 'alias' },
    ])
  })

  it('S-014: takes the absorbed definition when the survivor has none', () => {
    const { references, ids } = withEntries([
      ['qualen', 'character', 'Izildar Qualen'],
      ['essidor', 'character', 'Essidor Agjadoff'],
    ])
    references.entries.find((entry) => entry.id === ids.essidor).definition = 'A name he used in exile.'

    const merged = mergeEntries(references, ids.qualen, ids.essidor).entries[0]

    expect(merged.definition).toBe('A name he used in exile.')
  })

  it('S-015: moves the merged entry’s inclusions and exclusions to the survivor and removes it', () => {
    const { references, ids } = withEntries([
      ['qualen', 'character', 'Izildar Qualen'],
      ['essidor', 'character', 'Essidor Agjadoff'],
    ])
    const survivor = references.entries.find((entry) => entry.id === ids.qualen)
    survivor.includedSections = ['c1']
    survivor.excludedSections = ['c2']

    const absorbed = references.entries.find((entry) => entry.id === ids.essidor)
    absorbed.includedSections = ['s1']
    absorbed.excludedSections = ['c1']

    const after = mergeEntries(references, ids.qualen, ids.essidor)

    expect(after.entries).toHaveLength(1)
    const merged = after.entries[0]
    expect(merged.includedSections.sort()).toEqual(['c1', 's1'])
    expect(merged.excludedSections.sort()).toEqual(['c1', 'c2'])
    expect(after.entries.some((entry) => entry.id === ids.essidor)).toBe(false)
  })

  it('S-017: refuses a name another entry owns and names the owner', () => {
    const { references, ids } = withEntries([['ashfall', 'term', 'Ashfall']])

    const taken = addEntry(references, 'term', 'ashfall')
    expect(taken.error).toEqual({
      code: 'name-taken',
      ownerId: ids.ashfall,
      ownerName: 'Ashfall',
    })
    expect(taken.references.entries).toHaveLength(1)

    const renamed = renameEntry(references, ids.ashfall, 'Ashfall')
    expect(renamed.error).toBeNull()

    const { references: two, ids: twoIds } = withEntries([
      ['ashfall', 'term', 'Ashfall'],
      ['grey', 'term', 'Grey Tide'],
    ])
    const clash = renameEntry(two, twoIds.grey, 'ASHFALL')
    expect(clash.error).toEqual({
      code: 'name-taken',
      ownerId: twoIds.ashfall,
      ownerName: 'Ashfall',
    })
    expect(clash.references.entries.find((entry) => entry.id === twoIds.grey).name).toBe('Grey Tide')
  })
})
