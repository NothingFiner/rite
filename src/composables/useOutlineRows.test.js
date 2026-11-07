import { describe, it, expect } from 'vitest'
import { outlineRows } from './useOutlineRows.js'

// The Outline tab's row model (SPEC.md 5.20, S-007 … S-009, S-011, S-013).
//
// The join is the whole point: `retrieve_summaries` skips sections it has no
// summary for, so its array alone cannot tell the outline what to show. These
// cases pin the document as the source of rows and the summaries as an
// attachment.

const paragraph = (id, text) => ({
  id,
  elements: [{ textRun: { content: text, textStyle: {} } }],
  leftIndent: null,
  rightIndent: null,
  firstLineIndent: null,
})

const section = (id, title, sectionType, extra = {}) => ({
  id,
  title,
  sectionType,
  hidden: false,
  paragraphs: [paragraph(`p-${id}`, `Prose for ${id}.`)],
  ...extra,
})

const doc = (sections) => ({
  title: 'Outline Novel',
  author: 'A',
  authorContact: '',
  hasTOC: false,
  sections,
})

/// The shape `retrieve_summaries` returns: manuscript order, only summarized
/// sections, with the render context Rust derives.
const entry = (sectionId, chapterIndex, title, sectionType, summary, stale = false) => ({
  sectionId,
  chapterIndex,
  title,
  sectionType,
  summary,
  stale,
})

const mixedDoc = doc([
  section('s1', 'Epigraph', 'section'),
  section('c1', 'The Arrival', 'chapter'),
  section('c2', '', 'chapter'),
  section('s2', 'Interlude', 'section', { hidden: true }),
])

describe('outlineRows', () => {
  it('S-007: lists every section in document order, including sections with no stored summary', () => {
    const rows = outlineRows(mixedDoc, [entry('c1', 1, 'The Arrival', 'chapter', 'The door opens.')])

    // s1, c2 and s2 have no summary and must still be rows. An outline with
    // holes in it is not the same thing as a short book.
    expect(rows.map((row) => row.sectionId)).toEqual(['s1', 'c1', 'c2', 's2'])
    expect(rows.map((row) => row.hasSummary)).toEqual([false, true, false, false])
  })

  it('S-008: names each row with sectionDisplayTitle, so a chapter with no subtitle reads "Chapter 1"', () => {
    const rows = outlineRows(mixedDoc, [])
    const byId = Object.fromEntries(rows.map((row) => [row.sectionId, row]))

    // c2 is the second Chapter and its stored title is '' (its subtitle).
    // Rendering that verbatim is the blank-row bug (B-003) one view over.
    expect(byId.c2.title).toBe('Chapter 2')
    expect(byId.c1.title).toBe('Chapter 1: The Arrival')
    // A Section keeps its own title. Front matter carries no chapter index.
    expect(byId.s1.title).toBe('Epigraph')
    expect(byId.s1.chapterIndex).toBe(null)
    expect(byId.c2.chapterIndex).toBe(2)
  })

  it("S-009: attaches each section's stored summary to its row", () => {
    const rows = outlineRows(mixedDoc, [
      entry('c1', 1, 'The Arrival', 'chapter', 'Mara arrives by night.'),
      entry('s2', 2, 'Interlude', 'section', 'A short breathing space.'),
    ])
    const byId = Object.fromEntries(rows.map((row) => [row.sectionId, row]))

    expect(byId.c1.summary).toBe('Mara arrives by night.')
    expect(byId.s2.summary).toBe('A short breathing space.')
    expect(byId.c2.summary).toBe('')
  })

  it('S-011: marks only the rows whose summary is stale', () => {
    const rows = outlineRows(mixedDoc, [
      entry('c1', 1, 'The Arrival', 'chapter', 'Fresh.', false),
      entry('s2', 2, 'Interlude', 'section', 'Drifted.', true),
    ])
    const byId = Object.fromEntries(rows.map((row) => [row.sectionId, row]))

    expect(byId.s2.stale).toBe(true)
    expect(byId.c1.stale).toBe(false)
    // No summary is not stale: there is nothing to be behind.
    expect(byId.c2.stale).toBe(false)
  })

  it('S-013: keeps a hidden section as a row, carrying the hidden flag', () => {
    const rows = outlineRows(mixedDoc, [])
    const hidden = rows.find((row) => row.sectionId === 's2')

    expect(hidden).toBeTruthy()
    expect(hidden.hidden).toBe(true)
    expect(rows.filter((row) => row.hidden)).toHaveLength(1)
  })

  it('S-007: tolerates an empty document and an empty summary store', () => {
    expect(outlineRows(doc([]), [])).toEqual([])
    expect(outlineRows(null, [])).toEqual([])
  })
})
