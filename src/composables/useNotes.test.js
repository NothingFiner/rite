import { describe, it, expect } from 'vitest'
import {
  emptyNotes,
  noteEntries,
  notesToText,
  orphanSectionNote,
} from './useNotes.js'

// Sentences for the record translations: entry order (S-001), the assistant
// context (S-009) and orphaning a deleted section's note (S-007).

const sections = [
  { id: 'c1', title: 'Chapter One', sectionType: 'chapter', paragraphs: [] },
  { id: 's1', title: 'The Door', sectionType: 'section', paragraphs: [] },
  { id: 'c2', title: 'Chapter Two', sectionType: 'chapter', paragraphs: [] },
  { id: 's2', title: 'Ashes', sectionType: 'section', paragraphs: [] },
]

const doc = { sections }

describe('noteEntries', () => {
  it('S-001: lists the overview first, the sections in document order, and the orphaned entry last', () => {
    const entries = noteEntries(doc)

    expect(entries.map((entry) => entry.id)).toEqual([
      'overview',
      'c1',
      's1',
      'c2',
      's2',
      'orphaned',
    ])
  })

  it('S-001: distinguishes chapter rows from section rows', () => {
    const kinds = Object.fromEntries(noteEntries(doc).map((entry) => [entry.id, entry.kind]))

    expect(kinds).toEqual({
      overview: 'overview',
      c1: 'chapter',
      s1: 'section',
      c2: 'chapter',
      s2: 'section',
      orphaned: 'orphaned',
    })
  })
})

describe('notesToText', () => {
  it('S-009: states that the notes are author notes rather than manuscript prose', () => {
    const text = notesToText(emptyNotes(), sections)
    const preamble = text.split('\n').slice(0, 4).join(' ')

    expect(preamble).toMatch(/author/i)
    expect(preamble).toMatch(/note/i)
    expect(preamble).toMatch(/manuscript/i)
    expect(preamble).toMatch(/not|rather than/i)
  })

  it('S-009: includes the overview and every non-empty section note in document order', () => {
    const notes = {
      overview: 'The story turns on a letter.',
      sections: {
        s1: 'The door is a lie.',
        s2: 'Ashes close the loop.',
        c1: '',
        c2: '   ',
      },
      orphaned: 'A note about a deleted scene.',
    }

    const text = notesToText(notes, sections)

    expect(text).toContain('The story turns on a letter.')
    expect(text).toContain('The Door')
    expect(text).toContain('The door is a lie.')
    expect(text).toContain('Ashes')
    expect(text).toContain('Ashes close the loop.')

    const overviewAt = text.indexOf('The story turns on a letter.')
    const doorAt = text.indexOf('The door is a lie.')
    const ashesAt = text.indexOf('Ashes close the loop.')
    expect(overviewAt).toBeLessThan(doorAt)
    expect(doorAt).toBeLessThan(ashesAt)
  })

  it('S-009: omits empty notes and the orphaned draft', () => {
    const notes = {
      overview: 'Overview only.',
      sections: { s1: 'A note.', c1: '' },
      orphaned: 'A draft about text that no longer exists.',
    }

    const text = notesToText(notes, sections)

    expect(text).toContain('A note.')
    expect(text).not.toContain('A draft about text that no longer exists.')
  })
})

describe('orphanSectionNote', () => {
  it('S-007: appends the deleted note under the deleted section title and removes the section key', () => {
    const notes = {
      overview: '',
      sections: { s1: 'The door is a lie.', s2: 'Ashes close the loop.' },
      orphaned: '',
    }

    const after = orphanSectionNote(notes, { id: 's1', title: 'The Door' })

    expect(after.orphaned).toContain('The Door')
    expect(after.orphaned).toContain('The door is a lie.')
    expect(after.sections.s1).toBeUndefined()
    expect(after.sections.s2).toBe('Ashes close the loop.')
  })

  it('S-007: puts every deleted section into the one orphaned draft, in deletion order', () => {
    const first = orphanSectionNote(
      { overview: '', sections: { s1: 'First note.', s2: 'Second note.' }, orphaned: '' },
      { id: 's1', title: 'One' },
    )
    const second = orphanSectionNote(first, { id: 's2', title: 'Two' })

    expect(second.orphaned).toContain('One')
    expect(second.orphaned).toContain('First note.')
    expect(second.orphaned).toContain('Two')
    expect(second.orphaned.indexOf('One')).toBeLessThan(second.orphaned.indexOf('Two'))
  })
})
