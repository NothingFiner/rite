import { describe, it, expect } from 'vitest'
import {
  flattenSections,
  groupBlocks,
  computeFirstLineIndent,
} from './useSectionBlocks.js'
import { isEmptyParagraph } from '../constants/ParagraphStyle.js'

function section(id, title, sectionType, paragraphs) {
  return { id, title, sectionType, paragraphs }
}
function para(id, content = '') {
  return { id, elements: [{ textRun: { content, textStyle: {} } }], leftIndent: null, rightIndent: null, firstLineIndent: null }
}

describe('flattenSections', () => {
  it('emits a section-title block then that section\'s paragraph blocks, in order', () => {
    const blocks = flattenSections([
      section('s1', 'A', 'section', [para('p1'), para('p2')]),
      section('s2', 'B', 'chapter', [para('p3')]),
    ])
    expect(blocks).toHaveLength(5)
    expect(blocks.map(b => b.kind)).toEqual([
      'section-title', 'paragraph', 'paragraph',
      'section-title', 'paragraph',
    ])
    expect(blocks[0]).toMatchObject({ kind: 'section-title', sectionId: 's1', sectionType: 'section', title: 'A' })
    expect(blocks[1]).toMatchObject({ kind: 'paragraph', sectionId: 's1', paragraphId: 'p1' })
    expect(blocks[3]).toMatchObject({ kind: 'section-title', sectionId: 's2', sectionType: 'chapter' })
  })

  it('derives chapterIndex as the 1-based position among chapter sections only', () => {
    const blocks = flattenSections([
      section('s1', '', 'section', [para('p1')]),
      section('s2', '', 'chapter', [para('p2')]),
      section('s3', '', 'section', [para('p3')]),
      section('s4', '', 'chapter', [para('p4')]),
    ])
    expect(blocks[0].chapterIndex).toBeNull()   // s1 section
    expect(blocks[2].chapterIndex).toBe(1)      // s2 chapter 1
    expect(blocks[4].chapterIndex).toBeNull()   // s3 section
    expect(blocks[6].chapterIndex).toBe(2)      // s4 chapter 2
  })

  it('emits a section-title block even when the section has no paragraphs', () => {
    const blocks = flattenSections([section('s1', 'A', 'section', [])])
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('section-title')
  })
})

describe('groupBlocks', () => {
  it('rebuilds sections from a flat block list, preserving ids, types, titles, paragraph order', () => {
    const blocks = [
      { kind: 'section-title', sectionId: 's1', sectionType: 'section', title: 'A' },
      { kind: 'paragraph', sectionId: 's1', paragraphId: 'p1', paragraph: para('p1', 'one') },
      { kind: 'paragraph', sectionId: 's1', paragraphId: 'p2', paragraph: para('p2', 'two') },
      { kind: 'section-title', sectionId: 's2', sectionType: 'chapter', title: 'B' },
      { kind: 'paragraph', sectionId: 's2', paragraphId: 'p3', paragraph: para('p3', 'three') },
    ]
    const sections = groupBlocks(blocks)
    expect(sections).toHaveLength(2)
    expect(sections[0]).toMatchObject({ id: 's1', sectionType: 'section', title: 'A' })
    expect(sections[0].paragraphs.map(p => p.id)).toEqual(['p1', 'p2'])
    expect(sections[1]).toMatchObject({ id: 's2', sectionType: 'chapter', title: 'B' })
    expect(sections[1].paragraphs.map(p => p.id)).toEqual(['p3'])
  })

  it('gathers paragraphs that appear before any section-title into a synthetic leading section', () => {
    const blocks = [
      { kind: 'paragraph', sectionId: undefined, paragraphId: 'p0', paragraph: para('p0', 'orphan') },
      { kind: 'section-title', sectionId: 's1', sectionType: 'section', title: 'A' },
      { kind: 'paragraph', sectionId: 's1', paragraphId: 'p1', paragraph: para('p1') },
    ]
    const sections = groupBlocks(blocks)
    expect(sections).toHaveLength(2)
    expect(sections[0].paragraphs[0].id).toBe('p0')
    expect(sections[1].id).toBe('s1')
  })

  it('preserves an empty section (title block with no following paragraphs)', () => {
    const blocks = [
      { kind: 'section-title', sectionId: 's1', sectionType: 'section', title: 'A' },
      { kind: 'section-title', sectionId: 's2', sectionType: 'section', title: 'B' },
    ]
    const sections = groupBlocks(blocks)
    expect(sections).toHaveLength(2)
    expect(sections[0].paragraphs).toEqual([])
    expect(sections[1].id).toBe('s2')
  })

  it('is a round-trip inverse of flattenSections (ids, types, titles, paragraph order)', () => {
    const original = [
      section('s1', 'Intro', 'section', [para('p1'), para('p2')]),
      section('s2', 'One', 'chapter', [para('p3')]),
      section('s3', 'Two', 'chapter', [para('p4'), para('p5')]),
    ]
    const rebuilt = groupBlocks(flattenSections(original))
    expect(rebuilt).toHaveLength(3)
    for (let i = 0; i < 3; i++) {
      expect(rebuilt[i].id).toBe(original[i].id)
      expect(rebuilt[i].title).toBe(original[i].title)
      expect(rebuilt[i].sectionType).toBe(original[i].sectionType)
      expect(rebuilt[i].paragraphs.map(p => p.id)).toEqual(original[i].paragraphs.map(p => p.id))
    }
  })
})

describe('computeFirstLineIndent', () => {
  it('indents 0 for the first block of the list', () => {
    const blocks = [{ kind: 'paragraph', paragraph: para('p1', 'x') }]
    expect(computeFirstLineIndent(blocks, 0)).toBe(0)
  })

  it('indents 0 for the first paragraph of a section (preceded by a section-title)', () => {
    const blocks = [
      { kind: 'section-title', sectionId: 's1', sectionType: 'section', title: 'A' },
      { kind: 'paragraph', paragraph: para('p1', 'x') },
    ]
    expect(computeFirstLineIndent(blocks, 1)).toBe(0)
  })

  it('indents 0 right after an empty paragraph (scene break / spacer)', () => {
    const blocks = [
      { kind: 'paragraph', paragraph: para('p1', 'before') },
      { kind: 'paragraph', paragraph: para('p2', '') }, // empty
      { kind: 'paragraph', paragraph: para('p3', 'after') },
    ]
    expect(isEmptyParagraph(blocks[1].paragraph)).toBe(true)
    expect(computeFirstLineIndent(blocks, 2)).toBe(0)
  })

  it('indents 0.5 for a normal middle paragraph', () => {
    const blocks = [
      { kind: 'section-title', sectionId: 's1', sectionType: 'section', title: 'A' },
      { kind: 'paragraph', paragraph: para('p1', 'first in section') },
      { kind: 'paragraph', paragraph: para('p2', 'second in section') },
    ]
    expect(computeFirstLineIndent(blocks, 2)).toBe(0.5)
  })
})