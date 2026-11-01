import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { useFocusMode } from './useFocusMode.js'

// Focus / typewriter mode (roadmap 5.3). jsdom has no layout, so caret
// centring (S-016..S-018) is covered in e2e/focus-mode.spec.js; what lives here
// is the mode's state, its view-scoping, and its relationship with the drawers.

/// Build a fake editor ref holding a real `.editor-sheet` element, so the
/// "focus the sheet" sentence can be observed through a focus spy. The sheet
/// stays attached to the document, mirroring a mounted editor.
function createEditorRef() {
  const root = document.createElement('div')
  const sheet = document.createElement('div')
  sheet.className = 'editor-sheet'
  sheet.focus = vi.fn()
  root.appendChild(sheet)
  document.body.appendChild(root)
  return { ref: ref({ $el: root }), sheet, root }
}

function createDeps(overrides = {}) {
  const editor = createEditorRef()
  const deps = {
    viewMode: ref('editor'),
    editorRef: editor.ref,
    leftDrawerOpen: ref(false),
    rightDrawerOpen: ref(false),
    ...overrides,
  }
  return { deps, editor }
}

describe('useFocusMode', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('S-001: should start inactive every time the app starts', () => {
    const { deps } = createDeps()

    const focusMode = useFocusMode(deps)

    expect(focusMode.active.value).toBe(false)
  })

  it('S-002: should activate on toggle and deactivate on the next toggle', () => {
    const { deps } = createDeps()
    const focusMode = useFocusMode(deps)

    focusMode.toggle()
    expect(focusMode.active.value).toBe(true)

    focusMode.toggle()
    expect(focusMode.active.value).toBe(false)
  })

  it('S-003: should deactivate when the view changes from editor to manuscript', async () => {
    const { deps } = createDeps()
    const focusMode = useFocusMode(deps)
    focusMode.toggle()
    expect(focusMode.active.value).toBe(true)

    deps.viewMode.value = 'manuscript'
    await nextTick()

    expect(focusMode.active.value).toBe(false)
  })

  it('S-003: should deactivate when the view changes from editor to history', async () => {
    const { deps } = createDeps()
    const focusMode = useFocusMode(deps)
    focusMode.toggle()
    expect(focusMode.active.value).toBe(true)

    deps.viewMode.value = 'history'
    await nextTick()

    expect(focusMode.active.value).toBe(false)
  })

  it('S-004: should not activate on toggle while the manuscript view is showing', () => {
    const { deps } = createDeps({ viewMode: ref('manuscript') })
    const focusMode = useFocusMode(deps)

    focusMode.toggle()

    expect(focusMode.active.value).toBe(false)
  })

  it('S-004: should not activate on toggle while the history view is showing', () => {
    const { deps } = createDeps({ viewMode: ref('history') })
    const focusMode = useFocusMode(deps)

    focusMode.toggle()

    expect(focusMode.active.value).toBe(false)
  })

  it('S-008: should close an open left drawer when it activates', () => {
    const { deps } = createDeps({ leftDrawerOpen: ref(true) })
    const focusMode = useFocusMode(deps)

    focusMode.toggle()

    expect(focusMode.active.value).toBe(true)
    expect(deps.leftDrawerOpen.value).toBe(false)
  })

  it('S-008: should close an open right drawer when it activates', () => {
    const { deps } = createDeps({ rightDrawerOpen: ref(true) })
    const focusMode = useFocusMode(deps)

    focusMode.toggle()

    expect(focusMode.active.value).toBe(true)
    expect(deps.rightDrawerOpen.value).toBe(false)
  })

  it('S-009: should refuse a drawer open while focus mode is active', () => {
    const { deps } = createDeps()
    const focusMode = useFocusMode(deps)
    focusMode.toggle()
    expect(focusMode.active.value).toBe(true)

    const allowed = focusMode.canOpenDrawer()

    expect(allowed).toBe(false)
    expect(focusMode.active.value).toBe(true)
  })

  it('S-009: should allow a drawer open when focus mode is inactive', () => {
    const { deps } = createDeps()
    const focusMode = useFocusMode(deps)

    const allowed = focusMode.canOpenDrawer()

    expect(allowed).toBe(true)
  })

  it('S-010: should focus the editor sheet when entering with no caret inside the editor', () => {
    const { deps, editor } = createDeps()
    const focusMode = useFocusMode(deps)

    focusMode.toggle()

    expect(editor.sheet.focus).toHaveBeenCalled()
  })
})
