import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import DocumentRenderer from './DocumentRenderer.vue'

// DocumentRenderer is a switch plus a forwarding surface. App.vue holds one ref
// to it and calls editor methods on it, so the contract that matters is: the
// right view is mounted for the mode, and every call reaches the view that is
// actually on screen (5.1 made navigation view-aware).

// Method spies live in `vi.hoisted` so the module factory and the tests share
// ONE object: Vue binds instance methods, so `vm.scrollToSection` is a bound
// wrapper, not the spy itself.
const editorMethods = vi.hoisted(() => ({
  syncFromDOM: vi.fn(),
  renderFromDoc: vi.fn(),
  insertSection: vi.fn(),
  scrollToParagraph: vi.fn(),
  scrollToSection: vi.fn(),
  scrollToPage: vi.fn(),
  getCurrentPage: vi.fn(() => 4),
  selectLine: vi.fn(),
  navigatePage: vi.fn(),
  navigateSectionPage: vi.fn(),
  applySearchHighlights: vi.fn(),
  clearSearchHighlights: vi.fn(),
  getSelectionText: vi.fn(() => 'selected text'),
}))

const manuscriptMethods = vi.hoisted(() => ({
  scrollToSection: vi.fn(),
  scrollToPage: vi.fn(),
  getCurrentPage: vi.fn(() => 9),
  applySearchHighlights: vi.fn(),
  clearSearchHighlights: vi.fn(),
}))

vi.mock('./editor/editorDisplay.vue', () => ({
  default: {
    name: 'EditorDisplay',
    props: ['modelValue', 'pageBreaks', 'theme', 'zoom', 'margin'],
    emits: ['syncSections', 'deleteSection', 'update'],
    data: () => ({ hasSelection: true }),
    template: '<div class="editor-stub" />',
    methods: editorMethods,
  },
}))

vi.mock('./manuscript/manuscriptDisplay.vue', () => ({
  default: {
    name: 'ManuscriptDisplay',
    props: ['modelValue', 'pageBreaks', 'wordCount', 'tocItems'],
    template: '<div class="manuscript-stub" />',
    methods: manuscriptMethods,
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function mountRenderer(props = {}) {
  return mount(DocumentRenderer, {
    props: { modelValue: { title: 'Doc', sections: [] }, ...props },
  })
}

const editorOf = (wrapper) => wrapper.findComponent({ name: 'EditorDisplay' })
const manuscriptOf = (wrapper) => wrapper.findComponent({ name: 'ManuscriptDisplay' })

describe('DocumentRenderer', () => {
  it('shows the editor by default and only the editor', () => {
    const wrapper = mountRenderer()

    expect(editorOf(wrapper).exists()).toBe(true)
    expect(manuscriptOf(wrapper).exists()).toBe(false)
  })

  it('shows the manuscript when the mode says so and only the manuscript', () => {
    const wrapper = mountRenderer({ mode: 'manuscript' })

    expect(manuscriptOf(wrapper).exists()).toBe(true)
    expect(editorOf(wrapper).exists()).toBe(false)
  })

  it('forwards the editor’s own props', () => {
    const wrapper = mountRenderer({ theme: 2, zoom: 20, margin: 'manuscript' })
    const editor = editorOf(wrapper)

    expect(editor.props('modelValue')).toEqual({ title: 'Doc', sections: [] })
    expect(editor.props('theme')).toBe(2)
    expect(editor.props('zoom')).toBe(20)
    expect(editor.props('margin')).toBe('manuscript')
  })

  it('forwards the shared pagination and word count to whichever view is active', () => {
    const pageBreaks = [{ page: 2, top: 400 }]
    const editor = editorOf(mountRenderer({ pageBreaks }))
    expect(editor.props('pageBreaks')).toEqual(pageBreaks)

    const manuscript = manuscriptOf(
      mountRenderer({ mode: 'manuscript', pageBreaks, wordCount: 1200, tocItems: [{ id: 's1' }] }),
    )
    expect(manuscript.props('pageBreaks')).toEqual(pageBreaks)
    expect(manuscript.props('wordCount')).toBe(1200)
    expect(manuscript.props('tocItems')).toEqual([{ id: 's1' }])
  })

  it('re-emits the editor events under the names App consumes', async () => {
    const wrapper = mountRenderer()
    const editor = editorOf(wrapper)

    editor.vm.$emit('syncSections', [{ id: 's1' }])
    editor.vm.$emit('update')
    editor.vm.$emit('deleteSection', 's1')

    expect(wrapper.emitted('syncSections')[0]).toEqual([[{ id: 's1' }]])
    expect(wrapper.emitted('update')).toHaveLength(1)
    expect(wrapper.emitted('deleteSection')[0]).toEqual(['s1'])
  })

  it('routes navigation to the active view, not always to the editor', () => {
    const editorWrapper = mountRenderer()
    editorWrapper.vm.scrollToSection('s1')
    editorWrapper.vm.scrollToPage(3)
    expect(editorMethods.scrollToSection).toHaveBeenCalledWith('s1')
    expect(editorMethods.scrollToPage).toHaveBeenCalledWith(3)
    expect(editorWrapper.vm.getCurrentPage()).toBe(4)

    const manuscriptWrapper = mountRenderer({ mode: 'manuscript' })
    manuscriptWrapper.vm.scrollToSection('s1')
    manuscriptWrapper.vm.scrollToPage(3)
    expect(manuscriptMethods.scrollToSection).toHaveBeenCalledWith('s1')
    expect(manuscriptMethods.scrollToPage).toHaveBeenCalledWith(3)
    expect(manuscriptWrapper.vm.getCurrentPage()).toBe(9)
  })

  it('routes search highlighting to the active view', () => {
    const manuscriptWrapper = mountRenderer({ mode: 'manuscript' })
    const matches = [{ paragraphId: 'p1' }]

    manuscriptWrapper.vm.applySearchHighlights(matches, 1)
    manuscriptWrapper.vm.clearSearchHighlights()

    expect(manuscriptMethods.applySearchHighlights).toHaveBeenCalledWith(matches, 1)
    expect(manuscriptMethods.clearSearchHighlights).toHaveBeenCalled()
  })

  it('keeps editor-only operations on the editor even in manuscript mode', () => {
    // The editor branch is unmounted in manuscript mode, so the forwarding
    // methods reach a null ref. They must be silent no-ops, not throws — App
    // calls them without knowing which view is mounted.
    const wrapper = mountRenderer({ mode: 'manuscript' })

    expect(() => wrapper.vm.syncFromDOM()).not.toThrow()
    expect(() => wrapper.vm.navigatePage(1)).not.toThrow()
    expect(wrapper.vm.getSelectionText()).toBe('')
  })

  it('exposes the editor selection state and reports none in manuscript mode', () => {
    const editorWrapper = mountRenderer()
    expect(editorWrapper.vm.hasSelection).toBe(true)

    const manuscriptWrapper = mountRenderer({ mode: 'manuscript' })
    expect(manuscriptWrapper.vm.hasSelection).toBe(false)
  })

  it('reports page 1 when the active view cannot answer', () => {
    const wrapper = mount(DocumentRenderer, {
      props: { modelValue: { title: 'Doc', sections: [] } },
      global: {
        stubs: {
          EditorDisplay: { name: 'EditorDisplay', template: '<div />' },
        },
      },
    })

    expect(wrapper.vm.getCurrentPage()).toBe(1)
  })
})
