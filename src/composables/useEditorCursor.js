// Editor cursor / caret / selection helpers, extracted from editorDisplay.vue
// (roadmap 5.6). These are pure DOM operations — none of them hold reactive
// state or know about Vue. The few that need the editor root (to bound a walk
// to the sheet, or to confirm a selection is inside it) take `root` as a
// parameter; editorDisplay passes `sheetRef.value`. The rest operate on the
// live `window.getSelection()` or on element/range arguments they're handed.
//
// Why pure functions (not a `use*` factory): the prevailing pattern in this
// cluster is a pure-function module (useSearchHighlights.js, useParagraphHTML.js,
// useSectionBlocks.js) — only useSectionFormat is a factory, and only because it
// owns shared mutable prefs. These helpers own no state, so a flat module of
// named exports is the right shape, and it's directly unit-testable in jsdom
// with a real `<div>` root (mirroring useSearchHighlights.test.js).

/// Build the DOM selector for a block key produced by `blockKey` (in
/// useEditorReconcile.js) / `bookmarkSelection` (below). A section-title key is
/// `'title:<sectionId>'`; a paragraph key is `'para:<paragraphId>'`. The kind
/// prefix keeps the section and paragraph id namespaces separate, so a section
/// id and a paragraph id that happen to coincide can never collide.
export function blockSelector(key) {
  if (key.startsWith('title:')) return `[data-section-id="${key.slice(6)}"]`
  return `[data-para-id="${key.slice(5)}"]`
}

/// The `.paragraph` block element containing the caret, or null when the
/// selection is outside a paragraph. Walks up from the selection anchor until it
/// reaches a `.paragraph` ancestor. (Editor blocks are a flat sibling list, so
/// the paragraph is always an ancestor of the caret's text node, never a
/// descendant.)
export function getParagraphAtCursor() {
  const sel = window.getSelection()
  if (!sel.rangeCount) return null
  let node = sel.anchorNode
  if (!node) return null
  let el = node.nodeType === 3 ? node.parentElement : node
  while (el && !el.classList?.contains('paragraph')) {
    el = el.parentElement
  }
  return el || null
}

/// The `.section-title` block element containing the caret, or null. Same walk
/// as `getParagraphAtCursor` but for the section-title marker that heads each
/// section's block run.
export function getSectionTitleAtCursor() {
  const sel = window.getSelection()
  if (!sel.rangeCount) return null
  let node = sel.anchorNode
  if (!node) return null
  let el = node.nodeType === 3 ? node.parentElement : node
  while (el && !el.classList?.contains('section-title')) {
    el = el.parentElement
  }
  return el || null
}

/// The `data-section-id` of the block (paragraph or section-title) at the caret,
/// or null. Used by the readback fast path (`syncFromDOM`) to limit DOM→model
/// readback to the single section being edited, and by `insertSection` to decide
/// where a new section splices in.
export function getSectionIdAtCursor() {
  const el = getParagraphAtCursor() || getSectionTitleAtCursor()
  if (!el) return null
  return el.dataset.sectionId || null
}

/// True if `range` sits at the very start of `element`. Used by the keydown
/// handler to detect Backspace-at-start (which merges blocks across a section
/// boundary instead of deleting within the block).
export function isCaretAtStart(range, element) {
  const temp = range.cloneRange()
  temp.selectNodeContents(element)
  temp.collapse(true)
  return range.compareBoundaryPoints(Range.START_TO_START, temp) === 0
}

/// True if `range` sits at the very end of `element`. Companion to
/// `isCaretAtStart`; detects Delete-at-end.
export function isCaretAtEnd(range, element) {
  const temp = range.cloneRange()
  temp.selectNodeContents(element)
  temp.collapse(false)
  return range.compareBoundaryPoints(Range.END_TO_END, temp) === 0
}

/// The editable span inside a section-title: `.section-subtitle` for a Chapter
/// (the chapter prefix is locked, non-editable), `.section-title-text` for a
/// Section (the whole title is editable). Falls back to the title element
/// itself when neither span is present (e.g. a freshly inserted title whose
/// spans haven't rendered yet). Bookmark/restore and the keydown handler all
/// operate on this unit so the locked prefix can't be edited or selected into.
export function editableSpanOf(sectionEl) {
  return sectionEl.querySelector('.section-subtitle') ||
    sectionEl.querySelector('.section-title-text') ||
    sectionEl
}

/// Collapse the caret to the start of `el` and make it the active selection.
/// Used to focus the first paragraph of a page (page navigation) and to place
/// the caret in a freshly inserted section's title.
export function placeCursorAtStart(el) {
  const range = document.createRange()
  range.setStart(el, 0)
  range.collapse(true)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
}

/// Snapshot the selection so it can be restored after the DOM patch. Returns
/// `{ key, kind, offset }` where offset is the character count from the start
/// of the editable unit (the paragraph, or the editable title span) to the
/// caret, or null when the selection is outside the sheet. The reconciler
/// bookmarks before patching and restores after, so the caret survives an
/// id-keyed DOM update that didn't touch the caret's block.
export function bookmarkSelection(root) {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const anchor = sel.anchorNode
  if (!anchor || !root.contains(anchor)) return null
  let blockEl = anchor.nodeType === 3 ? anchor.parentElement : anchor
  while (blockEl && blockEl !== root && !blockEl.classList?.contains('paragraph') && !blockEl.classList?.contains('section-title')) {
    blockEl = blockEl.parentElement
  }
  if (!blockEl || blockEl === root) return null
  const kind = blockEl.classList.contains('paragraph') ? 'paragraph' : 'section-title'
  // For a section-title the editable unit is its inner span (the chapter prefix
  // is locked); for a paragraph it is the paragraph itself.
  const unit = kind === 'section-title' ? editableSpanOf(blockEl) : blockEl
  const key = kind === 'paragraph'
    ? 'para:' + blockEl.dataset.paraId
    : 'title:' + blockEl.dataset.sectionId
  // Character offset from the start of the unit to the caret.
  const range = sel.getRangeAt(0).cloneRange()
  const probe = document.createRange()
  probe.selectNodeContents(unit)
  probe.setEnd(range.startContainer, range.startOffset)
  return { key, kind, offset: probe.toString().length }
}

/// Restore the caret saved by `bookmarkSelection`. If the block was removed by
/// the patch, leave the cursor where the browser placed it (acceptable for v1).
/// Walks the unit's text nodes to land at the (clamped) character offset, so the
/// caret ends up at the same visual position even though the surrounding DOM was
/// rebuilt.
export function restoreSelection(root, bookmark) {
  if (!bookmark) return
  const sel = window.getSelection()
  if (!sel) return
  const blockEl = root.querySelector(blockSelector(bookmark.key))
  if (!blockEl) return
  const unit = bookmark.kind === 'section-title' ? editableSpanOf(blockEl) : blockEl
  // Walk text nodes to place the caret at the (clamped) character offset.
  let remaining = Math.max(0, bookmark.offset)
  const walker = document.createTreeWalker(unit, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const len = node.textContent.length
    if (remaining <= len) {
      const range = document.createRange()
      range.setStart(node, remaining)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
      return
    }
    remaining -= len
    node = walker.nextNode()
  }
  // Offset at/past the end: collapse to the end of the unit.
  const range = document.createRange()
  range.selectNodeContents(unit)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

/// Return the plain text of the current selection within the editor sheet, or
/// '' when nothing is selected or the selection lies outside the sheet. Used by
/// the Assistant panel's `selection` scope — the model reads the writer's
/// selected text as context. `root` bounds the check so a selection made in
/// other UI (e.g. the nav drawer) isn't captured.
export function getSelectionText(root) {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return ''
  const text = sel.toString()
  if (!text) return ''
  if (!root) return text
  let node = sel.anchorNode
  let el = node?.nodeType === 3 ? node.parentElement : node
  while (el && el !== root) el = el.parentElement
  return el === root ? text : ''
}

/// Extend the selection to the end of the next paragraph (Cmd+L "select line"):
/// if the caret's paragraph has a following `.paragraph` sibling, grow the
/// selection to include it; otherwise select the whole current paragraph. This
/// matches the writer's expectation that repeated Cmd+L advances line-by-line
/// through the section.
export function selectLine() {
  const sel = window.getSelection()
  if (!sel.rangeCount) return
  const para = getParagraphAtCursor()
  if (!para) return
  const range = sel.getRangeAt(0)
  const endPara = range.endContainer.nodeType === 3
    ? range.endContainer.parentElement.closest('.paragraph')
    : range.endContainer.closest('.paragraph')
  if (endPara && endPara.nextElementSibling && endPara.nextElementSibling.classList.contains('paragraph')) {
    const next = endPara.nextElementSibling
    range.setEndAfter(next.lastChild || next)
    sel.removeAllRanges()
    sel.addRange(range)
  } else {
    const r = document.createRange()
    r.selectNodeContents(para)
    sel.removeAllRanges()
    sel.addRange(r)
  }
}