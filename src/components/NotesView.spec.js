import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import NotesView from './NotesView.vue'
import { useDocumentStore } from '../stores/document.js'

// The note page (SPEC.md 5.20a S-012 … S-017, plus 5.17 S-021).
//
// 5.20a moves the list out to ReferencesNavDrawer: this component is the detail
// page only, and the selected entry arrives as a prop. Everything about reading,
// editing, the recap and the jump is unchanged, so these sentences keep their
// behaviour and change only how the entry is chosen.

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))

const doc = {
  title: 'Notes',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    { id: 'c1', title: 'Chapter One', sectionType: 'chapter', hidden: false, paragraphs: [] },
    { id: 's1', title: 'The Door', sectionType: 'section', hidden: false, paragraphs: [] },
    { id: 'c2', title: 'Chapter Two', sectionType: 'chapter', hidden: false, paragraphs: [] },
    { id: 's2', title: 'Ashes', sectionType: 'section', hidden: false, paragraphs: [] },
  ],
}

function makeStore(notes = { overview: '', sections: {}, orphaned: '' }) {
  const store = useDocumentStore()
  store.doc = doc
  store.notes = notes
  return store
}

function mountView(store, props = {}) {
  return mount(NotesView, {
    props: { store, recaps: {}, entryId: 'overview', ...props },
  })
}

const title = (wrapper) => wrapper.find('.note-head .note-title')

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('NotesView reading', () => {
  it('S-012: shows the selected note as rendered markdown, read-only by default', () => {
    const store = makeStore({ overview: '', sections: { s1: 'A **bold** plan.' }, orphaned: '' })
    const wrapper = mountView(store, { entryId: 's1' })

    expect(title(wrapper).text()).toBe('The Door')
    expect(wrapper.find('.note-rendered').exists()).toBe(true)
    expect(wrapper.find('.note-rendered').html()).toContain('<strong>bold</strong>')
    expect(wrapper.find('.note-source').exists()).toBe(false)
  })

  it('S-012: shows the empty state when the selected entry has no text', () => {
    // The overview carries text, so an entry that still shows it is not the
    // empty state the sentence is about.
    const store = makeStore({ overview: 'The whole book in a line.', sections: {}, orphaned: '' })
    const wrapper = mountView(store, { entryId: 'c1' })

    expect(title(wrapper).text()).toBe('Chapter One')
    expect(wrapper.find('.note-empty').exists()).toBe(true)
    expect(wrapper.find('.note-rendered').exists()).toBe(false)
  })

  it('S-013: shows the story overview and the orphaned draft for their own entries', () => {
    const store = makeStore({
      overview: 'The whole book in a line.',
      sections: {},
      orphaned: 'Cut in draft four.',
    })

    const overview = mountView(store, { entryId: 'overview' })
    expect(overview.find('.note-rendered').text()).toContain('The whole book in a line.')

    const orphaned = mountView(store, { entryId: 'orphaned' })
    expect(orphaned.find('.note-rendered').text()).toContain('Cut in draft four.')
    expect(orphaned.find('.note-rendered').text()).not.toContain('The whole book in a line.')
  })
})

describe('NotesView editing', () => {
  it('S-017: enters editing from the pencil, showing check and reset', async () => {
    const store = makeStore({ overview: '', sections: { s1: 'A plan.' }, orphaned: '' })
    const wrapper = mountView(store, { entryId: 's1' })

    expect(title(wrapper).text()).toBe('The Door')
    expect(wrapper.find('.note-edit').exists()).toBe(true)
    expect(wrapper.find('.note-save').exists()).toBe(false)
    expect(wrapper.find('.note-reset').exists()).toBe(false)

    await wrapper.find('.note-edit').trigger('click')

    expect(wrapper.find('.note-source').exists()).toBe(true)
    expect(wrapper.find('.note-save').exists()).toBe(true)
    expect(wrapper.find('.note-reset').exists()).toBe(true)
    expect(wrapper.find('.note-save + .note-edit-divider + .note-reset').exists()).toBe(true)
  })

  it('S-017: commits the edited note and marks the document modified from the check', async () => {
    const store = makeStore({ overview: '', sections: { s1: 'A plan.' }, orphaned: '' })
    const wrapper = mountView(store, { entryId: 's1' })
    await wrapper.find('.note-edit').trigger('click')
    await wrapper.find('.note-source').setValue('A better plan.')
    await wrapper.find('.note-save').trigger('click')
    await flushPromises()

    expect(store.notes.sections.s1).toBe('A better plan.')
    expect(store.isModified).toBe(true)
  })

  it('S-017: restores the last committed note and stays in editing when reset is used', async () => {
    const store = makeStore({ overview: '', sections: { s1: 'Committed text.' }, orphaned: '' })
    const wrapper = mountView(store, { entryId: 's1' })
    await wrapper.find('.note-edit').trigger('click')
    await wrapper.find('.note-source').setValue('Uncommitted draft.')

    expect(wrapper.find('.note-reset').exists()).toBe(true)
    await wrapper.find('.note-reset').trigger('click')

    expect(wrapper.find('.note-source').exists()).toBe(true)
    expect(wrapper.find('.note-source').element.value).toBe('Committed text.')
    expect(store.notes.sections.s1).toBe('Committed text.')
  })

  it('S-017: commits a dirty draft when the selected entry changes', async () => {
    const store = makeStore({ overview: '', sections: { s1: 'Committed text.' }, orphaned: '' })
    const wrapper = mountView(store, { entryId: 's1' })
    await wrapper.find('.note-edit').trigger('click')
    await wrapper.find('.note-source').setValue('Dirty draft.')

    await wrapper.setProps({ entryId: 'c2' })
    await flushPromises()

    expect(store.notes.sections.s1).toBe('Dirty draft.')
  })

  it('S-017: commits a dirty draft when the page is left', async () => {
    const store = makeStore({ overview: '', sections: { s1: 'Committed text.' }, orphaned: '' })
    const wrapper = mountView(store, { entryId: 's1' })
    await wrapper.find('.note-edit').trigger('click')
    await wrapper.find('.note-source').setValue('Dirty draft.')
    wrapper.unmount()
    await flushPromises()

    expect(store.notes.sections.s1).toBe('Dirty draft.')
  })
})

describe('NotesView recap', () => {
  it('S-014: shows the stored recap read-only, labelled as model output', () => {
    const store = makeStore({ overview: '', sections: { s1: 'A plan.' }, orphaned: '' })
    const wrapper = mountView(store, {
      entryId: 's1',
      recaps: { s1: 'A neutral recap of the door.' },
    })

    const block = wrapper.find('.note-recap')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('A neutral recap of the door.')

    const label = block.find('.note-recap-label')
    expect(label.exists()).toBe(true)
    expect(label.text()).toMatch(/assistant recap/i)
    expect(label.text()).toMatch(/read-only/i)
    expect(block.find('textarea').exists()).toBe(false)
    expect(block.find('.note-insert-recap').exists()).toBe(true)
  })

  it('S-015: appends the recap to the draft and enters editing, without saving', async () => {
    const store = makeStore({ overview: '', sections: { s1: 'My plan.' }, orphaned: '' })
    const wrapper = mountView(store, {
      entryId: 's1',
      recaps: { s1: 'A neutral recap.' },
    })

    expect(wrapper.find('.note-insert-recap').exists()).toBe(true)
    await wrapper.find('.note-insert-recap').trigger('click')

    expect(wrapper.find('.note-source').exists()).toBe(true)
    const value = wrapper.find('.note-source').element.value
    expect(value).toContain('My plan.')
    expect(value).toContain('A neutral recap.')
    expect(value.indexOf('My plan.')).toBeLessThan(value.indexOf('A neutral recap.'))
    // The draft is not the record until it is saved.
    expect(store.notes.sections.s1).toBe('My plan.')
  })

  it('S-016: shows no recap block for an entry with no stored recap', () => {
    const store = makeStore({ overview: '', sections: { s1: 'A plan.' }, orphaned: '' })
    const wrapper = mountView(store, { entryId: 's1', recaps: {} })

    // Title first: the absence below must be about The Door, not the overview.
    expect(title(wrapper).text()).toBe('The Door')
    expect(wrapper.find('.note-recap').exists()).toBe(false)
    expect(wrapper.find('.note-recap-label').exists()).toBe(false)
  })
})

describe('NotesView jump', () => {
  it('5.17 S-021: places the section jump in the note header immediately after the title', () => {
    const wrapper = mountView(makeStore(), { entryId: 's1' })

    expect(wrapper.find('.note-head .note-title').exists()).toBe(true)
    expect(wrapper.find('.note-head .note-title + .note-jump').exists()).toBe(true)
  })
})
