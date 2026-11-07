import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import NotesView from './NotesView.vue'
import { useDocumentStore } from '../stores/document.js'

// The Notes view surface (SPEC.md 5.17). The sentences here are about what the
// writer sees and what reaches the store. The pure record helpers live in
// useNotes.test.js. The browser-only sentences (caret, pages, theme, undo
// routing) live in e2e/notes-view.spec.js.

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
    props: { store, recaps: {}, ...props },
  })
}

const row = (wrapper, id) => wrapper.find(`.notes-entry[data-entry-id="${id}"]`)

/// Assert-then-click: a missing row must fail as an assertion, not as an
/// @vue/test-utils "empty DOMWrapper" error.
async function selectEntry(wrapper, id) {
  expect(row(wrapper, id).exists()).toBe(true)
  await row(wrapper, id).trigger('click')
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('NotesView entries', () => {
  it('S-001: lists the story overview first and every section in document order', () => {
    const wrapper = mountView(makeStore())
    const ids = wrapper.findAll('.notes-entry').map((entry) => entry.attributes('data-entry-id'))

    expect(ids).toEqual(['overview', 'c1', 's1', 'c2', 's2', 'orphaned'])
  })

  it('S-001: marks chapter rows and section rows differently', () => {
    const wrapper = mountView(makeStore())

    expect(row(wrapper, 'c1').exists()).toBe(true)
    expect(row(wrapper, 's1').exists()).toBe(true)
    expect(row(wrapper, 'c1').classes()).toContain('is-chapter')
    expect(row(wrapper, 'c2').classes()).toContain('is-chapter')
    expect(row(wrapper, 's1').classes()).toContain('is-section')
    expect(row(wrapper, 's2').classes()).toContain('is-section')
  })

  it('S-019: puts the orphaned draft at the bottom of the list, with no text', async () => {
    const wrapper = mountView(makeStore())
    const entries = wrapper.findAll('.notes-entry')

    expect(entries).toHaveLength(6)
    const last = entries[entries.length - 1]
    expect(last.attributes('data-entry-id')).toBe('orphaned')
    expect(last.classes()).toContain('notes-orphans')

    await selectEntry(wrapper, 'orphaned')
    expect(wrapper.find('.note-empty').exists()).toBe(true)
  })

  it('S-020: gives every section an always-present note field, with no create or delete action', () => {
    const wrapper = mountView(makeStore())

    expect(wrapper.findAll('.notes-entry')).toHaveLength(doc.sections.length + 2)
    expect(wrapper.find('.note-create').exists()).toBe(false)
    expect(wrapper.find('.note-delete').exists()).toBe(false)
    expect(row(wrapper, 's2').exists()).toBe(true)
  })

  it('S-001: titles an unnamed chapter from its derived number, in the row and the note header', async () => {
    const store = makeStore()
    store.doc = {
      ...doc,
      sections: [
        { id: 'c1', title: '', sectionType: 'chapter', hidden: false, paragraphs: [] },
        { id: 's1', title: 'The Door', sectionType: 'section', hidden: false, paragraphs: [] },
      ],
    }
    const wrapper = mountView(store)

    // A Chapter's stored title is its subtitle, so a subtitle-less chapter is
    // blank unless the row derives the number — a blank row is unreachable.
    expect(row(wrapper, 'c1').text()).toContain('Chapter 1')
    await selectEntry(wrapper, 'c1')
    expect(wrapper.find('.note-head .note-title').text()).toBe('Chapter 1')
  })
})

describe('NotesView reading and editing', () => {
  it('S-002: shows the selected note as rendered markdown, read-only by default', async () => {
    const store = makeStore({ overview: '', sections: { s1: 'A **bold** plan.' }, orphaned: '' })
    const wrapper = mountView(store)
    await selectEntry(wrapper, 's1')

    expect(wrapper.find('.note-rendered').exists()).toBe(true)
    expect(wrapper.find('.note-rendered').html()).toContain('<strong>bold</strong>')
    expect(wrapper.find('.note-source').exists()).toBe(false)
  })

  it('S-002: shows the empty state when the selected entry has no text', async () => {
    const wrapper = mountView(makeStore())
    await selectEntry(wrapper, 'c1')

    expect(wrapper.find('.note-empty').exists()).toBe(true)
    expect(wrapper.find('.note-rendered').exists()).toBe(false)
  })

  it('S-004: enters editing from the rendered note with the pencil, showing check and reset', async () => {
    const store = makeStore({ overview: '', sections: { s1: 'A plan.' }, orphaned: '' })
    const wrapper = mountView(store)
    await selectEntry(wrapper, 's1')

    expect(wrapper.find('.note-edit').exists()).toBe(true)
    expect(wrapper.find('.note-save').exists()).toBe(false)
    expect(wrapper.find('.note-reset').exists()).toBe(false)

    await wrapper.find('.note-edit').trigger('click')

    expect(wrapper.find('.note-source').exists()).toBe(true)
    expect(wrapper.find('.note-save').exists()).toBe(true)
    expect(wrapper.find('.note-reset').exists()).toBe(true)
    expect(wrapper.find('.note-save + .note-edit-divider + .note-reset').exists()).toBe(true)
  })

  it('S-005: commits the edited note and marks the document modified from the check', async () => {
    const store = makeStore({ overview: '', sections: { s1: 'A plan.' }, orphaned: '' })
    const wrapper = mountView(store)
    await selectEntry(wrapper, 's1')
    await wrapper.find('.note-edit').trigger('click')
    await wrapper.find('.note-source').setValue('A better plan.')
    await wrapper.find('.note-save').trigger('click')
    await flushPromises()

    expect(store.notes.sections.s1).toBe('A better plan.')
    expect(store.isModified).toBe(true)
  })

  it('S-023: restores the last committed note and stays in editing when reset is used', async () => {
    const store = makeStore({ overview: '', sections: { s1: 'Committed text.' }, orphaned: '' })
    const wrapper = mountView(store)
    await selectEntry(wrapper, 's1')
    await wrapper.find('.note-edit').trigger('click')
    await wrapper.find('.note-source').setValue('Uncommitted draft.')

    expect(wrapper.find('.note-reset').exists()).toBe(true)
    await wrapper.find('.note-reset').trigger('click')

    expect(wrapper.find('.note-source').exists()).toBe(true)
    expect(wrapper.find('.note-source').element.value).toBe('Committed text.')
    expect(store.notes.sections.s1).toBe('Committed text.')
  })

  it('S-025: commits a dirty draft when another entry is chosen', async () => {
    const store = makeStore({ overview: '', sections: { s1: 'Committed text.' }, orphaned: '' })
    const wrapper = mountView(store)
    await selectEntry(wrapper, 's1')
    await wrapper.find('.note-edit').trigger('click')
    await wrapper.find('.note-source').setValue('Dirty draft.')
    await selectEntry(wrapper, 'c2')
    await flushPromises()

    expect(store.notes.sections.s1).toBe('Dirty draft.')
  })

  it('S-025: commits a dirty draft when the Notes view is left', async () => {
    const store = makeStore({ overview: '', sections: { s1: 'Committed text.' }, orphaned: '' })
    const wrapper = mountView(store)
    await selectEntry(wrapper, 's1')
    await wrapper.find('.note-edit').trigger('click')
    await wrapper.find('.note-source').setValue('Dirty draft.')
    wrapper.unmount()
    await flushPromises()

    expect(store.notes.sections.s1).toBe('Dirty draft.')
  })
})

describe('NotesView recaps and the section jump', () => {
  it('S-006: shows the stored recap for the selected section read-only', async () => {
    const store = makeStore({ overview: '', sections: { s1: 'A plan.' }, orphaned: '' })
    const wrapper = mountView(store, { recaps: { s1: 'A neutral recap of the door.' } })
    await selectEntry(wrapper, 's1')

    expect(wrapper.find('.note-recap').text()).toContain('A neutral recap of the door.')
    expect(wrapper.find('.note-recap textarea').exists()).toBe(false)
    expect(wrapper.find('.note-insert-recap').exists()).toBe(true)
  })

  // SPEC.md 5.20 S-022, bug B-004. A generated summary beside the writer's note
  // must say what it is. Unlabelled model prose in the same pane reads as the
  // writer's own words.
  it('S-022: labels the generated summary shown beside a note', async () => {
    const store = makeStore({ overview: '', sections: { s1: 'My plan.' }, orphaned: '' })
    const wrapper = mountView(store, { recaps: { s1: 'A neutral summary of the door.' } })
    await selectEntry(wrapper, 's1')

    const block = wrapper.find('.note-recap')
    expect(block.exists()).toBe(true)

    const label = block.find('.note-recap-label')
    expect(label.exists()).toBe(true)
    expect(label.text()).toMatch(/summary/i)
    // The label belongs to the generated block and sits above its text, so the
    // reader meets the attribution before the prose.
    const text = block.find('.note-recap-text')
    expect(text.exists()).toBe(true)
    expect(
      label.element.compareDocumentPosition(text.element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // A record with no summary shows no label, so nothing claims to be one.
    const bare = mountView(makeStore(), { recaps: {} })
    await selectEntry(bare, 's1')
    expect(bare.find('.note-recap-label').exists()).toBe(false)
  })

  it('S-024: appends the recap to the draft and enters editing from Insert into note', async () => {
    const store = makeStore({ overview: '', sections: { s1: 'My plan.' }, orphaned: '' })
    const wrapper = mountView(store, { recaps: { s1: 'A neutral recap.' } })
    await selectEntry(wrapper, 's1')

    expect(wrapper.find('.note-insert-recap').exists()).toBe(true)
    await wrapper.find('.note-insert-recap').trigger('click')

    expect(wrapper.find('.note-source').exists()).toBe(true)
    const value = wrapper.find('.note-source').element.value
    expect(value).toContain('My plan.')
    expect(value).toContain('A neutral recap.')
    expect(value.indexOf('My plan.')).toBeLessThan(value.indexOf('A neutral recap.'))
  })

  it('S-021: places the section jump in the note header immediately after the title', async () => {
    const wrapper = mountView(makeStore())
    await selectEntry(wrapper, 's1')

    expect(wrapper.find('.note-head .note-title').exists()).toBe(true)
    expect(wrapper.find('.note-head .note-title + .note-jump').exists()).toBe(true)
  })
})
