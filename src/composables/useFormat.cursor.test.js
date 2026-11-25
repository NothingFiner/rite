// The caret signal behind the format toggles (SPEC.md S-125).
//
// Three buttons must know whether there is anything to format. The hard case is
// a focus move that leaves the selection alone, which arrives as no
// selectionchange at all.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useFormat } from './useFormat.js'

function mountSheet() {
  const sheet = document.createElement('div')
  sheet.className = 'editor-sheet'
  document.body.appendChild(sheet)
  const format = useFormat(ref({ $el: sheet, syncFromDOM: vi.fn() }), vi.fn())
  return { sheet, format }
}

/// jsdom will not focus a plain contenteditable div, so the focus position the
/// composable reads is set directly. That is the input its predicate takes.
function focusOn(element) {
  Object.defineProperty(document, 'activeElement', { value: element, configurable: true })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useFormat cursor state', () => {
  it('S-125: reports the caret inside the editor and outside it', () => {
    const { sheet, format } = mountSheet()
    const outside = document.createElement('button')
    document.body.appendChild(outside)

    focusOn(outside)
    format.syncCursorActive()
    expect(format.cursorActive.value).toBe(false)

    focusOn(sheet)
    format.syncCursorActive()
    expect(format.cursorActive.value).toBe(true)

    // A node inside the sheet counts too: the caret is a text node's parent.
    const paragraph = document.createElement('p')
    sheet.appendChild(paragraph)
    focusOn(paragraph)
    format.syncCursorActive()
    expect(format.cursorActive.value).toBe(true)
  })

  it('S-125: follows focus leaving the sheet without a selection change', () => {
    const { sheet, format } = mountSheet()
    const outside = document.createElement('button')
    document.body.appendChild(outside)

    focusOn(sheet)
    sheet.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(format.cursorActive.value).toBe(true)

    // No selection change here: only the focus move tells the composable.
    focusOn(outside)
    outside.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    expect(format.cursorActive.value).toBe(false)
  })
})
