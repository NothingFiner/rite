import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useDocumentStore } from './document.js'
import { useWordCount } from '../composables/useWordCount.js'
import { useRustSearch } from '../composables/useRustSearch.js'

// SPEC.md 5.19a's persistence and exclusion sentences: S-016 and S-019.

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'

const textStyle = { bold: false, italic: false, underline: false, fontSize: null }

const paragraph = (id, text) => ({
  id,
  elements: [{ textRun: { content: text, textStyle } }],
  leftIndent: null,
  rightIndent: null,
  firstLineIndent: null,
})

const section = (id, paragraphs) => ({
  id,
  title: '',
  sectionType: 'section',
  hidden: false,
  paragraphs,
})

const entry = {
  id: 'r1',
  kind: 'term',
  name: 'Ashfall',
  definition: 'The seasonal fall of grey ash.',
  aliases: [],
  tags: [],
  facts: [],
  includedSections: [],
  excludedSections: [],
}

describe('document store references', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('S-016: loads and saves the record through one command pair', async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'retrieve_references') return { entries: [entry] }
      return null
    })

    const store = useDocumentStore()
    await store.retrieveReferences()

    expect(invoke).toHaveBeenCalledWith('retrieve_references')
    expect(store.references.entries).toEqual([entry])

    vi.clearAllMocks()
    invoke.mockResolvedValue(null)
    await store.pushReferences()

    expect(invoke).toHaveBeenCalledWith('update_references', {
      references: store.references,
    })
  })

  it('S-019: keeps entries out of the word count and out of search results', async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'retrieve_references') return { entries: [entry] }
      if (cmd === 'search_document') return []
      return null
    })

    const store = useDocumentStore()
    store.doc = {
      title: 'Novel',
      author: '',
      sections: [section('s1', [paragraph('p1', 'One two three')])],
    }
    await store.retrieveReferences()

    expect(store.references.entries).toHaveLength(1)
    // Entries live beside the document, never inside it.
    expect(store.doc.references).toBeUndefined()

    const { wordCount } = useWordCount(ref(store.doc))
    expect(wordCount.value).toBe(3)

    const search = useRustSearch()
    await search.findText('Ashfall')
    expect(invoke).toHaveBeenCalledWith('search_document', { query: 'Ashfall' })
  })
})
