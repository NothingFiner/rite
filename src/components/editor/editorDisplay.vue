<template>
  <div
    class="editor-sheet"
    contenteditable="true"
    role="textbox"
    aria-multiline="true"
    aria-label="Manuscript"
    spellcheck="true"
    autocorrect="off"
    autocapitalize="off"
    ref="sheetRef"
    :style="editorStyles"
    @input="onInput"
    @keydown="onKeydown"
    @paste="onPaste"
    @beforeinput="onBeforeinput"
    @mousedown="onMousedown"
  ><!-- SPEC 5.7a: the accessible name is the fixed word Manuscript, never the document title. --></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch, computed, toRef } from 'vue'
import { flattenSections, computeFirstLineIndent, AUTO_FIRST_LINE_INDENT } from '../../composables/useSectionBlocks.js'
import { computeReconcileOps, blockKey, renderBlockHTML } from '../../composables/useEditorReconcile.js'
import { buildEditorHTML } from '../../composables/useEditorRender.js'
import { applySearchHighlights, clearSearchHighlights } from '../../composables/useSearchHighlights.js'
import {
  blockSelector, bookmarkSelection, restoreSelection, editableSpanOf,
  getParagraphAtCursor, getSectionTitleAtCursor, getSectionIdAtCursor,
  isCaretAtStart, isCaretAtEnd, placeCursorAtStart, selectLine,
  getSelectionText as selectionTextWithin,
} from '../../composables/useEditorCursor.js'
import {
  layoutPageBreaks as layoutPageBreaksInSheet,
  navigatePage as navigatePageInSheet,
  navigateSectionPage as navigateSectionPageInSheet,
  scrollToPage as scrollToPageInSheet,
  getCurrentPage as getCurrentPageInSheet,
  focusPageStart as focusPageStartInSheet,
} from '../../composables/useEditorPageNav.js'
import {
  useEditorReadback, PX_PER_INCH,
  blockPlainText, adjustOffsetForReplace, isNonContentBlock, readSectionTitleText,
} from '../../composables/useEditorReadback.js'
import { resolveTabAction } from '../../composables/useEditorTabKey.js'
import { THEMES } from '../../constants/themes.js'
import { generateParagraphId, createSection } from '../../constants/DocumentModel.js'
import { useSectionFormat } from '../../composables/useSectionFormat.js'

const props = defineProps({
  modelValue: Object,
  // One shared `usePagination` lives in App.vue (roadmap 2.5); a per-editor copy
  // would measure cold. Each entry is a block index that starts a new page.
  pageBreaks: { type: Array, default: () => [] },
  theme: { type: [Number, Object], default: 0 },
  zoom: { type: Number, default: 16 },
  margin: { type: String, default: 'compact' },
})
const emit = defineEmits(['syncSections', 'syncSection', 'update', 'deleteSection'])

const sheetRef = ref(null)
// The section the writer is naming inline. While set, only that title is
// editable; Enter, Escape or a click elsewhere locks it.
const freshSectionId = ref(null)
const skipNextWatcher = ref(false)
// The block list the live DOM was rendered from, indents baked. `reconcileEditor`
// diffs against it, and the drift gate compares it back to the DOM.
const lastRenderedBlocks = ref(null)
// Section titles in `lastRenderedBlocks`. A different live count means an edit
// crossed a section boundary, so the localized readback falls back to the full one.
const lastSectionCount = ref(0)
// The last selection inside the sheet. An external change moves focus out before
// `reconcileEditor` runs, so `bookmarkSelection` returns null and this stash is
// what puts the caret back.
const lastEditorSelection = ref(null)
// True while the sheet holds a non-empty selection, so the Assistant panel can
// scope a critique to it live (roadmap 3.2).
const hasSelection = ref(false)
const pageBreaks = toRef(props, 'pageBreaks')
// Handles the readback factory reads through; this component owns the state.
const modelRef = toRef(props, 'modelValue')
const zoomRef = toRef(props, 'zoom')
const sectionFormat = useSectionFormat()

// Only `syncFromDOM` is used here; `fullSyncFromDOM` is its internal fallback.
const { syncFromDOM } = useEditorReadback({
  sheetRef, modelRef, zoomRef, lastRenderedBlocks, lastSectionCount, skipNextWatcher, emit,
})

function editorApplySearchHighlights(matches, currentIndex) {
  applySearchHighlights(sheetRef.value, matches, currentIndex)
}

function editorClearSearchHighlights() {
  clearSearchHighlights(sheetRef.value)
}

const editorStyles = computed(() => {
  // SPEC 5.13 "Rendering the sheet".
  // `props.theme` is either a preset index or the `currentTheme` object from
  // `useTheme.js`. A mixed background, text and accent choice has no preset
  // index, so the object resolves as itself. Numbers resolve through
  // `THEMES[props.theme]`.
  const t = typeof props.theme === 'object' && props.theme !== null
    ? props.theme
    : (THEMES[props.theme] || THEMES[0])
  const pad = props.margin === 'manuscript' ? '96px' : '24px 32px'
  return {
    fontSize: props.zoom + 'px',
    background: t.bg,
    color: t.text,
    padding: pad,
// A theme change recolours the page-break rules through the computed, with no
// `innerHTML` rebuild.
    '--page-break-color': t.text,
  }
})

// --- Section-title locking ---------------------------------------------------
// Titles are locked except the one being named inline; the derived "Chapter N: "
// prefix is never editable.

function applySectionTitleLocks() {
  const root = sheetRef.value
  if (!root) return
  const titles = root.querySelectorAll('.section-title')
  titles.forEach(el => {
    if (el.dataset.sectionId !== freshSectionId.value) {
      el.setAttribute('contenteditable', 'false')
    } else {
      el.setAttribute('contenteditable', 'true')
    }
  })
}

function lockFreshSection() {
  if (!freshSectionId.value) return
  const root = sheetRef.value
  if (root) {
    const el = root.querySelector(`[data-section-id="${freshSectionId.value}"]`)
    if (el) {
      el.setAttribute('contenteditable', 'false')
// 5.9: an untitled chapter loses the colon and empty subtitle span on lock, or
// the fresh DOM would keep "Chapter 1: " forever. Nothing re-renders it: the
// section insert skips the watcher.
      if (el.dataset.sectionType === 'chapter' && !readSectionTitleText(el)) {
        const subtitleSpan = el.querySelector('.section-subtitle')
        if (subtitleSpan) subtitleSpan.remove()
        const prefixSpan = el.querySelector('.chapter-prefix')
        if (prefixSpan) prefixSpan.textContent = prefixSpan.textContent.replace(/: $/, '')
      }
    }
  }
  freshSectionId.value = null
}

// --- Page-break layout -------------------------------------------------------
function layoutPageBreaks() {
  return layoutPageBreaksInSheet(sheetRef.value, props.modelValue?.sections || [], pageBreaks.value)
}

// --- Reconciliation (external model changes) ---------------------------------
// Supplies the sheet, sections and pageBreaks the module needs, so its call
// sites stay arg-less.

/// Keeps the caret bookmark fresh while the sheet has focus. The stash must
/// survive focus loss, or `reconcileEditor` has nothing to restore.
function onSelectionChange() {
  const root = sheetRef.value
  if (!root) return
  if (!root.contains(document.activeElement)) return
  const bm = bookmarkSelection(root)
  if (bm) lastEditorSelection.value = bm
  // Only while focused, so a selection blurred by clicking into the Assistant
  // panel still reads as present.
  hasSelection.value = getSelectionText() !== ''
}

/// Patch the live DOM to match the new model, preserving the cursor.
function reconcileEditor() {
  const root = sheetRef.value
  if (!root || !props.modelValue) return

  const oldBlocks = lastRenderedBlocks.value
  if (!oldBlocks) { renderEditor(); return }

  // Drift gate: the live DOM's content blocks must match the retained baseline
  // before we apply an incremental patch. If not, fall back to the full rebuild.
  const liveNodes = Array.from(root.querySelectorAll('.section-title, .paragraph'))
  const liveByKey = new Map()
  for (const node of liveNodes) {
    liveByKey.set(
      node.classList.contains('paragraph')
        ? 'para:' + node.dataset.paraId
        : 'title:' + node.dataset.sectionId,
      node
    )
  }
  if (liveNodes.length !== oldBlocks.length || liveByKey.size !== liveNodes.length) {
    // A rebuild destroys the bookmarked block, so drop the stash first.
    lastEditorSelection.value = null
    renderEditor(); return
  }
  for (const block of oldBlocks) {
    if (!liveByKey.has(blockKey(block))) {
      lastEditorSelection.value = null
      renderEditor(); return
    }
  }

  // Build the new baked block list (same preparation as renderEditor).
  const newBlocks = flattenSections(props.modelValue.sections || []).map(b => {
    if (b.kind === 'paragraph') return { ...b, paragraph: { ...b.paragraph } }
    return b
  })
  for (let i = 0; i < newBlocks.length; i++) {
    if (newBlocks[i].kind !== 'paragraph') continue
    newBlocks[i].paragraph.firstLineIndent = computeFirstLineIndent(newBlocks, i)
  }

  let bookmark = bookmarkSelection(root)
// An external change from outside the editor (nav-drawer rename, toolbar,
// undo/redo) moves focus out of the sheet before the model watcher runs. The
// live bookmark is then null. Fall back to the last selection captured while the
// editor had focus (`lastEditorSelection`). The caret then returns to where the
// writer was, not to wherever the browser drops it after the patch.
  if (!bookmark) bookmark = lastEditorSelection.value

  // Clear the trailing decorations layoutPageBreaks owns; it re-adds them.
  root.querySelectorAll('.page-break-line').forEach(el => el.remove())
  root.querySelectorAll('.editor-sentinel').forEach(el => el.remove())

  const { ops, removedKeys } = computeReconcileOps(
    oldBlocks, newBlocks,
    (block) => renderBlockHTML(block, { freshSectionId: freshSectionId.value, formatChapter: sectionFormat.formatChapter })
  )

  // Apply ops in new order, keeping a prevNode cursor so each block lands in the
  // right place. The trailing decorations are gone, so the content blocks are
  // the only children while we patch.
  let prevNode = null
  for (const op of ops) {
    let node
    if (op.op === 'keep') {
      node = liveByKey.get(op.key)
    } else if (op.op === 'replace') {
      const old = liveByKey.get(op.key)
      if (old) old.outerHTML = op.html
      node = root.querySelector(blockSelector(op.key))
    } else {
      if (prevNode) prevNode.insertAdjacentHTML('afterend', op.html)
      else root.insertAdjacentHTML('afterbegin', op.html)
      node = root.querySelector(blockSelector(op.key))
    }
    const expectedNext = prevNode ? prevNode.nextSibling : root.firstChild
    if (node && node !== expectedNext) root.insertBefore(node, expectedNext)
    prevNode = node
  }

// Remove blocks that the patch deleted but that still exist in the DOM.
  for (const key of removedKeys) {
    const node = liveByKey.get(key)
    if (node && root.contains(node)) node.remove()
  }

  applySectionTitleLocks()
  nextTick(() => layoutPageBreaks())

// Positional fallback. The patch may remove the bookmarked block, for example
// when restoring an older version that lacked the caret's paragraph. In that case
// `restoreSelection` would bail and the caret would jump to the browser default.
// Snap to the block that occupies the bookmark's former position instead.
// `oldBlocks` to `newBlocks` preserves order, so the survivor at that index, or
// the nearest preceding survivor, is the right landing spot.
  let restoreBookmark = bookmark
  if (bookmark && !root.querySelector(blockSelector(bookmark.key))) {
    const oldIdx = oldBlocks.findIndex(b => blockKey(b) === bookmark.key)
    if (oldIdx !== -1) {
      let fallbackKey = null
      for (let j = Math.min(oldIdx, newBlocks.length - 1); j >= 0; j--) {
        const k = blockKey(newBlocks[j])
        if (root.querySelector(blockSelector(k))) { fallbackKey = k; break }
      }
// If nothing at or before the previous position survived, the removed block was
// near the front. Fall forward to the next surviving block.
      if (!fallbackKey) {
        for (let j = Math.min(oldIdx, newBlocks.length - 1) + 1; j < newBlocks.length; j++) {
          const k = blockKey(newBlocks[j])
          if (root.querySelector(blockSelector(k))) { fallbackKey = k; break }
        }
      }
      if (fallbackKey) {
        restoreBookmark = {
          key: fallbackKey,
          // The fallback is a different editable unit; a raw character offset
          // would land mid-word, so drop the caret at its start instead.
          kind: fallbackKey.startsWith('title:') ? 'section-title' : 'paragraph',
          offset: 0,
        }
      }
    }
  }
// Shift the caret by the character delta of its block's text change. On undo or
// redo of typing, the bookmarked offset was measured against the pre-patch text,
// which may be longer or shorter. Restoring it literally lands mid-word, so map
// it through the common prefix and suffix. This branch applies only when the
// bookmarked block survived with the same key. The positional fallback above
// resets the offset to 0 because it targets a different editable unit.
  if (restoreBookmark && restoreBookmark.key === bookmark?.key) {
    const oldBlock = oldBlocks.find(b => blockKey(b) === restoreBookmark.key)
    const newBlock = newBlocks.find(b => blockKey(b) === restoreBookmark.key)
    if (oldBlock && newBlock) {
      restoreBookmark = {
        ...restoreBookmark,
        offset: adjustOffsetForReplace(
          blockPlainText(oldBlock), blockPlainText(newBlock), restoreBookmark.offset
        ),
      }
    }
  }
  restoreSelection(root, restoreBookmark)

  lastRenderedBlocks.value = newBlocks
  lastSectionCount.value = newBlocks.filter(b => b.kind === 'section-title').length
}

// --- Render ------------------------------------------------------------------

function renderEditor() {
  const root = sheetRef.value
  if (!root) return

// The build returns the baked blocks that become the next reconcile baseline.
  const { html, blocks, sectionCount } = buildEditorHTML(
    props.modelValue?.sections || [],
    {
      freshSectionId: freshSectionId.value,
      formatChapter: sectionFormat.formatChapter,
    }
  )

  lastRenderedBlocks.value = blocks
  lastSectionCount.value = sectionCount

  root.innerHTML = html
  applySectionTitleLocks()
  nextTick(() => layoutPageBreaks())
}

function onInput() {
  syncFromDOM()
}

// --- Cursor / block helpers --------------------------------------------------
// `getSelectionText` is the one helper that needs the root, so the module takes it
// as an argument; this wrapper supplies it for the arg-less parent surface.
function getSelectionText() {
  return selectionTextWithin(sheetRef.value)
}

// The live selection gives the section when the sheet holds the caret. The
// bookmark resolves the section when focus sits outside the sheet, as a
// toolbar-tab click does before its handler runs.
function getCurrentSectionId() {
  const block = getParagraphAtCursor() || getSectionTitleAtCursor()
  if (block) return block.dataset.sectionId || null
  const bookmark = lastEditorSelection.value
  if (!bookmark) return null
  return sheetRef.value?.querySelector(blockSelector(bookmark.key))?.dataset.sectionId || null
}

// --- Page navigation ---------------------------------------------------------
// The four wrappers below inject the sheet root, so App.vue and useNavigation keep
// an arg-less surface.
function navigatePage(direction) {
  return navigatePageInSheet(sheetRef.value, direction)
}

function scrollToPage(n) {
  return scrollToPageInSheet(sheetRef.value, n, props.modelValue?.sections || [], pageBreaks.value)
}

function getCurrentPage() {
  return getCurrentPageInSheet(sheetRef.value)
}

function navigateSectionPage(direction) {
  return navigateSectionPageInSheet(sheetRef.value, direction)
}

// --- Keyboard / input handling ----------------------------------------------

function onKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault()
    const sectionEl = getSectionTitleAtCursor()
    const inFresh = sectionEl && sectionEl.dataset.sectionId === freshSectionId.value

    if (inFresh) {
// Lock the title, focus the first paragraph, and sync. The rename reaches undo as
// an autosave delta, not an in-memory entry.
      const sectionId = sectionEl.dataset.sectionId
      lockFreshSection()
      let next = sectionEl.nextElementSibling
      while (next && !next.classList?.contains('paragraph')) {
        next = next.nextElementSibling
      }
      if (next) placeCursorAtStart(next)
      syncFromDOM()
      return
    }

    document.execCommand('defaultParagraphSeparator', false, 'div')
    document.execCommand('insertParagraph', false, null)
// Return always produces an automatic paragraph. The browser copies the inline
// indent, the `no-indent` class and the marker state from the paragraph it
// splits. Clear all three, then mark the new paragraph automatic. A fresh id
// plus its section id keep the undo-delta keys unambiguous.
    const sectionId = getSectionIdAtCursor()
    const sel2 = window.getSelection()
    let createdPara = null
    if (sel2.rangeCount) {
      let node = sel2.anchorNode
      let para = node.nodeType === 3 ? node.parentElement : node
      while (para && !para.classList?.contains('paragraph')) {
        para = para.parentElement
      }
      if (para) {
        para.style.textIndent = ''
        para.classList.remove('no-indent')
        para.dataset.autoIndent = 'true'
        para.dataset.paraId = generateParagraphId()
        if (sectionId) para.dataset.sectionId = sectionId
        createdPara = para
      }
    }
    syncFromDOM()
// Without this, the readback leaves the new paragraph at 0px, because an empty
// paragraph reads as a spacer. Return promises the continuation indent instead,
// 0.5 inch below a text paragraph. The marker above keeps the model automatic
// either way.
    if (createdPara && !createdPara.textContent?.trim()) {
      let prevBlock = createdPara.previousElementSibling
      while (prevBlock && isNonContentBlock(prevBlock)) {
        prevBlock = prevBlock.previousElementSibling
      }
      if (prevBlock && prevBlock.classList?.contains('paragraph') && prevBlock.textContent?.trim()) {
        createdPara.style.textIndent = `${Math.round(AUTO_FIRST_LINE_INDENT * PX_PER_INCH)}px`
      }
    }
    return
  }

  if (e.key === 'Backspace' || e.key === 'Delete') {
    const sel = window.getSelection()
    if (!sel.rangeCount) return
    const range = sel.getRangeAt(0)
    const para = getParagraphAtCursor()
    const sectionEl = getSectionTitleAtCursor()

    if (sectionEl) {
      if (sectionEl.dataset.sectionId === freshSectionId.value) {
// Keep Backspace and Delete inside the editable span, or they eat the locked
// chapter prefix.
        const span = editableSpanOf(sectionEl)
        if (e.key === 'Backspace' && isCaretAtStart(range, span)) { e.preventDefault(); return }
        if (e.key === 'Delete' && isCaretAtEnd(range, span)) { e.preventDefault(); return }
        return
      }
      // Locked section-title: never allow backspace/delete.
      e.preventDefault()
      return
    }

    if (para) {
      // Prevent a paragraph from merging back across a section-title boundary.
      if (e.key === 'Backspace' && isCaretAtStart(range, para)) {
        let prev = para.previousElementSibling
        while (prev && isNonContentBlock(prev)) prev = prev.previousElementSibling
        if (prev && prev.classList?.contains('section-title')) { e.preventDefault(); return }
      }
      if (e.key === 'Delete' && isCaretAtEnd(range, para)) {
        let next = para.nextElementSibling
        while (next && isNonContentBlock(next)) next = next.nextElementSibling
        if (next && next.classList?.contains('section-title')) { e.preventDefault(); return }
      }
    }
  }

  if (e.key === 'Escape') {
    const sectionEl = getSectionTitleAtCursor()
    if (sectionEl && sectionEl.dataset.sectionId === freshSectionId.value) {
      const sectionId = sectionEl.dataset.sectionId
      const title = readSectionTitleText(sectionEl)
      lockFreshSection()
      if (!title) {
        // Empty fresh section: cancel by deleting it (round-trip, undoable).
        // Emitted up to App, which calls store.deleteSection.
        emit('deleteSection', sectionId)
      } else {
        let next = sectionEl.nextElementSibling
        while (next && !next.classList?.contains('paragraph')) {
          next = next.nextElementSibling
        }
        if (next) placeCursorAtStart(next)
        syncFromDOM()
      }
      e.preventDefault()
      return
    }
  }

  if (e.key === 'Tab') {
    const sel = window.getSelection()
    if (!sel.rangeCount) return
    const range = sel.getRangeAt(0)
    const para = getParagraphAtCursor()
// Titles are not a Tab surface (decision 6); the browser keeps its focus movement.
    if (!para) return

    const hasSelection = !sel.isCollapsed

// The text between the paragraph start and the caret. `isCaretAtStart` misses a
// caret at (text-node, 0) rather than (paragraph, 0), so an empty prefix is the
// real offset-0 test (decision 1). The same range answers Shift+Tab's "is there a
// tab to my left".
    let prefixBeforeCaret = null
    if (sel.isCollapsed) {
      prefixBeforeCaret = range.cloneRange()
      prefixBeforeCaret.selectNodeContents(para)
      prefixBeforeCaret.setEnd(range.startContainer, range.startOffset)
    }
    const atParagraphStart = sel.isCollapsed &&
      (isCaretAtStart(range, para) || prefixBeforeCaret.toString() === '')

// The paragraph's effective indent, automatic rule resolved. A paragraph the
// baseline does not know came from the browser, so derive the rule from its DOM
// neighbours instead.
    const baseline = lastRenderedBlocks.value
    const baselineIdx = baseline
      ? baseline.findIndex(b => b.kind === 'paragraph' && b.paragraph.id === para.dataset.paraId)
      : -1
    let indent = 0
    if (baselineIdx !== -1) {
      const bakedIndent = baseline[baselineIdx].paragraph.firstLineIndent
      indent = typeof bakedIndent === 'number'
        ? bakedIndent
        : computeFirstLineIndent(baseline, baselineIdx)
    } else {
      let prev = para.previousElementSibling
      while (prev && isNonContentBlock(prev)) prev = prev.previousElementSibling
      indent = (!prev || prev.classList?.contains('section-title') ||
        (prev.classList?.contains('paragraph') && !prev.textContent?.trim()))
        ? 0
        : 0.5
    }

    // Shift+Tab deletes a tab to the left instead of stepping the indent.
    let tabBeforeCaret = false
    if (sel.isCollapsed && e.shiftKey && prefixBeforeCaret.toString().endsWith('\t')) {
      tabBeforeCaret = true
    }

    const action = resolveTabAction({
      key: e.key,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      hasSelection,
      atParagraphStart,
      indent,
      tabBeforeCaret,
    })
    // 'none' hands the key back to the browser; no preventDefault.
    if (action.type === 'none') return
    e.preventDefault()

    if (action.type === 'set-indent') {
// Write the indent in the exact form the readback parses: 96 px per inch,
// `no-indent` for 0, no automatic marker.
      para.style.textIndent = action.indent > 0 ? `${Math.round(action.indent * 96)}px` : '0px'
      para.classList.toggle('no-indent', action.indent === 0)
      delete para.dataset.autoIndent
      syncFromDOM()
      return
    }
    if (action.type === 'insert-tab') {
// `execCommand` over a selection wraps the tab in a `white-space: pre` span and
// turns a following space into U+00A0, so replace the selection by range surgery
// instead — but only when it lies inside this paragraph; otherwise fall back.
      const cac = range.commonAncestorContainer
      if (hasSelection && (para === cac || para.contains(cac))) {
        range.deleteContents()
        const tabNode = document.createTextNode('\t')
        range.insertNode(tabNode)
        // Caret lands immediately after the inserted tab, ready to type.
        range.setStartAfter(tabNode)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
      } else {
        document.execCommand('insertText', false, '\t')
      }
      syncFromDOM()
      return
    }
    if (action.type === 'delete-tab') {
      document.execCommand('delete')
      syncFromDOM()
      return
    }
  }
}

function onBeforeinput(e) {
  const sectionEl = getSectionTitleAtCursor()
  if (!sectionEl) return
  if (sectionEl.dataset.sectionId !== freshSectionId.value) {
    // Locked section-title: block all input.
    e.preventDefault()
    return
  }
  // Fresh section-title: block input that targets the locked chapter-prefix
  // (the derived "Chapter N: " is never user-editable).
  const sel = window.getSelection()
  if (sel.rangeCount) {
    let node = sel.anchorNode
    if (node) {
      let el = node.nodeType === 3 ? node.parentElement : node
      if (el?.closest?.('.chapter-prefix')) {
        e.preventDefault()
      }
    }
  }
}

function onPaste(e) {
  e.preventDefault()
  const text = (e.clipboardData || window.clipboardData).getData('text/plain')
  document.execCommand('insertText', false, text)
  syncFromDOM()
}

function onMousedown(e) {
  if (!freshSectionId.value) return
  const root = sheetRef.value
  if (!root) return
  const freshEl = root.querySelector(`[data-section-id="${freshSectionId.value}"]`)
  if (freshEl && !freshEl.contains(e.target)) {
    lockFreshSection()
    syncFromDOM()
  }
}

// --- Section insert ----------------------------------------------------------
// Insert is local (decision 2): splice, mark the new section fresh, emit, then
// render and focus its title. The insert reaches undo as an autosave delta.

function insertSection(sectionType, afterId = null) {
  syncFromDOM()
  const root = sheetRef.value
  if (!root) return

  const sections = [...(props.modelValue.sections || [])]
  let insertIndex
  if (afterId) {
    const found = sections.findIndex(s => s.id === afterId)
    insertIndex = found === -1 ? sections.length : found + 1
  } else {
    const cursorSectionId = getSectionIdAtCursor()
    if (cursorSectionId) {
      const found = sections.findIndex(s => s.id === cursorSectionId)
      insertIndex = found === -1 ? sections.length : found + 1
    } else {
      insertIndex = sections.length
    }
  }

  const newSection = createSection({ title: '', sectionType })
  sections.splice(insertIndex, 0, newSection)

  freshSectionId.value = newSection.id
  skipNextWatcher.value = true
  emit('syncSections', sections)

  setTimeout(() => {
    renderEditor()
    nextTick(() => {
      const el = root.querySelector(`[data-section-id="${newSection.id}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        const span = editableSpanOf(el)
        const range = document.createRange()
        range.selectNodeContents(span)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
      }
    })
  }, 0)
}

function scrollToParagraph(id) {
  const root = sheetRef.value
  if (!root) return
  const el = root.querySelector(`[data-para-id="${id}"]`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function scrollToSection(id) {
  const root = sheetRef.value
  if (!root) return
  const el = root.querySelector(`[data-section-id="${id}"]`)
  if (!el) return
  // A nav jump is a navigation, so it moves the caret and not only the scroll.
  // With the caret left where it was, the section the writer chose was not the
  // page the editor reported, and a switch to the manuscript opened on the last
  // page of the previous chapter instead. focusPageStart puts the caret in the
  // first paragraph after a locked title — the same walk page navigation does —
  // and 'center' keeps the heading readable above it.
  focusPageStartInSheet(el, 'smooth', 'center')
}

function renderFromDoc() {
  renderEditor()
}

watch(() => props.modelValue?.sections, () => {
  if (skipNextWatcher.value) {
    skipNextWatcher.value = false
    return
  }
  // External model change: patch by id so the caret stays. Skipped when this
  // component caused it (`skipNextWatcher`).
  reconcileEditor()
}, { deep: true })

watch(pageBreaks, () => {
  layoutPageBreaks()
})

// No watchers on theme or zoom: `editorStyles` is a computed bound through
// `:style`, and pagination uses fixed manuscript metrics, so zoom does not move
// the breaks.

onMounted(() => {
  renderEditor()
  // selectionchange fires on document, not on the sheet.
  document.addEventListener('selectionchange', onSelectionChange)
})

onUnmounted(() => {
  document.removeEventListener('selectionchange', onSelectionChange)
})

defineExpose({
  syncFromDOM,
  renderFromDoc,
  insertSection,
  scrollToParagraph,
  scrollToSection,
  scrollToPage,
  getCurrentPage,
  getCurrentSectionId,
  selectLine,
  navigatePage,
  navigateSectionPage,
  applySearchHighlights: editorApplySearchHighlights,
  clearSearchHighlights: editorClearSearchHighlights,
  // For the Assistant panel's `selection` scope (roadmap 3.2).
  getSelectionText,
  // For the Assistant panel's `selection` scope (roadmap 3.2).
  hasSelection,
})
</script>

<style scoped>
.editor-sheet {
  outline: none;
  font-size: 16px;
  line-height: 1.6;
  width: 100%;
  /* No background/colour transition: a theme switch — keyboard (Enter on a
     focused swatch) or click — must read as applied in getComputedStyle
     immediately; a fade turns the switched-to colour into an interpolated
     mid-animation value for 200ms. */
  font-family: var(--editor-font, 'Inter', sans-serif);
}

.editor-sheet :deep(.paragraph) {
  margin-bottom: 0.6em;
  text-indent: 48px;
  /* A tab is 0.5 in at 96 dpi, the unit the indent model uses. */
  white-space: pre-wrap;
  tab-size: 48px;
}

.editor-sheet :deep(.paragraph.no-indent) {
  text-indent: 0;
}

.editor-sheet :deep(.paragraph):last-child {
  margin-bottom: 0;
}

/* A Chapter is heavier than a freeform Section; the derived number lives in
   .chapter-prefix. */
.editor-sheet :deep(.section-title) {
  font-size: 1.2em;
  font-weight: 600;
  text-align: left;
  text-transform: uppercase;
  margin-top: 1.5em;
  margin-bottom: 0.8em;
  text-indent: 0;
}

.editor-sheet :deep(.section-title.chapter) {
  font-size: 1.3em;
  font-weight: 700;
  margin-top: 2em;
  margin-bottom: 1em;
}

/* A hidden section still renders its title, dimmed, so it can be found, renamed
   and re-toggled. */
.editor-sheet :deep(.section-title.section-hidden) {
  opacity: 0.45;
}

.editor-sheet :deep(.section-title .chapter-prefix) {
  /* locked, derived — no special styling beyond inheriting the title's look */
}

/* Page breaks are pseudo-elements, so no interstitial node can hold the caret;
   either block kind can start a page. */
.editor-sheet :deep([data-page-start]) {
  position: relative;
  border-top: 1px dashed rgba(128, 128, 128, 0.35);
  margin-top: 1.2em;
  padding-top: 24px;
}

.editor-sheet :deep([data-page-start="1"]) {
  border-top: none;
  margin-top: 0;
  padding-top: 0;
}

.editor-sheet :deep([data-page-start])::before {
  content: 'p. ' attr(data-page-start);
  position: absolute;
  top: 4px;
  right: 0;
  font-size: 11px;
  color: inherit;
  opacity: 0.4;
  user-select: none;
  pointer-events: none;
}
</style>
