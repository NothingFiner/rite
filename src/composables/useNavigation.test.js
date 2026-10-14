import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useNavigation } from './useNavigation.js'

// Shared pagination is now passed INTO useNavigation (roadmap 2.5) instead of
// instantiated inside it, so we pass a plain mock object with the deterministic
// page-per-block function the old module mock provided.
const mockPagination = {
  getPageForBlock: (idx) => Math.floor(idx / 4) + 1,
}

// useSectionFormat reads localStorage on loadPrefs but useNavigation calls
// useSectionFormat() which shares a module-level ref — fine without loadPrefs.
const mockStore = {
  renameSection: vi.fn(),
  deleteSection: vi.fn(),
  changeSectionType: vi.fn(),
  setSectionHidden: vi.fn(),
}

vi.mock('../stores/document.js', () => ({
  useDocumentStore: () => mockStore,
}))

function makeSection(id, title, sectionType = 'section', paragraphs = []) {
  return { id, title, sectionType, paragraphs }
}

function makePara(id, content = '') {
  return { id, elements: [{ textRun: { content, textStyle: {} } }] }
}

describe('useNavigation', () => {
  it('generates empty TOC for empty document', () => {
    const docRef = ref({ sections: [] })
    const nav = useNavigation(docRef, ref(null), mockPagination)
    expect(nav.tocItems.value).toEqual([])
  })

  it('generates one flat TOC item per section (no grouping, no levels)', () => {
    const docRef = ref({
      sections: [
        makeSection('s1', 'Prologue', 'section', [makePara('p1', 'text')]),
        makeSection('s2', 'The Arrival', 'chapter', [makePara('p2', 'text')]),
        makeSection('s3', 'Departure', 'chapter', [makePara('p3', 'text')]),
      ],
    })
    const nav = useNavigation(docRef, ref(null), mockPagination)
    expect(nav.tocItems.value).toHaveLength(3)
    expect(nav.tocItems.value[0]).toMatchObject({ id: 's1', sectionType: 'section', title: 'Prologue' })
    expect(nav.tocItems.value[1]).toMatchObject({ id: 's2', sectionType: 'chapter', title: 'The Arrival' })
  })

  it('derives chapter numbers (chapterIndex) from position among chapter sections', () => {
    const docRef = ref({
      sections: [
        makeSection('s1', '', 'section', [makePara('p1')]),
        makeSection('s2', 'First', 'chapter', [makePara('p2')]),
        makeSection('s3', '', 'section', [makePara('p3')]),
        makeSection('s4', 'Second', 'chapter', [makePara('p4')]),
      ],
    })
    const nav = useNavigation(docRef, ref(null), mockPagination)
    // s1 (section) -> chapterIndex null; s2 (chapter 1); s3 (section) null; s4 (chapter 2)
    expect(nav.tocItems.value[0].chapterIndex).toBeNull()
    expect(nav.tocItems.value[1].chapterIndex).toBe(1)
    expect(nav.tocItems.value[3].chapterIndex).toBe(2)
  })

  it('renders a chapter display title with derived prefix + subtitle', () => {
    const docRef = ref({
      sections: [makeSection('s1', 'The Arrival', 'chapter', [makePara('p1')])],
    })
    const nav = useNavigation(docRef, ref(null), mockPagination)
    expect(nav.tocItems.value[0].displayTitle).toBe('Chapter 1: The Arrival')
  })

  it('renders a chapter with no subtitle as just the derived number', () => {
    const docRef = ref({
      sections: [makeSection('s1', '', 'chapter', [makePara('p1')])],
    })
    const nav = useNavigation(docRef, ref(null), mockPagination)
    expect(nav.tocItems.value[0].displayTitle).toBe('Chapter 1')
  })

  it('renders an untitled section as "Untitled Section"', () => {
    const docRef = ref({
      sections: [makeSection('s1', '', 'section', [makePara('p1')])],
    })
    const nav = useNavigation(docRef, ref(null), mockPagination)
    expect(nav.tocItems.value[0].displayTitle).toBe('Untitled Section')
  })

  it('computes page numbers via the block index', () => {
    // Block 0 = s1 title, block 1 = p1, block 2 = s2 title, block 3 = p2.
    // getPageForBlock mock: floor(idx/4)+1 → all are page 1 except... all <4 → 1.
    // Add enough paragraphs to push s2's title block to index 4 (page 2).
    const docRef = ref({
      sections: [
        makeSection('s1', 'A', 'section', [makePara('p1'), makePara('p2'), makePara('p3')]),
        makeSection('s2', 'B', 'section', [makePara('p4')]),
      ],
    })
    const nav = useNavigation(docRef, ref(null), mockPagination)
    // s1 title = block 0 → page 1; s2 title = block 4 → page 2
    expect(nav.tocItems.value[0].page).toBe(1)
    expect(nav.tocItems.value[1].page).toBe(2)
  })

  it('defaults selectedNavId to null', () => {
    const nav = useNavigation(ref({ sections: [] }), ref(null))
    expect(nav.selectedNavId.value).toBeNull()
  })

  it('calls switchToEditor then scrolls on scrollToSection', () => {
    const switchFn = vi.fn()
    const scrollFn = vi.fn()
    const editorRef = ref({ scrollToSection: scrollFn })
    const nav = useNavigation(ref({ sections: [] }), editorRef)
    nav.scrollToSection('s1', switchFn)
    expect(switchFn).toHaveBeenCalled()
  })

  it('calls renameSection through the store', () => {
    const nav = useNavigation(ref({ sections: [] }), ref(null))
    nav.renameSection('s1', 'New Title')
    expect(mockStore.renameSection).toHaveBeenCalledWith('s1', 'New Title')
  })

  it('calls deleteSection through the store and clears selection', async () => {
    const nav = useNavigation(ref({ sections: [] }), ref(null))
    nav.selectedNavId.value = 's1'
    await nav.deleteSection('s1')
    expect(mockStore.deleteSection).toHaveBeenCalledWith('s1')
    expect(nav.selectedNavId.value).toBeNull()
  })

  it('calls changeSectionType through the store', async () => {
    const nav = useNavigation(ref({ sections: [] }), ref(null))
    await nav.changeSectionType('s1', 'chapter')
    expect(mockStore.changeSectionType).toHaveBeenCalledWith('s1', 'chapter')
  })

  it('calls setSectionHidden through the store', async () => {
    const nav = useNavigation(ref({ sections: [] }), ref(null))
    await nav.setSectionHidden('s1', true)
    expect(mockStore.setSectionHidden).toHaveBeenCalledWith('s1', true)
  })

  it('tocItems carry the hidden flag (5.10)', () => {
    const docRef = ref({
      sections: [
        { id: 's1', title: 'Epigram', sectionType: 'section', hidden: true, paragraphs: [makePara('p1')] },
        makeSection('s2', 'One', 'chapter', [makePara('p2')]),
      ],
    })
    const nav = useNavigation(docRef, ref(null), mockPagination)
    expect(nav.tocItems.value[0].hidden).toBe(true)
    // The drawer still LISTS hidden sections — hidden only affects what they
    // cost the manuscript/TOC renders.
    expect(nav.tocItems.value).toHaveLength(2)
    expect(nav.tocItems.value[1].hidden).toBe(false)
  })
})