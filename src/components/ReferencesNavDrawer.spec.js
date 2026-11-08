import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import ReferencesNavDrawer from './ReferencesNavDrawer.vue'
import { doc, section } from '../composables/outlineFixtures.js'

// SPEC.md 5.20a's drawer sentences: S-005 through S-010, S-021's empty state,
// and the whole-manuscript regeneration gate (S-028, S-029). The drawer lists the document; it does not navigate. The shell owns
// the selection and the anchor, and this component only draws them.

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))

const outlineDoc = doc([
  section('c1', 'Chapter One', 'chapter'),
  section('s1', 'The Door', 'section'),
  section('c2', '', 'chapter'),
  section('s2', 'Ashes', 'section'),
])

function makeStore(overrides = {}) {
  return reactive({
    doc: reactive(outlineDoc),
    notes: { overview: '', sections: {}, orphaned: '' },
    ...overrides,
  })
}

function mountDrawer(props = {}) {
  return mount(ReferencesNavDrawer, {
    props: { store: makeStore(), selectedId: 'overview', anchorId: null, ...props },
  })
}

const row = (wrapper, id) => wrapper.find(`.notes-entry[data-entry-id="${id}"]`)
const rowIds = (wrapper) =>
  wrapper.findAll('.notes-entry').map((entry) => entry.attributes('data-entry-id'))

describe('ReferencesNavDrawer entries', () => {
  it('S-005: lists the story overview, then the manuscript in document order, then the orphaned draft', () => {
    const wrapper = mountDrawer()

    // Document order, one row per section, with the overview first and the
    // orphaned draft last. A section with no note still has a row.
    expect(rowIds(wrapper)).toEqual(['overview', 'c1', 's1', 'c2', 's2', 'orphaned'])

    // A chapter's own row stands as its heading, so no row is a label a writer
    // cannot select, and no chapter name appears twice.
    expect(wrapper.findAll('h3')).toHaveLength(0)
    expect(row(wrapper, 'overview').text()).toContain('Story overview')
    expect(row(wrapper, 'orphaned').text()).toContain('Orphaned notes')
  })

  it('S-006: indents a section row under its chapter and keeps a chapter row bold', () => {
    const wrapper = mountDrawer()

    // Assert the rows exist before reading a class off one: a missing row must
    // fail as an assertion, not as an empty-DOMWrapper error.
    expect(rowIds(wrapper)).toEqual(['overview', 'c1', 's1', 'c2', 's2', 'orphaned'])
    expect(row(wrapper, 'c1').classes()).toContain('is-chapter')
    expect(row(wrapper, 's1').classes()).toContain('is-section')
    expect(row(wrapper, 'c2').classes()).toContain('is-chapter')
    expect(row(wrapper, 's2').classes()).toContain('is-section')
    expect(row(wrapper, 'orphaned').classes()).toContain('notes-orphans')
  })

  it('S-007: names an untitled chapter by its number, never blank', () => {
    const wrapper = mountDrawer()

    expect(row(wrapper, 'c2').exists()).toBe(true)
    // A Chapter's stored title is only its subtitle and may be empty (5.9), so
    // the row derives the number from the document order.
    expect(row(wrapper, 'c2').text()).toContain('Chapter 2')
    expect(row(wrapper, 'c2').text().trim()).not.toBe('')
    // A titled chapter keeps its stored subtitle.
    expect(row(wrapper, 'c1').text()).toContain('Chapter One')
  })

  it('S-008: marks the anchor row and only the anchor row', () => {
    const wrapper = mountDrawer({ selectedId: 'overview', anchorId: 's1' })

    expect(row(wrapper, 's1').exists()).toBe(true)
    expect(row(wrapper, 's1').classes()).toContain('is-anchor')
    for (const id of ['overview', 'c1', 'c2', 's2', 'orphaned']) {
      expect(row(wrapper, id).exists()).toBe(true)
      expect(row(wrapper, id).classes()).not.toContain('is-anchor')
    }
  })

  it('S-009: marks the row it is given as selected and reports a click upward', async () => {
    const wrapper = mountDrawer({ selectedId: 's1' })

    expect(row(wrapper, 's1').exists()).toBe(true)
    expect(row(wrapper, 'c1').exists()).toBe(true)
    expect(row(wrapper, 'c2').exists()).toBe(true)
    expect(row(wrapper, 's1').classes()).toContain('selected')
    expect(row(wrapper, 'c1').classes()).not.toContain('selected')

    await row(wrapper, 'c2').trigger('click')

    // The drawer chooses; the shell decides. A click never asks for a jump.
    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select').at(-1)).toEqual(['c2'])
    expect(wrapper.emitted('jump')).toBeFalsy()
  })

  it('S-021: says there is nothing to outline for an empty document, without an error', () => {
    const wrapper = mountDrawer({ store: makeStore({ doc: reactive(doc([])) }) })

    expect(wrapper.findAll('.notes-entry')).toHaveLength(0)
    expect(wrapper.find('.notes-empty').exists()).toBe(true)
    expect(wrapper.find('.notes-empty').text()).toMatch(/nothing to outline/i)
  })
})

describe('ReferencesNavDrawer generation', () => {
  const withModel = () => ({ settings: reactive({ model: 'llama3' }) })

  it('S-028: offers Regenerate all when a model is configured and reports the choice upward', async () => {
    const wrapper = mountDrawer({ settings: withModel() })

    const button = wrapper.find('.references-regenerate-all')
    expect(button.exists()).toBe(true)
    expect(button.text()).toMatch(/regenerate all/i)

    await button.trigger('click')

    expect(wrapper.emitted('regenerate-all')).toHaveLength(1)
  })

  it('S-029: offers no Regenerate all without a configured model', () => {
    const noModel = mountDrawer({ settings: { settings: reactive({ model: '' }) } })
    expect(noModel.find('.references-regenerate-all').exists()).toBe(false)

    const noSettings = mountDrawer()
    expect(noSettings.find('.references-regenerate-all').exists()).toBe(false)
  })
})
