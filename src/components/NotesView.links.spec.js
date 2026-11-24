import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import NotesView from './NotesView.vue'
import { useDocumentStore } from '../stores/document.js'

// The note page's link behaviour (SPEC.md revision 5, S-090 and S-092).
//
// Rendering must not touch what is stored, because the note record is source.
// One test holds the anchor and the stored string together, so a renderer that
// emits no anchor cannot satisfy the storage half by itself.

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))

const doc = {
  title: 'Notes',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    { id: 'c1', title: 'Chapter One', sectionType: 'chapter', hidden: false, paragraphs: [] },
    { id: 's1', title: 'The Door', sectionType: 'section', hidden: false, paragraphs: [] },
  ],
}

const entry = (id, kind, name, aliases = []) => ({
  id,
  kind,
  name,
  definition: '',
  aliases,
  tags: [],
  facts: [],
  includedSections: [],
  excludedSections: [],
})

const references = {
  entries: [
    entry('e-izildar', 'character', 'Izildar', ['Izi']),
    entry('e-square', 'place', 'Qualen Square'),
  ],
}

const anchors = (html) => html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) || []

function makeStore(notes) {
  const store = useDocumentStore()
  store.doc = doc
  store.notes = notes
  return store
}

function mountView(store, entryId) {
  return mount(NotesView, {
    props: { store, recaps: {}, entryId, references },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('reference links in a note', () => {
  it('S-090: renders a link without writing the resolution into the stored note', () => {
    const draft = 'See [[Izi]] for more.'
    const store = makeStore({ overview: '', sections: { s1: draft }, orphaned: '' })
    const wrapper = mountView(store, 's1')

    expect(anchors(wrapper.find('.note-rendered').html())).toHaveLength(1)
    expect(store.notes.sections.s1).toBe(draft)
  })

  it('S-092: resolves links in the overview, a section note and the orphaned draft', () => {
    const store = makeStore({
      overview: 'The [[Izi]] thread runs through everything.',
      sections: { s1: 'Later, [[Qualen Square]] is empty.' },
      orphaned: 'Cut from the draft: [[Izi]] again.',
    })

    expect(anchors(mountView(store, 'overview').find('.note-rendered').html())).toHaveLength(1)
    expect(anchors(mountView(store, 's1').find('.note-rendered').html())).toHaveLength(1)
    expect(anchors(mountView(store, 'orphaned').find('.note-rendered').html())).toHaveLength(1)
  })
})
