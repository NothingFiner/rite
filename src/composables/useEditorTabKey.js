// The Tab key's meaning in the editor, as a pure decision.
//
// The editor is a contenteditable, so the key handler needs a rule for what
// Tab / Shift+Tab / Ctrl+Tab do at a given caret position. Keeping that rule
// here (no DOM, no Vue) makes it unit-testable; `editorDisplay.vue` performs the
// returned action.
//
// Contract — see SPEC.md 5.18, decisions 1–3:
//
//   plain Tab, caret at the start of a paragraph, no selection
//     -> { type: 'set-indent', indent: <current + 0.5, in inches> }
//   plain Tab anywhere else, or with a selection
//     -> { type: 'insert-tab' }
//   Ctrl+Tab (with or without Shift)
//     -> { type: 'insert-tab' }
//   Shift+Tab with a tab character immediately before the caret
//     -> { type: 'delete-tab' }
//   Shift+Tab at the start of a paragraph with indent > 0
//     -> { type: 'set-indent', indent: <max(0, current - 0.5)> }
//   Shift+Tab anywhere else
//     -> { type: 'none' }
//   any other key
//     -> { type: 'none' }
//
// `indent` is the paragraph's effective first-line indent in inches (the
// automatic rule already resolved: 0 for a section's first paragraph, 0.5 after
// a body paragraph). A `set-indent` action makes the value explicit.
//
// Stub: the body returns the no-op action so the tests fail on their
// assertions, not on an import error.

export const TAB_STEP_INCHES = 0.5

/**
 * @param {object} ctx
 * @param {string} ctx.key
 * @param {boolean} [ctx.ctrlKey]
 * @param {boolean} [ctx.shiftKey]
 * @param {boolean} [ctx.hasSelection]
 * @param {boolean} [ctx.atParagraphStart]
 * @param {number} [ctx.indent]          effective first-line indent, inches
 * @param {boolean} [ctx.tabBeforeCaret]
 * @returns {{ type: 'insert-tab' | 'set-indent' | 'delete-tab' | 'none', indent?: number }}
 */
export function resolveTabAction(ctx) { // eslint-disable-line no-unused-vars
  return { type: 'none' }
}
