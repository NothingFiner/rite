// The Tab key's meaning in the editor, as a pure decision.
//
// The editor is a contenteditable, so the key handler needs a rule for what
// Tab / Shift+Tab / Ctrl+Tab do at a given caret position. Keeping that rule
// here (no DOM, no Vue) makes it unit-testable; `editorDisplay.vue` performs the
// returned action.
//
// Contract — see SPEC.md 5.18, decisions 1–3. Checked top to bottom:
//
//   any key other than Tab
//     -> { type: 'none' }
//   Ctrl+Tab, with or without Shift, selection, or caret position
//     -> { type: 'insert-tab' }
//   Shift+Tab with a tab character immediately before the caret
//     -> { type: 'delete-tab' }
//   Shift+Tab at the start of a paragraph with indent > 0
//     -> { type: 'set-indent', indent: <max(0, current - 0.5)> }
//   Shift+Tab anywhere else
//     -> { type: 'none' }
//   plain Tab with a selection
//     -> { type: 'insert-tab' }
//   plain Tab, caret at the start of a paragraph, no selection
//     -> { type: 'set-indent', indent: <current + 0.5, in inches> }
//   plain Tab anywhere else, no selection
//     -> { type: 'insert-tab' }
//
// `indent` is the paragraph's effective first-line indent in inches (the
// automatic rule already resolved: 0 for a section's first paragraph, 0.5 after
// a body paragraph). A `set-indent` action makes the value explicit.

export const TAB_STEP_INCHES = 0.5

// Indents are inches quantised to hundredths, so float dust (0.7 - 0.5) never
// reaches the document model.
function roundIndent(inches) {
  return Math.round(inches * 100) / 100
}

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
export function resolveTabAction(ctx) {
  const {
    key,
    ctrlKey = false,
    shiftKey = false,
    hasSelection = false,
    atParagraphStart = false,
    indent = 0,
    tabBeforeCaret = false,
  } = ctx

  if (key !== 'Tab') return { type: 'none' }

  // Ctrl+Tab is the only way to get a literal tab at a paragraph start, so it
  // beats every other rule.
  if (ctrlKey) return { type: 'insert-tab' }

  if (shiftKey) {
    // Shift+Tab removes, it does not leave: a tab to the left is deleted
    // outright, an indent is lowered one step, anything else is untouched.
    if (tabBeforeCaret) return { type: 'delete-tab' }
    if (atParagraphStart && indent > 0) {
      return { type: 'set-indent', indent: roundIndent(Math.max(0, indent - TAB_STEP_INCHES)) }
    }
    return { type: 'none' }
  }

  // Plain Tab replaces a selection with a literal tab; the writer is writing,
  // not indenting.
  if (hasSelection) return { type: 'insert-tab' }

  if (atParagraphStart) {
    return { type: 'set-indent', indent: roundIndent(indent + TAB_STEP_INCHES) }
  }
  return { type: 'insert-tab' }
}
