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
import { THEMES } from '../../constants/themes.js'
import { generateParagraphId, createSection } from '../../constants/DocumentModel.js'
import { useSectionFormat } from '../../composables/useSectionFormat.js'

const props = defineProps({
  modelValue: Object,
  // Page breaks come from the SINGLE shared `usePagination` instance owned by
  // App.vue (roadmap 2.5) — passed through DocumentRenderer — instead of a
  // per-editor instance with its own cold measurement cache. Same `pageBreaks`
  // contract: an array of flattened block indices that start a new page.
  pageBreaks: { type: Array, default: () => [] },
  theme: { type: Number, default: 0 },
  zoom: { type: Number, default: 16 },
  margin: { type: String, default: 'compact' },
})
const emit = defineEmits(['syncSections', 'syncSection', 'update', 'deleteSection'])

const sheetRef = ref(null)
// The id of a just-inserted section whose title the user is editing inline. While
// set, that one .section-title stays contenteditable; every other section-title
// is locked. Cleared by Enter/Escape/click-away (see lockFreshSection). This is the
// old `freshHeadingId` mechanism retargeted at section titles.
const freshSectionId = ref(null)
const skipNextWatcher = ref(false)
// The flat block list (with baked firstLineIndent) matching the CURRENT live
// DOM. Maintained as an invariant across all three DOM-producing paths:
// renderEditor (full rebuild), syncFromDOM (edit readback), and reconcileEditor
// (surgical patch). reconcileEditor diffs this against the new model to compute
// the minimal patch; if it ever disagrees with the actual DOM it falls back to
// a full renderEditor (see the drift gate).
const lastRenderedBlocks = ref(null)
// Number of `.section-title` blocks in `lastRenderedBlocks`. The localized
// syncFromDOM uses this as a cheap structural gate: if the live DOM's
// section-title count differs, an edit crossed a section boundary (which the
// keydown/beforeinput handlers are meant to block, but a browser edge case
// could allow) and we fall back to the full readback. Maintained wherever
// lastRenderedBlocks is set on the full-render/reconcile paths; a within-
// section typing edit doesn't change it, so the localized path leaves it alone.
const lastSectionCount = ref(0)
// The last selection that was inside the editor sheet, captured continuously
// while the editor is focused and stashed on focus loss. External changes
// triggered from outside the editor (nav-drawer rename, toolbar, undo/redo)
// move focus out of the sheet BEFORE the model-watcher fires reconcileEditor,
// so the live bookmarkSelection returns null — without this stash there would
// be nothing to restore and the caret would jump. See reconcileEditor's
// fallback to this value. Cleared when its target node is destroyed (drift-gate
// fallback to renderEditor) so it can never point at a missing block.
const lastEditorSelection = ref(null)
// Whether the sheet currently has a non-empty text selection. Exposed so the
// Assistant panel can auto-scope a critique to the selection (roadmap 3.2):
// a reactive boolean lets the panel's "Using your selection" hint appear/
// disappear live. Updated from `onSelectionChange` (see below) — same listener
// the caret bookmark uses, so no new event wiring.
const hasSelection = ref(false)
const pageBreaks = toRef(props, 'pageBreaks')
// Refs handed to the readback factory (roadmap 5.6 PR3) so it can read the live
// model + zoom baseline reactively without owning them — the orchestrator keeps
// ownership of the shared state.
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
    // Drives the trailing page-break <hr> color (set in layoutPageBreaks) via
    // var(--page-break-color). Keeping it here — inside the reactive computed
    // bound to :style — means a theme change updates the <hr> color live without
    // the full innerHTML rebuild the old watch(props.theme) performed.
    '--page-break-color': t.text,
  }
})

// --- Section-title locking ---------------------------------------------------
// Section titles are structural markers, not body text: they are locked
// (contenteditable=false) except for the one section currently being
// inserted/renamed inline (freshSectionId). The derived "Chapter N: " prefix
// is ALWAYS locked — the number is render-derived, never user-editable.

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
      // 5.9: a chapter left without a typed subtitle collapses to the clean
      // "Chapter N" render the moment it locks — the fresh rendering (colon +
      // empty editable span) is only the inline-typing affordance. Mirrors
      // sectionTitleToHTML's empty-subtitle rule; without this the stale
      // fresh DOM would dangle "Chapter 1: " indefinitely, because a
      // section insert never triggers a reconcile (the syncSection emit is
      // watcher-skipped and nothing else re-renders the heading).
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

// --- DOM → model -------------------------------------------------------------
// --- DOM→model readback (extracted to useEditorReadback.js) -----------------
// The pure helpers (isNonContentBlock, parseParagraphElement, readSectionTitleText,
// domToBlocks, bakeChapterIndices, blockPlainText, adjustOffsetForReplace) and
// the two readback entry points (syncFromDOM, fullSyncFromDOM) live in
// src/composables/useEditorReadback.js. editorDisplay binds the entry points to
// its reactive state via the useEditorReadback factory (instantiated above, next
// to the refs); the four helpers the orchestrator core still calls directly
// (blockPlainText, adjustOffsetForReplace, isNonContentBlock, readSectionTitleText)
// are imported. parseParagraphElement / domToBlocks / bakeChapterIndices are
// consumed only inside the readback module.

// --- Page-break layout (extracted to useEditorPageNav.js) -------------------
// layoutPageBreaks lives in src/composables/useEditorPageNav.js now; this
// arg-less wrapper injects the reactive values editorDisplay owns (the sheet
// root, the doc sections, and the pageBreaks prop) so the renderEditor /
// reconcileEditor / pageBreaks-watch call sites stay unchanged.
function layoutPageBreaks() {
  return layoutPageBreaksInSheet(sheetRef.value, props.modelValue?.sections || [], pageBreaks.value)
}

// --- Reconciliation (external model changes) ---------------------------------
// When the model changes outside the editor (undo, rename, delete, type-change,
// restore), patch the live DOM surgically by stable block id instead of the
// full `innerHTML` rebuild renderEditor performs — so the cursor and scroll
// stay where the user left them. The pure op computation lives in
// useEditorReconcile.js; this function owns the DOM application, cursor
// save/restore, and a drift-gate fallback to renderEditor.

/// renderBlockHTML (the single-block renderer computeReconcileOps injects as
/// its renderBlockFn) now lives in useEditorReconcile.js — extracted in roadmap
/// 5.6 PR4. It's pure: the render-derived bits it closed over (freshSectionId,
/// formatChapter) are passed in as an options bag at the call site below, so it
/// stays unit-testable without the component. buildEditorHTML (the full-sheet
/// render) lives in useEditorRender.js; renderEditor below is now a thin wrapper
/// over it.

/// Track the in-editor selection continuously so an external change triggered
/// from OUTSIDE the editor (nav-drawer rename, toolbar, undo/redo) can still
/// restore the caret. Those triggers move focus out of the sheet before the
/// model-watcher fires reconcileEditor, at which point bookmarkSelection
/// returns null; lastEditorSelection holds the last in-editor caret this
/// stashed. Only updates while the sheet is focused — when focus leaves, we
/// leave the stash alone (do NOT null it) so it survives as the fallback.
/// Per-keystroke cost is one bookmarkSelection (O(paragraph offset), no layout
/// reads) — negligible next to the localized syncFromDOM.
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
    // The DOM has drifted from the retained baseline — a full rebuild will
    // destroy the bookmarked block, so drop the stash to avoid ever restoring
    // to a node that no longer exists.
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
  // External changes triggered from OUTSIDE the editor (nav-drawer rename,
  // toolbar, undo/redo) move focus out of the sheet before this watcher fires,
  // so the live bookmark is null. Fall back to the last selection captured
  // while the editor WAS focused (lastEditorSelection) so the caret returns to
  // where the user was — not wherever the browser drops it after the patch.
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

  // Remove deleted blocks (still present from the old DOM).
  for (const key of removedKeys) {
    const node = liveByKey.get(key)
    if (node && root.contains(node)) node.remove()
  }

  applySectionTitleLocks()
  nextTick(() => layoutPageBreaks())

  // Positional fallback: if the bookmarked block was removed by this patch
  // (e.g. restoring an older version that lacked the paragraph the caret was
  // in), restoreSelection would silently bail and the caret would jump to the
  // browser default. Instead snap to the block now occupying the bookmark's
  // former position. oldBlocks → newBlocks is order-preserving (no moves), so
  // the survivor at the same index — or the nearest preceding surviving block
  // — is the sensible landing spot.
  let restoreBookmark = bookmark
  if (bookmark && !root.querySelector(blockSelector(bookmark.key))) {
    const oldIdx = oldBlocks.findIndex(b => blockKey(b) === bookmark.key)
    if (oldIdx !== -1) {
      let fallbackKey = null
      for (let j = Math.min(oldIdx, newBlocks.length - 1); j >= 0; j--) {
        const k = blockKey(newBlocks[j])
        if (root.querySelector(blockSelector(k))) { fallbackKey = k; break }
      }
      // If nothing at/before the old position survived (the removed block was
      // near the front), fall forward to the next surviving block.
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
  // Shift the caret by the character delta of its block's text change. On
  // undo/redo of typing the bookmarked offset was measured against the pre-patch
  // text (longer or shorter); restoring it literally into the patched text lands
  // mid-word. Map the offset through the common prefix/suffix so it tracks the
  // content change. Only when the bookmarked block survived the patch (same key)
  // — the positional-fallback branch above already resets offset to 0 because it
  // targets a different editable unit.
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

  // The full-sheet build (flatten → bake first-line indents → render each
  // block) lives in useEditorRender.js now (roadmap 5.6
  // PR4); it returns the baked block list + section count so we record them as
  // the retained baseline the reconciler diffs against next time.
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
// The stateless cursor/caret/selection helpers below lived here until roadmap
// 5.6; they're now pure functions in src/composables/useEditorCursor.js
// (imported above) — blockSelector, bookmarkSelection, restoreSelection,
// editableSpanOf, getParagraphAtCursor, getSectionTitleAtCursor,
// getSectionIdAtCursor, isCaretAtStart, isCaretAtEnd, placeCursorAtStart,
// selectLine. This wrapper is the one exception: `getSelectionText` there takes
// the editor root as an argument (so it's unit-testable without a component),
// while the parent surface expects the arg-less form that bounds itself to this
// sheet — so the exposed name stays a thin wrapper over `sheetRef.value`.
function getSelectionText() {
  return selectionTextWithin(sheetRef.value)
}

// --- Page navigation (extracted to useEditorPageNav.js) ---------------------
// The pure DOM helpers (currentPageAtCursor, currentPageAtTop, focusPageStart,
// layoutPageBreaks, navigatePage, navigateSectionPage, scrollToPage,
// getCurrentPage) live in src/composables/useEditorPageNav.js. The four exposed
// here keep their arg-less parent surface (App.vue / useNavigation call them
// with just a page number or direction); each injects the sheet root — and, for
// scrollToPage, the sections + pageBreaks the defensive stamp needs — so the
// orchestrator's reactive state stays owned by editorDisplay.
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
      // Commit the fresh title: lock it, focus the section's first paragraph,
      // and sync the edited title back into the model (local — captured on the
      // next autosave delta as a RenameSection, no in-memory undo entry).
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
    // The browser often copies text-indent from the previous paragraph. New
    // paragraphs start flush so the user controls the indent explicitly.
    // It also often copies `data-para-id` from the split paragraph — giving the
    // two halves DUPLICATE ids — or drops it entirely. A duplicate id makes the
    // undo delta (UpdateParagraph matched by id) ambiguous now that typing is
    // journaled, and a missing id churns a new id on every keystroke readback.
    // Give the new paragraph a fresh stable id and pin its section id so the
    // localized readback (positional sibling walk) and the Rust delta both see
    // one unambiguous paragraph.
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
        // Fresh section-title: allow text editing, but never let Backspace/Delete
        // cross the editable span's boundaries (which would eat the locked
        // chapter-prefix or merge into the previous block).
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
// Insert is LOCAL (decision 2): splice a new section into a copy of the
// sections array, mark it fresh so its title renders editable, emit the new
// array via syncSections, then re-render and focus the title for inline
// editing. This mirrors the old insertHeading flow — synchronous, immediate
// focus, no async round-trip. (Section inserts are not in in-memory undo
// history; they are captured on-disk by the next autosave delta's
// InsertSection op.)

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

// NOTE: there is deliberately no watch(props.theme) or watch(props.zoom).
// editorStyles (the reactive computed bound via :style) updates background,
// text-color, and font-size live; page breaks are laid out by usePagination
// against fixed manuscript metrics, so zoom does not shift them; the
// page-break <hr> color flows through the --page-break-color CSS variable.

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
  transition: background 0.2s, color 0.2s;
  font-family: var(--editor-font, 'Inter', sans-serif);
}

.editor-sheet :deep(.paragraph) {
  margin-bottom: 0.6em;
  text-indent: 48px;
}

.editor-sheet :deep(.paragraph.no-indent) {
  text-indent: 0;
}

.editor-sheet :deep(.paragraph):last-child {
  margin-bottom: 0;
}

/* Section titles are the structural headings now (one level, flat). A Chapter
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