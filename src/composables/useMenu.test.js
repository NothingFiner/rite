import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'

// The `menu` event surface (SPEC.md S-016 … S-018). Rust owns the menu and emits
// one window event whose payload is the item id; this module runs the action.
//
// `listen` is mocked exactly like useChatManager.test.js: it resolves to an
// unlisten function and captures the handler so a test can deliver an event.

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

import { listen } from '@tauri-apps/api/event'
import {
  MENU_EVENT,
  createMenuActions,
  runMenuAction,
  useMenuActions,
} from './useMenu.js'

let listenHandlers = {}
let wrapper = null

function makeDeps() {
  return {
    store: { undo: vi.fn(), redo: vi.fn() },
    fileIO: {
      openFile: vi.fn(),
      saveFile: vi.fn(),
      saveFileAs: vi.fn(),
      importFile: vi.fn(),
    },
    exports: {
      exportPlainText: vi.fn(),
      exportMarkdown: vi.fn(),
      exportDocx: vi.fn(),
      exportEpub: vi.fn(),
    },
    newDocument: { onNewFile: vi.fn() },
  }
}

function mountMenu(actions) {
  const Host = defineComponent({
    setup() {
      useMenuActions(actions)
      return () => null
    },
  })
  return mount(Host)
}

beforeEach(() => {
  vi.clearAllMocks()
  listenHandlers = {}
  listen.mockImplementation(async (event, handler) => {
    listenHandlers[event] = handler
    return vi.fn(() => {
      delete listenHandlers[event]
    })
  })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('menu event routing', () => {
  it('S-016: should run the matching action when a menu event arrives with a known id', async () => {
    const action = vi.fn()
    wrapper = mountMenu({ save: action })
    await flushPromises()

    expect(listenHandlers[MENU_EVENT]).toBeTypeOf('function')
    listenHandlers[MENU_EVENT]({ payload: 'save' })

    expect(action).toHaveBeenCalledTimes(1)
  })

  it('S-017: should ignore a menu event with an unknown id without throwing', async () => {
    const action = vi.fn()
    wrapper = mountMenu({ save: action })
    await flushPromises()

    expect(listenHandlers[MENU_EVENT]).toBeTypeOf('function')
    expect(() => listenHandlers[MENU_EVENT]({ payload: 'not_a_menu_item' })).not.toThrow()

    expect(action).not.toHaveBeenCalled()
  })

  it('S-018: should map undo and redo to the document store', () => {
    const deps = makeDeps()
    const actions = createMenuActions(deps)

    expect(typeof actions.undo).toBe('function')
    expect(typeof actions.redo).toBe('function')

    expect(runMenuAction('undo', actions)).toBe(true)
    expect(runMenuAction('redo', actions)).toBe(true)

    expect(deps.store.undo).toHaveBeenCalledTimes(1)
    expect(deps.store.redo).toHaveBeenCalledTimes(1)
  })
})
