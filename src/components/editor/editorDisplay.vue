<template>
  <div
    class="editor-sheet"
    contenteditable="true"
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
  ></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch, computed, toRef } from 'vue'
import { flattenSections, computeFirstLineIndent } from '../../composables/useSectionBlocks.js'
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
} from '../../composables/useEditorPageNav.js'
import {
  useEditorReadback,
  blockPlainText, adjustOffsetForReplace, isNonContentBlock, readSectionTitleText,
} from '../../composables/useEditorReadback.js'
import { resolveTabAction } from '../../composables/useEditorTabKey.js'
import { THEMES } from '../../constants/themes.js'
import { generateParagraphId, createSection } from '../../constants/DocumentModel.js'
import { useSectionFormat } from '../../composables/useSectionFormat.js'

const props = defineProps({
  modelValue: Object,
// Page breaks come from the one shared `usePagination` instance that App.vue
// owns (roadmap 2.5) and DocumentRenderer passes through. A per-editor instance
// would keep a separate, cold measurement cache. `pageBreaks` is an array of
// flattened block indices, each of which starts a new page.
  pageBreaks: { type: Array, default: () => [] },
  theme: { type: Number, default: 0 },
  zoom: { type: Number, default: 16 },
  margin: { type: String, default: 'compact' },
})
const emit = defineEmits(['syncSections', 'syncSection', 'update', 'deleteSection'])

const sheetRef = ref(null)
// The id of a section the writer just inserted and is naming inline. While set,
// that one `.section-title` stays `contenteditable` and every other title is
// locked. Enter, Escape or a click elsewhere clears it (see lockFreshSection).
const freshSectionId = ref(null)
const skipNextWatcher = ref(false)
// The flat block list, with `firstLineIndent` baked, that matches the live DOM.
// `renderEditor` (full rebuild), `syncFromDOM` (edit readback) and
// `reconcileEditor` (surgical patch) all keep it current. `reconcileEditor`
// diffs it against the new model to compute the smallest patch. If it disagrees
// with the DOM, the drift gate falls back to a full `renderEditor`.
const lastRenderedBlocks = ref(null)
// The number of `.section-title` blocks in `lastRenderedBlocks`. The localized
// `syncFromDOM` uses it as a cheap structural gate. A different live count means
// an edit crossed a section boundary. The keydown and beforeinput handlers mean
// to block that, but a browser edge case can allow it. The readback then falls back
// to the full path. Every full-render and reconcile path updates it; a typing
// edit inside one section leaves it unchanged.
const lastSectionCount = ref(0)
// The last selection inside the editor sheet. `onSelectionChange` refreshes it
// while the sheet has focus, and focus loss leaves it in place. An external
// change (nav-drawer rename, toolbar, undo/redo) moves focus out of the sheet
// before the model watcher runs `reconcileEditor`, so `bookmarkSelection` then
// returns null. Without this stash the caret would jump. Clearing the stash when
// its node dies keeps it from pointing at a missing block.
const lastEditorSelection = ref(null)
// True while the sheet holds a non-empty text selection. The Assistant panel
// uses it to scope a critique to the selection (roadmap 3.2), so its "Using your
// selection" hint appears and disappears live. `onSelectionChange` updates it,
// the same listener that maintains the caret bookmark.
const hasSelection = ref(false)
const pageBreaks = toRef(props, 'pageBreaks')
// Refs for the readback factory (roadmap 5.6 PR3). The factory reads the live
// model and zoom baseline through them without owning either; editorDisplay
// keeps ownership of the shared state.
const modelRef = toRef(props, 'modelValue')
const zoomRef = toRef(props, 'zoom')
const sectionFormat = useSectionFormat()

// DOM→model readback (syncFromDOM for the localized typing path, fullSyncFromDOM
// as its structural-ambiguity fallback) lives in useEditorReadback.js; this
// binds it to the reactive state above. Only syncFromDOM is consumed here —
// fullSyncFromDOM is an internal fallback the localized path calls.
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
  const t = THEMES[props.theme] || THEMES[0]
  const pad = props.margin === 'manuscript' ? '96px' : '24px 32px'
  return {
    fontSize: props.zoom + 'px',
    background: t.bg,
    color: t.text,
    padding: pad,
// Drives the trailing page-break <hr> color through `var(--page-break-color)`.
// It sits in the reactive computed that binds `:style`. A theme change then
// updates the <hr> color without the full `innerHTML` rebuild that a
// `watch(props.theme)` would cause.
    '--page-break-color': t.text,
  }
})

// --- Section-title locking ---------------------------------------------------
// Section titles are structural markers, not body text. They are locked
// (`contenteditable=false`) except for the one section being inserted or renamed
// inline (`freshSectionId`). The derived "Chapter N: " prefix is always locked:
// the number comes from the render and the writer cannot edit it.

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
// 5.9: a chapter with no typed subtitle collapses to the plain "Chapter N"
// render when it locks. The fresh render (colon plus empty editable span) is only
// the inline-typing affordance. This mirrors `sectionTitleToHTML`'s empty-subtitle
// rule. Without it the fresh DOM would keep "Chapter 1: " forever. A section
// insert never triggers a reconcile, because the `syncSection` emit is
// watcher-skipped and nothing else re-renders the heading.
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

// --- DOM→model readback (extracted to useEditorReadback.js) -----------------
// The readback module holds the pure helpers (`isNonContentBlock`,
// `parseParagraphElement`, `readSectionTitleText`, `domToBlocks`,
// `bakeChapterIndices`, `blockPlainText`, `adjustOffsetForReplace`) and the two
// entry points (`syncFromDOM`, `fullSyncFromDOM`). editorDisplay binds the entry
// points to its reactive state through the `useEditorReadback` factory above.
// It imports the four helpers the orchestrator still calls directly:
// `blockPlainText`, `adjustOffsetForReplace`, `isNonContentBlock` and
// `readSectionTitleText`. `parseParagraphElement`, `domToBlocks` and
// `bakeChapterIndices` stay inside the readback module.

// --- Page-break layout (extracted to useEditorPageNav.js) -------------------
// `layoutPageBreaks` lives in `src/composables/useEditorPageNav.js`. This
// arg-less wrapper injects the reactive values editorDisplay owns: the sheet
// root, the doc sections and the `pageBreaks` prop. The `renderEditor`,
// `reconcileEditor` and pageBreaks-watch call sites then stay unchanged.
function layoutPageBreaks() {
  return layoutPageBreaksInSheet(sheetRef.value, props.modelValue?.sections || [], pageBreaks.value)
}

// --- Reconciliation (external model changes) ---------------------------------
// When the model changes outside the editor (undo, rename, delete, type change,
// restore), patch the live DOM by stable block id instead of rebuilding
// `innerHTML`. The cursor and scroll then stay where the writer left them.
// `useEditorReconcile.js` computes the ops. This function applies them, saves and
// restores the cursor, and falls back to `renderEditor` when the DOM has drifted.

/// `renderBlockHTML`, the single-block renderer that `computeReconcileOps`
/// injects as `renderBlockFn`, lives in `useEditorReconcile.js` (roadmap 5.6
/// PR4). It is pure: the render-derived values it needs (`freshSectionId`,
/// `formatChapter`) arrive in an options bag at the call site below. It
/// therefore stays unit-testable without the component. `buildEditorHTML`, the full-sheet
/// renderer, lives in `useEditorRender.js`; `renderEditor` is a thin wrapper.

/// Tracks the in-editor selection so an external change from outside the editor
/// (nav-drawer rename, toolbar, undo/redo) can restore the caret. Those triggers
/// move focus out of the sheet before the model watcher runs `reconcileEditor`,
/// and `bookmarkSelection` then returns null. This value holds the last in-editor
/// caret. It updates only while the sheet has focus; when focus leaves, the stash
/// stays (do not null it) so it can serve as the fallback. Each keystroke costs
/// one `bookmarkSelection` call, which reads no layout.
function onSelectionChange() {
  const root = sheetRef.value
  if (!root) return
  if (!root.contains(document.activeElement)) return
  const bm = bookmarkSelection(root)
  if (bm) lastEditorSelection.value = bm
  // Reflect whether there's a live, in-sheet text selection. `getSelectionText`
  // already does the sheet-containment + collapsed check, so reuse it. Like the
  // caret bookmark above, we only update while the sheet is focused — so a
  // selection made in the sheet, then blurred (e.g. to click into the Assistant
  // panel), still reads as "present" and the critique targets it. Collapsing
  // the selection in the sheet clears it.
  hasSelection.value = getSelectionText() !== ''
}

/// Patch the live DOM to match the new model, preserving the cursor. Falls
/// back to a full renderEditor when there is no retained baseline or the DOM
/// has drifted from it (worst case = today's behavior).
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
// The DOM has drifted from the retained baseline. A full rebuild destroys the
// bookmarked block, so drop the stash; a restore must never target a missing
// node.
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

// The full-sheet build (flatten, bake first-line indents, render each block)
// lives in `useEditorRender.js` (roadmap 5.6 PR4). It returns the baked block
// list and the section count, which become the retained baseline for the next
// reconcile.
  const { html, blocks, sectionCount } = buildEditorHTML(
    props.modelValue?.sections || [],
    {
      freshSectionId: freshSectionId.value,
      formatChapter: sectionFormat.formatChapter,
    }
  )

  // Record the baked block list so a later external change can diff against it
  // instead of rebuilding the whole sheet.
  lastRenderedBlocks.value = blocks
  lastSectionCount.value = sectionCount

  root.innerHTML = html
  applySectionTitleLocks()
  nextTick(() => layoutPageBreaks())
}

function onInput() {
  syncFromDOM()
}

// --- Cursor / block helpers (extracted to useEditorCursor.js) ---------------
// The stateless cursor, caret and selection helpers live in
// `src/composables/useEditorCursor.js` (imported above): `blockSelector`,
// `bookmarkSelection`, `restoreSelection`, `editableSpanOf`,
// `getParagraphAtCursor`, `getSectionTitleAtCursor`, `getSectionIdAtCursor`,
// `isCaretAtStart`, `isCaretAtEnd`, `placeCursorAtStart` and `selectLine`.
// `getSelectionText` is the exception. The module version takes the editor root
// as an argument so it is unit-testable. This wrapper supplies `sheetRef.value`
// for the arg-less parent surface.
function getSelectionText() {
  return selectionTextWithin(sheetRef.value)
}

// --- Page navigation (extracted to useEditorPageNav.js) ---------------------
// The pure DOM helpers (`currentPageAtCursor`, `currentPageAtTop`,
// `focusPageStart`, `layoutPageBreaks`, `navigatePage`, `navigateSectionPage`,
// `scrollToPage`, `getCurrentPage`) live in
// `src/composables/useEditorPageNav.js`. The four exposed here keep the arg-less
// surface that App.vue and useNavigation call. Each injects the sheet root, and
// `scrollToPage` also injects the sections and pageBreaks that the defensive
// stamp needs. editorDisplay therefore keeps ownership of the reactive state.
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
// Commit the fresh title: lock it, focus the section's first paragraph, and sync
// the edited title into the model. The sync is local; the next autosave delta
// captures it as a RenameSection, with no in-memory undo entry.
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
// The browser often copies `text-indent` from the previous paragraph. This
// handler resets the new paragraph to flush; the automatic indent comes from the
// block list. The browser also copies `data-para-id` from the split paragraph,
// which gives both halves duplicate ids, or drops the id entirely. A duplicate id
// makes the undo delta (UpdateParagraph matched by id) ambiguous; a missing id
// generates a new one on every keystroke readback. Give the new paragraph a fresh
// stable id and pin its section id, so the localized readback and the Rust delta
// both see one paragraph.
    const sectionId = getSectionIdAtCursor()
    const sel2 = window.getSelection()
    if (sel2.rangeCount) {
      let node = sel2.anchorNode
      let para = node.nodeType === 3 ? node.parentElement : node
      while (para && !para.classList?.contains('paragraph')) {
        para = para.parentElement
      }
      if (para) {
        para.style.textIndent = '0px'
        para.dataset.paraId = generateParagraphId()
        if (sectionId) para.dataset.sectionId = sectionId
      }
    }
    syncFromDOM()
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
// Fresh section-title: allow text editing, but keep Backspace and Delete inside
// the editable span. Crossing the boundary would eat the locked chapter prefix or
// merge into the previous block.
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
// Spec decision 6: the caret is not in a body paragraph, so Tab is not an editing
// surface there. The browser keeps its focus movement.
    if (!para) return

    const hasSelection = !sel.isCollapsed

// The text between the paragraph's start and a collapsed caret, if any.
// `isCaretAtStart` compares boundaries. It can miss a caret the browser expresses
// as (text-node, 0) instead of (paragraph, 0), because strict DOM ordering puts
// those positions apart. An empty prefix is therefore the real "offset 0 of the
// paragraph" test (spec decision 1). The same range answers
// whether a literal tab sits left of the caret (Shift+Tab).
    let prefixBeforeCaret = null
    if (sel.isCollapsed) {
      prefixBeforeCaret = range.cloneRange()
      prefixBeforeCaret.selectNodeContents(para)
      prefixBeforeCaret.setEnd(range.startContainer, range.startOffset)
    }
    const atParagraphStart = sel.isCollapsed &&
      (isCaretAtStart(range, para) || prefixBeforeCaret.toString() === '')

// This paragraph's effective first-line indent in inches, with the automatic rule
// already resolved. The retained baseline holds the baked numbers that the live
// DOM was rendered from. A paragraph missing from the baseline came from the
// browser without a render. Derive the rule from its live-DOM neighbours: 0 for
// a section's first paragraph, 0.5 otherwise.
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

    // Shift+Tab only: a literal tab immediately left of the caret is deleted, so
    // ask the prefix text whether one sits at its end.
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
    // 'none' hands the key back to the browser (e.g. Shift+Tab with nothing to
    // remove) — focus movement, no DOM change.
    if (action.type === 'none') return
    e.preventDefault()

    if (action.type === 'set-indent') {
// The writer owns this value. Write it on the live paragraph in the exact form
// the readback parses: 96 px per inch, the `no-indent` class for 0, and no
// automatic marker. No sync then re-derives it.
      para.style.textIndent = action.indent > 0 ? `${Math.round(action.indent * 96)}px` : '0px'
      para.classList.toggle('no-indent', action.indent === 0)
      delete para.dataset.autoIndent
      syncFromDOM()
      return
    }
    if (action.type === 'insert-tab') {
// Replace a selection by direct range surgery. `execCommand('insertText')` over a
// non-collapsed selection makes Chromium wrap the tab in a `white-space: pre`
// span, and re-balances the following space into U+00A0. This path is safe only
// when the range lives entirely inside this paragraph: the common ancestor must
// be the paragraph or a node inside it. A cross-block selection falls back to the
// `execCommand` path. A collapsed caret keeps `execCommand`, whose replace
// pipeline leaves the text intact.
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
// Insert is local (decision 2). Splice a new section into a copy of the sections
// array and mark it fresh so its title renders editable. Emit the new array
// through `syncSections`, then re-render and focus the title. The flow is
// synchronous, with immediate focus and no async round-trip. Section inserts stay
// out of in-memory undo history; the next autosave delta captures the insert as
// an `InsertSection` op.

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
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function renderFromDoc() {
  renderEditor()
}

watch(() => props.modelValue?.sections, () => {
  if (skipNextWatcher.value) {
    skipNextWatcher.value = false
    return
  }
  // Patch when the store doc changes externally (rename, delete, type-change,
  // undo/redo, restore) — surgical id-keyed DOM patch that preserves the
  // cursor/scroll. Skipped when the change originated here (syncFromDOM,
  // insertSection). reconcileEditor falls back to renderEditor when it can't
  // verify the DOM against the retained baseline (first paint, drift).
  reconcileEditor()
}, { deep: true })

watch(pageBreaks, () => {
  layoutPageBreaks()
})

// Note: this component deliberately has no `watch(props.theme)` or
// `watch(props.zoom)`. `editorStyles`, the reactive computed bound through
// `:style`, updates background, text color and font size live. `usePagination`
// lays out page breaks against fixed manuscript metrics, so zoom does not move
// them. The page-break <hr> color flows through `--page-break-color`.

onMounted(() => {
  renderEditor()
  // selectionchange is a document-level event (the caret lives in the
  // contenteditable, not on a per-element listener), so subscribe on mount and
  // tear down on unmount.
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
  selectLine,
  navigatePage,
  navigateSectionPage,
  applySearchHighlights: editorApplySearchHighlights,
  clearSearchHighlights: editorClearSearchHighlights,
  // The Assistant panel's `selection` scope reads the editor's current text
  // selection. Returns the plain-text selection within the sheet, or '' when
  // nothing is selected / the selection is outside the editor.
  getSelectionText,
  // Reactive boolean: true while the sheet has a non-empty selection. The
  // Assistant panel uses it to auto-scope to the selection (roadmap 3.2).
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
  /* Preserve the writer's literal whitespace; a tab is 0.5 in at 96 dpi
     (48 px), the same unit the indent model uses. */
  white-space: pre-wrap;
  tab-size: 48px;
}

.editor-sheet :deep(.paragraph.no-indent) {
  text-indent: 0;
}

.editor-sheet :deep(.paragraph):last-child {
  margin-bottom: 0;
}

/* Section titles are the structural headings (one level, flat). A Chapter
   is visually heavier than a freeform Section. The derived "Chapter N: " prefix
   lives in .chapter-prefix; the editable subtitle in .section-subtitle. */
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

/* Hidden section (5.10): the title div ALWAYS renders in the editor (the
   drift gate counts `.section-title`s; the scroll/nav machinery queries them)
   — it just dims, so the writer can still find, rename, and re-toggle it. */
.editor-sheet :deep(.section-title.section-hidden) {
  opacity: 0.45;
}

.editor-sheet :deep(.section-title .chapter-prefix) {
  /* locked, derived — no special styling beyond inheriting the title's look */
}

/* Page break visuals are rendered via CSS pseudo-elements on the first block of
   each page so there are no interstitial DOM nodes the cursor can land in
   between. Generalized from .paragraph[data-page-start] to [data-page-start] so
   a page can begin on either a section-title or a paragraph. */
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
