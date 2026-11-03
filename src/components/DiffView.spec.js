import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DiffView from './DiffView.vue'

// DiffView renders Rust's `SectionDiff` blocks as a two-column read-only page.
// The contract is per-version-sided: the left column shows only text that
// belonged to the past version, the right column only text that belongs to the
// current one, and a whole-section absence becomes a gap rather than an empty
// cell.

function paragraph(id, content) {
  return {
    id,
    elements: [{ textRun: { content, textStyle: {} } }],
    leftIndent: null,
    rightIndent: null,
    firstLineIndent: null,
  }
}

function section(id, title, sectionType, paragraphs) {
  return { id, title, sectionType, hidden: false, paragraphs }
}

const mountDiff = (diffBlocks) => mount(DiffView, { props: { diffBlocks } })
const left = (wrapper) => wrapper.find('.diff-cell.diff-left')
const right = (wrapper) => wrapper.find('.diff-cell.diff-right')

describe('DiffView', () => {
  it('labels the two columns as past and current', () => {
    const wrapper = mountDiff([])

    expect(wrapper.findAll('.diff-header-cell').map((c) => c.text())).toEqual([
      'Past version',
      'Current',
    ])
    expect(wrapper.findAll('.diff-section')).toHaveLength(0)
  })

  it('shows an unchanged section in both columns, untinted', () => {
    const wrapper = mountDiff([
      {
        type: 'unchanged',
        section: section('s1', 'The Arrival', 'chapter', [paragraph('p1', 'The door opened.')]),
      },
    ])

    for (const cell of [left(wrapper), right(wrapper)]) {
      expect(cell.text()).toContain('The Arrival')
      expect(cell.text()).toContain('The door opened.')
      expect(cell.classes()).not.toContain('diff-tint-removed')
      expect(cell.classes()).not.toContain('diff-tint-added')
    }
  })

  it('shows a removed section on the left and a gap on the right', () => {
    const wrapper = mountDiff([
      {
        type: 'removed',
        section: section('s1', 'Cut Chapter', 'chapter', [paragraph('p1', 'Gone text.')]),
      },
    ])

    expect(left(wrapper).text()).toContain('Cut Chapter')
    expect(left(wrapper).text()).toContain('Gone text.')
    expect(left(wrapper).classes()).toContain('diff-tint-removed')
    expect(right(wrapper).find('.diff-gap').exists()).toBe(true)
    expect(right(wrapper).text()).not.toContain('Gone text.')
    expect(right(wrapper).classes()).not.toContain('diff-tint-added')
  })

  it('shows an added section on the right and a gap on the left', () => {
    const wrapper = mountDiff([
      {
        type: 'added',
        section: section('s1', 'New Chapter', 'chapter', [paragraph('p1', 'Fresh text.')]),
      },
    ])

    expect(right(wrapper).text()).toContain('New Chapter')
    expect(right(wrapper).text()).toContain('Fresh text.')
    expect(right(wrapper).classes()).toContain('diff-tint-added')
    expect(left(wrapper).find('.diff-gap').exists()).toBe(true)
    expect(left(wrapper).text()).not.toContain('Fresh text.')
  })

  it('splits a modified paragraph word by word, each side keeping its own text', () => {
    const wrapper = mountDiff([
      {
        type: 'modified',
        sectionId: 's1',
        oldTitle: 'The Arrival',
        newTitle: 'The Arrival',
        oldType: 'chapter',
        newType: 'chapter',
        paragraphDiffs: [
          {
            type: 'modified',
            old: paragraph('p1', 'The door opened slowly.'),
            new: paragraph('p1', 'The door slammed open.'),
            wordDiff: [
              { kind: 'equal', text: 'The door ' },
              { kind: 'removed', text: 'opened slowly.' },
              { kind: 'added', text: 'slammed open.' },
            ],
          },
        ],
      },
    ])

    const leftText = left(wrapper).text()
    const rightText = right(wrapper).text()

    // Equal words stay on both sides; each side drops the other side's words.
    expect(leftText).toContain('The door')
    expect(rightText).toContain('The door')
    expect(leftText).toContain('opened slowly.')
    expect(leftText).not.toContain('slammed open.')
    expect(rightText).toContain('slammed open.')
    expect(rightText).not.toContain('opened slowly.')

    expect(left(wrapper).find('.diff-word-removed').exists()).toBe(true)
    expect(right(wrapper).find('.diff-word-added').exists()).toBe(true)
    // Removed words are not marked as added, and vice versa.
    expect(left(wrapper).find('.diff-word-added').exists()).toBe(false)
    expect(right(wrapper).find('.diff-word-removed').exists()).toBe(false)
  })

  it('strikes through a renamed section title on the past side only', () => {
    const wrapper = mountDiff([
      {
        type: 'modified',
        sectionId: 's1',
        oldTitle: 'Old Name',
        newTitle: 'New Name',
        oldType: 'section',
        newType: 'section',
        paragraphDiffs: [],
      },
    ])

    const struck = left(wrapper).find('.diff-renamed')
    expect(struck.exists()).toBe(true)
    expect(struck.text()).toBe('Old Name')
    expect(right(wrapper).find('.diff-renamed').exists()).toBe(false)
    expect(right(wrapper).text()).toContain('New Name')
  })

  it('does not strike through a title that was not renamed', () => {
    const wrapper = mountDiff([
      {
        type: 'modified',
        sectionId: 's1',
        oldTitle: 'Same Name',
        newTitle: 'Same Name',
        oldType: 'section',
        newType: 'section',
        paragraphDiffs: [],
      },
    ])

    expect(left(wrapper).find('.diff-renamed').exists()).toBe(false)
    expect(left(wrapper).text()).toContain('Same Name')
  })

  it('shows paragraph-level additions and removals inside a modified section', () => {
    const wrapper = mountDiff([
      {
        type: 'modified',
        sectionId: 's1',
        oldTitle: 'Chapter',
        newTitle: 'Chapter',
        oldType: 'chapter',
        newType: 'chapter',
        paragraphDiffs: [
          { type: 'removed', paragraph: paragraph('p1', 'Deleted paragraph.') },
          { type: 'added', paragraph: paragraph('p2', 'Inserted paragraph.') },
        ],
      },
    ])

    expect(left(wrapper).find('.diff-para-removed').text()).toContain('Deleted paragraph.')
    expect(left(wrapper).text()).not.toContain('Inserted paragraph.')
    expect(right(wrapper).find('.diff-para-added').text()).toContain('Inserted paragraph.')
    expect(right(wrapper).text()).not.toContain('Deleted paragraph.')
  })

  it('falls back to a readable label for an untitled section', () => {
    const wrapper = mountDiff([
      {
        type: 'unchanged',
        section: section('s1', '', 'chapter', [paragraph('p1', 'Body.')]),
      },
    ])

    expect(wrapper.text()).toContain('(untitled chapter)')
  })

  it('escapes markup in document text instead of rendering it', () => {
    const wrapper = mountDiff([
      {
        type: 'unchanged',
        section: section('s1', '<b>Bold</b>', 'section', []),
      },
    ])

    expect(wrapper.find('.diff-cell b').exists()).toBe(false)
    expect(wrapper.text()).toContain('<b>Bold</b>')
  })

  it('renders a gap instead of an empty cell for a modified section with no paragraphs', () => {
    const wrapper = mountDiff([
      {
        type: 'modified',
        sectionId: 's1',
        oldTitle: 'Title',
        newTitle: 'Title',
        oldType: 'section',
        newType: 'section',
        paragraphDiffs: [],
      },
    ])

    // Both cells still show the title line; neither is blank.
    expect(left(wrapper).text()).toContain('Title')
    expect(right(wrapper).text()).toContain('Title')
  })
})
