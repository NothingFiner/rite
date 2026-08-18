import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useNavigation } from './useNavigation.js'
import { ParagraphStyle } from '../constants/ParagraphStyle.js'

vi.mock('./usePagination.js', () => ({
  usePagination: () => ({
    getPageForParagraph: (idx) => Math.floor(idx / 4) + 1,
  }),
}))

const mockStore = {
  renameSection: vi.fn(),
  deleteHeading: vi.fn(),
}

vi.mock('../stores/document.js', () => ({
  useDocumentStore: () => mockStore,
}))

function makeHeading(id, level, text) {
  return {
    id,
    paragraphStyle: `heading${level}`,
    elements: [{ textRun: { content: text, textStyle: {} } }],
  }
}

function makeNormal(text) {
  return {
    id: 'p-' + Math.random().toString(36).slice(2),
    paragraphStyle: ParagraphStyle.Normal,
    elements: [{ textRun: { content: text, textStyle: {} } }],
  }
}

describe('useNavigation', () => {
  it('generates empty TOC for empty document', () => {
    const docRef = ref({ body: { content: [] } })
    const nav = useNavigation(docRef, ref(null))
    expect(nav.tocItems.value).toEqual([])
  })

  it('generates TOC items for headings', () => {
    const docRef = ref({
      body: {
        content: [
          makeHeading('h1', 1, 'Part One'),
          makeNormal('paragraph'),
          makeHeading('h2', 2, 'Chapter 1'),
          makeNormal('paragraph'),
        ],
      },
    })
    const nav = useNavigation(docRef, ref(null))
    expect(nav.tocItems.value).toHaveLength(2)
    expect(nav.tocItems.value[0]).toMatchObject({ id: 'h1', level: 1, title: 'Part One' })
    expect(nav.tocItems.value[1]).toMatchObject({ id: 'h2', level: 2, title: 'Chapter 1' })
  })

  it('computes page numbers via pagination', () => {
    const docRef = ref({
      body: {
        content: [
          makeNormal('p1'),
          makeNormal('p2'),
          makeNormal('p3'),
          makeHeading('h1', 1, 'Part One'),
        ],
      },
    })
    const nav = useNavigation(docRef, ref(null))
    // getPageForParagraph mock returns floor(idx/4)+1, so index 3 is page 1
    expect(nav.tocItems.value[0].page).toBe(1)
  })

  it('handles untitled headings', () => {
    const docRef = ref({
      body: {
        content: [
          makeHeading('h1', 1, ''),
        ],
      },
    })
    const nav = useNavigation(docRef, ref(null))
    expect(nav.tocItems.value[0].title).toContain('Untitled')
  })

  it('ignores non-heading paragraphs', () => {
    const docRef = ref({
      body: {
        content: [
          makeNormal('just text'),
          makeNormal('more text'),
        ],
      },
    })
    const nav = useNavigation(docRef, ref(null))
    expect(nav.tocItems.value).toHaveLength(0)
  })

  it('defaults selectedNavId to null', () => {
    const nav = useNavigation(ref({ body: { content: [] } }), ref(null))
    expect(nav.selectedNavId.value).toBeNull()
  })

  it('calls switchToEditor then scrolls on scrollToHeading', () => {
    const switchFn = vi.fn()
    const scrollFn = vi.fn()
    const editorRef = ref({ scrollToParagraph: scrollFn })
    const nav = useNavigation(ref({ body: { content: [] } }), editorRef)
    nav.scrollToHeading('h1', switchFn)
    expect(switchFn).toHaveBeenCalled()
  })

  it('calls renameSection through store', () => {
    const docRef = ref({
      body: {
        content: [makeHeading('h1', 1, 'Old Title')],
      },
    })
    const nav = useNavigation(docRef, ref(null))
    nav.renameSection('h1', 'New Title')
    expect(mockStore.renameSection).toHaveBeenCalledWith('h1', 'New Title')
  })

  it('calls deleteHeading through store and clears selection', async () => {
    const docRef = ref({
      body: {
        content: [makeHeading('h1', 1, 'Title')],
      },
    })
    const nav = useNavigation(docRef, ref(null))
    nav.selectedNavId.value = 'h1'
    await nav.deleteHeading('h1')
    expect(mockStore.deleteHeading).toHaveBeenCalledWith('h1')
    expect(nav.selectedNavId.value).toBeNull()
  })

  it('generates TOC with page numbers for multiple headings', () => {
    const docRef = ref({
      body: {
        content: [
          makeNormal('p1'),
          makeNormal('p2'),
          makeNormal('p3'),
          makeHeading('h1', 1, 'Part One'),
          makeNormal('p4'),
          makeHeading('h2', 2, 'Chapter 1'),
          makeNormal('p5'),
          makeNormal('p6'),
        ],
      },
    })
    const nav = useNavigation(docRef, ref(null))
    // getPageForParagraph mock: floor(idx/4)+1
    expect(nav.tocItems.value).toHaveLength(2)
    expect(nav.tocItems.value[0].page).toBe(Math.floor(3 / 4) + 1)
    expect(nav.tocItems.value[1].page).toBe(Math.floor(5 / 4) + 1)
  })
})
