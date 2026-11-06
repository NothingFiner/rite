import { describe, it, expect } from 'vitest'
import { resolveTabAction } from './useEditorTabKey.js'

// The Tab key's meaning (SPEC.md 5.18), reduced to a pure decision. jsdom cannot
// exercise a real caret; the e2e layer proves the editor performs the decision.

const base = {
  key: 'Tab',
  ctrlKey: false,
  shiftKey: false,
  hasSelection: false,
  atParagraphStart: false,
  indent: 0,
  tabBeforeCaret: false,
}

describe('resolveTabAction', () => {
  it('S-006: Shift+Tab at a paragraph start lowers the indent one 0.5-inch step and stops at 0', () => {
    expect(resolveTabAction({ ...base, shiftKey: true, atParagraphStart: true, indent: 0.5 }))
      .toEqual({ type: 'set-indent', indent: 0 })
    expect(resolveTabAction({ ...base, shiftKey: true, atParagraphStart: true, indent: 1 }))
      .toEqual({ type: 'set-indent', indent: 0.5 })
    expect(resolveTabAction({ ...base, shiftKey: true, atParagraphStart: true, indent: 0 }))
      .toEqual({ type: 'none' })
  })

  it('S-011: Shift+Tab deletes the tab before the caret and otherwise does nothing', () => {
    expect(resolveTabAction({ ...base, shiftKey: true, tabBeforeCaret: true }))
      .toEqual({ type: 'delete-tab' })
    // No tab to the left and not at a paragraph start: nothing may change.
    expect(resolveTabAction({ ...base, shiftKey: true, atParagraphStart: false, tabBeforeCaret: false }))
      .toEqual({ type: 'none' })
  })

  it('S-010: Ctrl+Tab is an unconditional literal tab', () => {
    expect(resolveTabAction({ ...base, ctrlKey: true, atParagraphStart: true, indent: 1 }))
      .toEqual({ type: 'insert-tab' })
    expect(resolveTabAction({ ...base, ctrlKey: true, shiftKey: true, atParagraphStart: false }))
      .toEqual({ type: 'insert-tab' })
  })
})
