import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import DiffView from './DiffView.vue'

// Navigation between the changes of a history diff (SPEC.md 5.12, S-001 … S-012
// and S-016). `e2e/history-diff-nav.spec.js` carries the end-to-end sentences,
// S-013 … S-015 and S-017.
//
// A change is a row, because the diff renders one row per paragraph. Each stop
// needs an element to mark and to scroll to. These tests read the rows through
// `data-change-index` and `data-current-change`, so the implementation may
// compute targets however it likes.

function paragraph(id, content) {
  return {
    id,
    elements: [{ textRun: { content, textStyle: {} } }],
    leftIndent: null,
    rightIndent: null,
    firstLineIndent: null,
  }
}

function section(id, title, paragraphs) {
  return { id, title, sectionType: 'chapter', hidden: false, paragraphs }
}

const unchanged = (s) => ({ type: 'unchanged', section: s })
const added = (s) => ({ type: 'added', section: s })
const removed = (s) => ({ type: 'removed', section: s })

function modified(oldTitle, newTitle, paragraphDiffs) {
  return {
    type: 'modified',
    sectionId: 's-x',
    oldTitle,
    newTitle,
    oldType: 'chapter',
    newType: 'chapter',
    paragraphDiffs,
  }
}

function changedParagraph(id, text) {
  return {
    type: 'modified',
    old: paragraph(id, `${text} before`),
    new: paragraph(id, `${text} after`),
    wordDiff: [
      { kind: 'equal', text: `${text} ` },
      { kind: 'removed', text: 'before' },
      { kind: 'added', text: 'after' },
    ],
  }
}

const untouchedParagraph = (id, text) => ({ type: 'unchanged', paragraph: paragraph(id, text) })

function diffWithChanges() {
  return [
    unchanged(section('s-1', 'Chapter One', [paragraph('p-1', 'Untouched opening.')])),
    modified('Chapter Two', 'Chapter Two', [
      untouchedParagraph('p-2a', 'Untouched middle.'),
      changedParagraph('p-2b', 'First'),
      changedParagraph('p-2c', 'Second'),
      untouchedParagraph('p-2d', 'Untouched again.'),
      changedParagraph('p-2e', 'Third'),
    ]),
  ]
}

const mountDiff = (diffBlocks) => mount(DiffView, { props: { diffBlocks } })

const targets = (wrapper) => wrapper.findAll('[data-change-index]')
const indices = (wrapper) => targets(wrapper).map((row) => row.attributes('data-change-index'))
const current = (wrapper) => wrapper.findAll('[data-current-change="true"]')

let scrolled

beforeEach(() => {
  scrolled = []
  // jsdom has no layout, so scrollIntoView does not exist and never moves
  // anything. Recording `this` is what lets a test name the row that asked to
  // be brought into view.
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function scrollIntoView() {
    scrolled.push(this)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DiffView change targets', () => {
  it('S-001: treats each changed paragraph of a modified section as one target, in document order', () => {
    const wrapper = mountDiff(diffWithChanges())

    expect(indices(wrapper)).toEqual(['0', '1', '2'])
    expect(targets(wrapper)[0].text()).toContain('First')
    expect(targets(wrapper)[1].text()).toContain('Second')
    expect(targets(wrapper)[2].text()).toContain('Third')
  })

  it('S-002: treats an added or removed section as one target, not one per paragraph', () => {
    const wrapper = mountDiff([
      added(section('s-1', 'New Chapter', [paragraph('p-1', 'One.'), paragraph('p-2', 'Two.')])),
      removed(section('s-2', 'Cut Chapter', [paragraph('p-3', 'Three.'), paragraph('p-4', 'Four.')])),
    ])

    expect(indices(wrapper)).toEqual(['0', '1'])
    expect(targets(wrapper)[0].text()).toContain('New Chapter')
    expect(targets(wrapper)[1].text()).toContain('Cut Chapter')
  })

  it('S-003: treats a renamed section title as one target even with no paragraph edits', () => {
    const wrapper = mountDiff([modified('Old Name', 'New Name', [])])

    expect(indices(wrapper)).toEqual(['0'])
    expect(targets(wrapper)[0].text()).toContain('New Name')
  })

  it('S-004: does not count unchanged sections or unchanged paragraphs as targets', () => {
    const wrapper = mountDiff([
      unchanged(section('s-1', 'Chapter One', [paragraph('p-1', 'Same.'), paragraph('p-2', 'Also same.')])),
      modified('Chapter Two', 'Chapter Two', [
        untouchedParagraph('p-3', 'Still same.'),
        changedParagraph('p-4', 'One change'),
      ]),
    ])

    // Every row renders. The unchanged ones are simply not stops.
    expect(wrapper.findAll('.diff-row').length).toBeGreaterThan(1)
    expect(indices(wrapper)).toEqual(['0'])
  })
})

describe('DiffView change movement', () => {
  it('S-006: makes the first target current when a diff with targets first renders', () => {
    const wrapper = mountDiff(diffWithChanges())

    expect(current(wrapper)).toHaveLength(1)
    expect(current(wrapper)[0].attributes('data-change-index')).toBe('0')
  })

  it('S-007: Next moves to the next target and Previous moves back', async () => {
    const wrapper = mountDiff(diffWithChanges())
    const next = wrapper.findAll('.diff-nav-next')
    const previous = wrapper.findAll('.diff-nav-prev')

    expect(next).toHaveLength(1)
    expect(previous).toHaveLength(1)

    await next[0].trigger('click')
    expect(current(wrapper)[0].attributes('data-change-index')).toBe('1')

    await previous[0].trigger('click')
    expect(current(wrapper)[0].attributes('data-change-index')).toBe('0')
  })

  it('S-008: disables Previous on the first target and Next on the last', async () => {
    const wrapper = mountDiff(diffWithChanges())
    const next = () => wrapper.findAll('.diff-nav-next')[0]
    const previous = () => wrapper.findAll('.diff-nav-prev')[0]

    expect(previous().attributes('disabled')).toBeDefined()
    expect(next().attributes('disabled')).toBeUndefined()

    await next().trigger('click')
    await next().trigger('click')

    expect(current(wrapper)[0].attributes('data-change-index')).toBe('2')
    expect(next().attributes('disabled')).toBeDefined()
    expect(previous().attributes('disabled')).toBeUndefined()
  })

  it('S-011: returns to the first target when the diff blocks change', async () => {
    const wrapper = mountDiff(diffWithChanges())
    await wrapper.findAll('.diff-nav-next')[0].trigger('click')
    expect(current(wrapper)[0].attributes('data-change-index')).toBe('1')

    await wrapper.setProps({
      diffBlocks: [
        modified('Chapter Two', 'Chapter Two', [
          changedParagraph('p-9a', 'Alpha'),
          changedParagraph('p-9b', 'Beta'),
        ]),
      ],
    })

    expect(current(wrapper)[0].attributes('data-change-index')).toBe('0')
    expect(wrapper.findAll('.diff-nav-position')[0].text()).toBe('Change 1 of 2')
  })

  it('S-016: Alt+ArrowDown moves to the next target and Alt+ArrowUp to the previous', async () => {
    const wrapper = mountDiff(diffWithChanges())

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true }))
    await nextTick()
    expect(current(wrapper)[0].attributes('data-change-index')).toBe('1')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true }))
    await nextTick()
    expect(current(wrapper)[0].attributes('data-change-index')).toBe('0')

    // The first target is the stop the ends guard holds at.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true }))
    await nextTick()
    expect(current(wrapper)[0].attributes('data-change-index')).toBe('0')

    wrapper.unmount()
  })
})

describe('DiffView change presentation', () => {
  it('S-005: numbers targets from 1 and shows the position in the header', async () => {
    const wrapper = mountDiff(diffWithChanges())
    const position = () => wrapper.findAll('.diff-nav-position')

    expect(position()).toHaveLength(1)
    expect(position()[0].text()).toBe('Change 1 of 3')

    await wrapper.findAll('.diff-nav-next')[0].trigger('click')
    expect(position()[0].text()).toBe('Change 2 of 3')
  })

  it('S-009: marks exactly one target row as current and clears the previous mark', async () => {
    const wrapper = mountDiff(diffWithChanges())

    expect(current(wrapper)).toHaveLength(1)
    const before = current(wrapper)[0].attributes('data-change-index')

    await wrapper.findAll('.diff-nav-next')[0].trigger('click')

    expect(current(wrapper)).toHaveLength(1)
    expect(current(wrapper)[0].attributes('data-change-index')).not.toBe(before)
    expect(targets(wrapper).filter((row) => row.attributes('data-current-change') === 'true'))
      .toHaveLength(1)
  })

  it('S-010: brings the current target row into view when the current target changes', async () => {
    const wrapper = mountDiff(diffWithChanges())
    await wrapper.findAll('.diff-nav-next')[0].trigger('click')

    const second = wrapper.findAll('[data-change-index="1"]')
    expect(second).toHaveLength(1)
    expect(scrolled.at(-1)).toBe(second[0].element)
  })

  it('S-012: hides the controls and says so when no section differs', () => {
    const wrapper = mountDiff([
      unchanged(section('s-1', 'Chapter One', [paragraph('p-1', 'Same.')])),
    ])

    expect(wrapper.text()).toContain('No changes')
    expect(wrapper.findAll('.diff-nav-next')).toHaveLength(0)
    expect(wrapper.findAll('.diff-nav-prev')).toHaveLength(0)
  })
})
