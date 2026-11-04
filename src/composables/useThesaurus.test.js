import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'

// Selective context-menu takeover and word shaping (SPEC.md S-014 … S-021).
//
// The takeover is the delicate part: the webview's own right-click menu must
// survive everywhere except over exactly one word, because Copy-on-a-phrase and
// the spellchecker's Learn / Ignore live there. So the decision is a pure
// function over (selection text, word under the pointer) and gets tested as
// one; the mounted test then proves the real DOM path prevents the default menu
// and asks Rust for the word menu at the click point.
//
// `invoke` is mocked: this is a unit layer, no Tauri runtime, no window.

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))

import { invoke } from '@tauri-apps/api/core'
import {
  placePopover,
  shapeReplacement,
  splitAffixes,
  takeOverWord,
  useThesaurus,
  wordAtOffset,
} from './useThesaurus.js'

let wrapper = null

/**
 * Mount a host that installs the composable over a real editor sheet, so
 * `document.caretRangeFromPoint` has a text node to resolve into.
 */
function mountSheet(text = 'a happy day') {
  const Host = defineComponent({
    // No returned render function: a `setup()` that returns one makes Vue
    // ignore `template`, and the host would mount as a comment node.
    setup() {
      useThesaurus()
    },
    template: `<div class="editor-sheet"><p>${text}</p></div>`,
  })
  wrapper = mount(Host, { attachTo: document.body })
  const sheet = wrapper.element
  const node = sheet.querySelector('p').firstChild
  return { sheet, node }
}

function caretAt(node, offset) {
  document.caretRangeFromPoint = () => {
    const range = document.createRange()
    range.setStart(node, offset)
    return range
  }
}

function rightClick(sheet, { x = 120, y = 80 } = {}) {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  })
  sheet.dispatchEvent(event)
  return event
}

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue(null)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  delete document.caretRangeFromPoint
})

describe('taking over the context menu', () => {
  it('S-014: takes over a collapsed caret inside a word', () => {
    expect(takeOverWord('', 'happy')).toBe('happy')
    expect(wordAtOffset('a happy day', 4)).toEqual({ word: 'happy', start: 2, end: 7 })
  })

  it('S-015: takes over when exactly that one word is selected', () => {
    expect(takeOverWord('happy', 'happy')).toBe('happy')
    expect(takeOverWord(' happy ', 'happy')).toBe('happy')
  })

  it('S-016: leaves a multi-word selection to the native menu', () => {
    expect(takeOverWord('happy day', 'happy')).toBeNull()
    expect(takeOverWord('happy day', 'day')).toBeNull()
  })

  it('S-017: does not take over where there is no word', () => {
    expect(takeOverWord('', null)).toBeNull()
    expect(takeOverWord('', '')).toBeNull()
    expect(takeOverWord('', '   ')).toBeNull()
    expect(wordAtOffset('   ', 1)).toBeNull()
    expect(wordAtOffset('a  day', 2)).toBeNull()
  })

  it('S-018: prevents the native menu and asks Rust for the word menu at the click point', async () => {
    const { sheet, node } = mountSheet()
    caretAt(node, 4)

    const event = rightClick(sheet, { x: 120, y: 80 })
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
    expect(invoke).toHaveBeenCalledWith('show_word_menu', { x: 120, y: 80 })
  })
})

describe('keeping the writer’s word shape', () => {
  it('S-019: splits leading punctuation, the core word and trailing punctuation', () => {
    expect(splitAffixes('Happy,')).toEqual({ prefix: '', core: 'Happy', suffix: ',' })
    expect(splitAffixes('word')).toEqual({ prefix: '', core: 'word', suffix: '' })
    expect(splitAffixes('"well-known."')).toEqual({
      prefix: '"',
      core: 'well-known',
      suffix: '."',
    })
  })

  it('S-020: a replacement keeps the original leading capitalisation', () => {
    expect(shapeReplacement('glad', splitAffixes('Happy,'))).toBe('Glad,')
    expect(shapeReplacement('glad', splitAffixes('happy'))).toBe('glad')
  })

  it('S-021: a replacement keeps the original trailing punctuation', () => {
    expect(shapeReplacement('term', splitAffixes('word.'))).toBe('term.')
    expect(shapeReplacement('term', splitAffixes('word'))).toBe('term')
  })
})

describe('placing the popover in the window', () => {
  const POPOVER = { width: 280, height: 300 }
  const WINDOW = { viewportWidth: 1200, viewportHeight: 800 }

  it('S-037: opens at the click point when there is room, and flips or lifts when there is not', () => {
    // Room on both axes: the click point is the top-left corner.
    expect(placePopover({ x: 100, y: 80, ...POPOVER, ...WINDOW })).toEqual({ left: 100, top: 80 })

    // Right edge: 1000 + 280 crosses 1200, so the popover moves to the left of
    // the click instead of hanging off the window.
    expect(placePopover({ x: 1000, y: 80, ...POPOVER, ...WINDOW }).left).toBe(720)
    expect(placePopover({ x: 1000, y: 80, ...POPOVER, ...WINDOW }).top).toBe(80)

    // Bottom edge: it lifts so its own height fits.
    expect(placePopover({ x: 100, y: 650, ...POPOVER, ...WINDOW }).top).toBe(492)

    // A window smaller than the popover cannot be satisfied by moving it: the
    // position pins to the margin instead of going negative, and the stylesheet
    // caps the element at the same size (`max-width` / `max-height`).
    const cramped = placePopover({
      x: 390,
      y: 290,
      width: 500,
      height: 400,
      viewportWidth: 400,
      viewportHeight: 300,
    })
    expect(cramped).toEqual({ left: 8, top: 8 })
  })
})
