import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/tauri'
import { useDocumentStore } from '../stores/document.js'
import GeneralOptionsDrawer from './GeneralOptionsDrawer.vue'

// SPEC.md S-011 — the Title field in Document Info (General Options) is how a
// writer names a document. It is the reason the title has to be independent of
// the filename: before this change every save overwrote what was typed here
// with the file's basename, so the field looked like it worked and then
// silently undid itself.
//
// The drawer is driven directly by the document store it is handed (that is its
// design — see the props comment in the component), so mounting it against a
// real Pinia store exercises the real binding.

function mountDrawer(store) {
  return mount(GeneralOptionsDrawer, {
    props: {
      open: true,
      store,
      sectionFormat: {
        sectionFormat: { prefix: 'Chapter', numbering: 'arabic' },
        setFormat: vi.fn(),
        formatChapter: (n) => `Chapter ${n}: `,
      },
      llmSettings: {
        settings: {
          endpoint: '',
          apiKey: '',
          model: '',
          temperature: 0.7,
          contextLength: 4096,
          embeddingsEnabled: false,
          embeddingsEndpoint: '',
          embeddingsApiKey: '',
          embeddingsModel: '',
        },
      },
      chatManager: { roles: [], refreshRoles: vi.fn() },
    },
  })
}

/// The Title input is the sibling that follows the "Title" label. Selecting it
/// that way keeps the test on the labelled field rather than on an index, so
/// reordering the accordion does not turn this into a false failure.
function titleInput(wrapper) {
  const label = wrapper.findAll('label.drawer-label').find((l) => l.text() === 'Title')
  expect(label, 'the Document Info accordion labels a Title field').toBeTruthy()
  return label.element.nextElementSibling
}

describe('GeneralOptionsDrawer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('S-011: editing the title marks the document modified and the title survives a save', async () => {
    invoke.mockResolvedValue(undefined)

    const store = useDocumentStore()
    store.doc = {
      title: 'Chapter One',
      author: '',
      authorContact: '',
      hasTOC: false,
      sections: [],
    }
    store.lastPath = '/tmp/novel.rite'

    const wrapper = mountDrawer(store)
    const input = titleInput(wrapper)
    input.value = 'The Long Winter'
    input.dispatchEvent(new Event('input'))
    await nextTick()

    expect(store.doc.title).toBe('The Long Winter')
    expect(store.isModified).toBe(true)

    await store.saveDocument('/tmp/novel.rite')

    // The save must not undo the edit: the title is the document's, not the
    // file's. See SPEC.md S-001 and S-003.
    expect(store.doc.title).toBe('The Long Winter')

    // A pending debounced sync would outlive the test; drop it.
    if (store.syncTimeout) clearTimeout(store.syncTimeout)
  })
})
