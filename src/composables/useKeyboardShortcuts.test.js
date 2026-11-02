import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { useKeyboardShortcuts } from './useKeyboardShortcuts.js'

// The focus-mode keyboard surface (roadmap 5.3): the toggle shortcut, its
// view-scoping, and where focus-mode exit sits in the Escape chain.
//
// `useKeyboardShortcuts` installs its listeners on `document` in `onMounted`,
// so every case mounts a host component and dispatches a real KeyboardEvent.

function createDeps(overrides = {}) {
  return {
    store: { undo: vi.fn(), redo: vi.fn() },
    fileIO: { saveFile: vi.fn(), saveFileAs: vi.fn() },
    format: {
      toggleFormat: vi.fn(),
      syncFormatState: vi.fn(),
      updateSelectedWordCount: vi.fn(),
    },
    search: {
      searchVisible: false,
      openSearch: vi.fn(),
      closeSearch: vi.fn(),
    },
    viewMode: ref('editor'),
    leftDrawerOpen: ref(false),
    leftDrawerMode: ref('chapters'),
    addExpanded: ref(false),
    editorRef: ref(null),
    onInsertSection: vi.fn(),
    focusMode: {
      active: ref(false),
      toggle: vi.fn(),
      exit: vi.fn(),
      canOpenDrawer: vi.fn(() => true),
    },
    ...overrides,
  }
}

function mountWith(deps) {
  const Host = defineComponent({
    setup() {
      useKeyboardShortcuts(deps)
      return () => null
    },
  })
  return mount(Host, { attachTo: document.body })
}

function press(init) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  document.dispatchEvent(event)
  return event
}

describe('useKeyboardShortcuts — focus mode', () => {
  let wrapper

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
  })

  it('S-005: should toggle focus mode on Cmd/Ctrl+Shift+F in the editor view', () => {
    const deps = createDeps()
    wrapper = mountWith(deps)

    press({ key: 'F', metaKey: true, shiftKey: true })

    expect(deps.focusMode.toggle).toHaveBeenCalledTimes(1)
  })

  it('S-005: should prevent the shortcut from inserting a character', () => {
    const deps = createDeps()
    wrapper = mountWith(deps)

    const event = press({ key: 'F', metaKey: true, shiftKey: true })

    expect(event.defaultPrevented).toBe(true)
  })

  it('S-005: should toggle focus mode on Ctrl+Shift+F as well', () => {
    const deps = createDeps()
    wrapper = mountWith(deps)

    press({ key: 'f', ctrlKey: true, shiftKey: true })

    expect(deps.focusMode.toggle).toHaveBeenCalledTimes(1)
  })

  it('S-004: should not toggle focus mode on the shortcut in the manuscript view', () => {
    const deps = createDeps({ viewMode: ref('manuscript') })
    wrapper = mountWith(deps)

    press({ key: 'F', metaKey: true, shiftKey: true })

    expect(deps.focusMode.toggle).not.toHaveBeenCalled()
  })

  it('S-004: should not toggle focus mode on the shortcut in the history view', () => {
    const deps = createDeps({ viewMode: ref('history') })
    wrapper = mountWith(deps)

    press({ key: 'F', metaKey: true, shiftKey: true })

    expect(deps.focusMode.toggle).not.toHaveBeenCalled()
  })

  it('S-006: should exit focus mode on Escape when no search panel and no drawer are open', () => {
    const deps = createDeps()
    deps.focusMode.active.value = true
    wrapper = mountWith(deps)

    press({ key: 'Escape' })

    expect(deps.focusMode.exit).toHaveBeenCalled()
  })

  it('S-007: should close the search panel and keep focus mode active on Escape', () => {
    const deps = createDeps()
    deps.focusMode.active.value = true
    deps.search.searchVisible = true
    wrapper = mountWith(deps)

    press({ key: 'Escape' })

    expect(deps.search.closeSearch).toHaveBeenCalled()
    expect(deps.focusMode.exit).not.toHaveBeenCalled()
    expect(deps.focusMode.active.value).toBe(true)
  })

  it('S-009: should not open the sections drawer on Cmd/Ctrl+Enter while focus mode is active', () => {
    const deps = createDeps()
    deps.focusMode.active.value = true
    deps.focusMode.canOpenDrawer = vi.fn(() => false)
    wrapper = mountWith(deps)

    press({ key: 'Enter', metaKey: true })

    expect(deps.leftDrawerOpen.value).toBe(false)
    expect(deps.focusMode.active.value).toBe(true)
  })
})
