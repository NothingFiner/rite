// The Tab key's meaning in the editor, as a pure decision: no DOM, no Vue, so
// the rules are unit-testable and `editorDisplay.vue` performs the action.
// SPEC.md 5.18, decisions 1–3.
//
// `indent` is the paragraph's effective first-line indent in inches, with the
// automatic rule already resolved; a `set-indent` action makes it explicit.

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
