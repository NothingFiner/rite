import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import ReferencesView from './ReferencesView.vue'
import OutlineView from './OutlineView.vue'
import NotesView from './NotesView.vue'

// SPEC.md 5.20's shell sentences: S-002 through S-006.
//
// Which tab is in front arrives as a prop rather than living in local state,
// so the choice can outlive the view. Each tab's content is its own component's
// business (OutlineView.spec.js, NotesView.spec.js).

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))

const doc = {
  title: 'References',
  author: 'A',
  authorContact: '',
  hasTOC: false,
  sections: [{ id: 'c1', title: 'One', sectionType: 'chapter', hidden: false, paragraphs: [] }],
}

function makeStore() {
  return reactive({ doc: reactive(doc), notes: { overview: '', sections: {}, orphaned: '' } })
}

function mountView(props = {}) {
  return mount(ReferencesView, {
    props: {
      store: makeStore(),
      theme: reactive({ bg: 'rgb(250, 247, 242)', text: 'rgb(34, 34, 34)', accent: '#4f8ef7' }),
      summaries: reactive({ summaryEntries: [], summaryProgress: { done: 0, total: 1, stale: 0 } }),
      settings: { settings: reactive({ model: '' }) },
      ...props,
    },
  })
}

const tab = (wrapper, name) => wrapper.find(`.references-tab[data-tab="${name}"]`)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ReferencesView', () => {
  it('S-002: shows Outline and Notes tabs, with Outline selected by default', () => {
    const wrapper = mountView()

    expect(tab(wrapper, 'outline').exists()).toBe(true)
    expect(tab(wrapper, 'notes').exists()).toBe(true)
    expect(tab(wrapper, 'outline').text()).toBe('Outline')
    expect(tab(wrapper, 'notes').text()).toBe('Notes')
    expect(tab(wrapper, 'outline').attributes('aria-selected')).toBe('true')
    expect(wrapper.findComponent(OutlineView).exists()).toBe(true)
    expect(wrapper.findComponent(NotesView).exists()).toBe(false)
  })

  it('S-003: shows the existing notes surface unchanged on the Notes tab', async () => {
    const wrapper = mountView()

    await tab(wrapper, 'notes').trigger('click')

    // The shell reports the choice. The parent re-renders it back down.
    expect(wrapper.emitted('update:tab')).toBeTruthy()
    expect(wrapper.emitted('update:tab')[0]).toEqual(['notes'])

    await wrapper.setProps({ tab: 'notes' })
    // Notes is the shipped working surface, mounted as-is rather than copied.
    const notes = wrapper.findComponent(NotesView)
    expect(notes.exists()).toBe(true)
    expect(wrapper.find('.notes-view').exists()).toBe(true)
    expect(wrapper.findComponent(OutlineView).exists()).toBe(false)
  })

  it('S-004: renders the tab it is given, so the selection survives a view switch', async () => {
    const wrapper = mountView({ tab: 'notes' })

    expect(wrapper.find('.notes-view').exists()).toBe(true)
    expect(wrapper.find('.outline-view').exists()).toBe(false)
    expect(tab(wrapper, 'notes').attributes('aria-selected')).toBe('true')
  })

  it('S-005: forwards a section jump from a note, and stays on the Notes tab', async () => {
    const store = reactive({
      doc: reactive(doc),
      notes: { overview: 'A letter starts it all.', sections: { c1: 'Mara is late.' }, orphaned: '' },
    })
    const wrapper = mountView({ store, tab: 'notes' })

    const notes = wrapper.findComponent(NotesView)
    expect(notes.exists()).toBe(true)
    notes.vm.$emit('jump', 'c1')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('jump')).toBeTruthy()
    expect(wrapper.emitted('jump')[0]).toEqual(['c1'])
    // The jump opens the editor. When the writer comes back, this is still the
    // notes, because the shell does not reset its tab on the way out.
    expect(wrapper.emitted('update:tab')).toBeFalsy()
  })

  it('S-006: paints its surface with the active theme, matching the notes surface', () => {
    // rgb() literals, because jsdom normalises a bound style to rgb anyway.
    const theme = reactive({ bg: 'rgb(16, 16, 16)', text: 'rgb(240, 240, 240)', accent: '#4f8ef7' })
    const wrapper = mountView({ theme })

    const surface = wrapper.find('.references-view')
    // The notes surface binds the same two fields, so the two tabs do not flip
    // appearance when the writer switches between them.
    expect(surface.attributes('style')).toContain('rgb(16, 16, 16)')
    expect(surface.attributes('style')).toContain('rgb(240, 240, 240)')
  })
})
