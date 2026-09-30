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
import { paragraphToHTML, sectionTitleToHTML, escapeHtml } from '../../composables/useParagraphHTML.js'
import { flattenSections, groupBlocks, computeFirstLineIndent } from '../../composables/useSectionBlocks.js'
import { computeReconcileOps, blockKey } from '../../composables/useEditorReconcile.js'
import { applySearchHighlights, clearSearchHighlights } from '../../composables/useSearchHighlights.js'
import {
  blockSelector, bookmarkSelection, restoreSelection, editableSpanOf,
  getParagraphAtCursor, getSectionTitleAtCursor, getSectionIdAtCursor,
  isCaretAtStart, isCaretAtEnd, placeCursorAtStart, selectLine,
  getSelectionText as selectionTextWithin,
} from '../../composables/useEditorCursor.js'
import { THEMES } from '../../constants/themes.js'
import { generateParagraphId, generateSectionId, createSection, createParagraph, defaultTextStyle } from '../../constants/DocumentModel.js'
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
const sectionFormat = useSectionFormat()

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
    if (el) el.setAttribute('contenteditable', 'false')
  }
  freshSectionId.value = null
}

// --- DOM → model -------------------------------------------------------------
// The editor's contenteditable is a FLAT sibling list: .section-title markers
// interleaved with .paragraph divs. domToBlocks walks that flat list into the
// block shape groupBlocks understands; groupBlocks then rebuilds the nested
// Section[] the store holds. Section-titles are read back from their editable
// span only (the chapter-prefix span is derived and never read).

function isNonContentBlock(el) {
  return el.classList?.contains('page-break-line') ||
    el.classList?.contains('page-number-label') ||
    el.classList?.contains('epigram-block') ||
    el.classList?.contains('editor-sentinel')
}

function parseParagraphElement(child) {
  const style = window.getComputedStyle(child)
  const leftIndentPx = parseInt(style.marginLeft, 10) || 0
  const rightIndentPx = parseInt(style.marginRight, 10) || 0
  const elements = []
  for (const run of child.childNodes) {
    if (run.nodeType === Node.TEXT_NODE) {
      if (run.textContent) {
        elements.push({ textRun: { content: run.textContent, textStyle: defaultTextStyle() } })
      }
    } else if (run.nodeType === Node.ELEMENT_NODE) {
      if (run.classList?.contains('search-highlight') || run.classList?.contains('search-current')) {
        elements.push({ textRun: { content: run.textContent || '', textStyle: defaultTextStyle() } })
        continue
      }
      const runStyle = window.getComputedStyle(run)
      const textStyle = defaultTextStyle({
        bold: runStyle.fontWeight === '700' || runStyle.fontWeight === 'bold',
        italic: runStyle.fontStyle === 'italic',
        underline: runStyle.textDecorationLine.includes('underline'),
      })
      const fs = parseInt(runStyle.fontSize, 10)
      if (fs && fs !== 16 && fs !== props.zoom) textStyle.fontSize = fs
      elements.push({ textRun: { content: run.innerText || '', textStyle } })
    }
  }
  if (elements.length === 0) {
    elements.push({ textRun: { content: '', textStyle: defaultTextStyle() } })
  }
  return {
    id: child.dataset.paraId || generateParagraphId(),
    leftIndent: leftIndentPx > 0 ? Math.round(leftIndentPx / 96 * 10) / 10 : null,
    rightIndent: rightIndentPx > 0 ? Math.round(rightIndentPx / 96 * 10) / 10 : null,
    firstLineIndent: null, // recomputed in syncFromDOM
    elements,
  }
}

function readSectionTitleText(el) {
  const sectionType = el.dataset.sectionType
  const span = sectionType === 'chapter'
    ? el.querySelector('.section-subtitle')
    : el.querySelector('.section-title-text')
  const text = span ? (span.textContent || '') : ''
  return text.replace(/ /g, ' ').trim()
}

function domToBlocks(root) {
  const blocks = []
  for (const child of Array.from(root.children)) {
    if (isNonContentBlock(child)) continue

    if (child.classList?.contains('section-title')) {
      blocks.push({
        kind: 'section-title',
        sectionId: child.dataset.sectionId || generateSectionId(),
        sectionType: child.dataset.sectionType || 'section',
        title: readSectionTitleText(child),
      })
    } else if (child.classList?.contains('paragraph')) {
      blocks.push({
        kind: 'paragraph',
        sectionId: child.dataset.sectionId,
        paragraphId: child.dataset.paraId,
        paragraph: parseParagraphElement(child),
      })
    }
  }
  return blocks
}

/// Stamp the render-derived `chapterIndex` onto each section-title block (1-based
/// running count of chapters; null for non-chapters). `flattenSections` already
/// does this for model-sourced blocks, but `domToBlocks` (the DOM readback path)
/// does not — so blocks built from the DOM must be baked here to match. The
/// reconciler renders a block via this index to reproduce the "Chapter N: "
/// prefix; without it, every chapter title would falsely diff as changed after
/// an edit. Idempotent: re-baking a flattenSections list yields the same values.
function bakeChapterIndices(blocks) {
  let chapterIndex = 0
  for (const block of blocks) {
    if (block.kind === 'section-title') {
      block.chapterIndex = block.sectionType === 'chapter' ? ++chapterIndex : null
    }
  }
}

/// Read back the whole sheet into the model and emit the full sections array.
/// This is the FALLBACK for the localized syncFromDOM: used when an edit can't
/// be confidently confined to one section (no selection, no section id, or the
/// section structure looks changed) and on the first paint. It is the
/// pre-localization behavior verbatim. O(document) — the localized path is
/// what makes typing feel good; this only runs on structural ambiguity.
function fullSyncFromDOM() {
  const root = sheetRef.value
  if (!root || !props.modelValue) return
  const blocks = domToBlocks(root)
  bakeChapterIndices(blocks)

  // Compute and bake section-aware first-line indents.
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind !== 'paragraph') continue
    blocks[i].paragraph.firstLineIndent = computeFirstLineIndent(blocks, i)
  }

  // Reflect computed indents back into the live DOM so paragraphs created by
  // the browser (which don't copy inline styles) show the right indent.
  const domParas = Array.from(root.querySelectorAll('.paragraph'))
  let pIdx = 0
  for (const block of blocks) {
    if (block.kind !== 'paragraph') continue
    const dom = domParas[pIdx]
    pIdx++
    if (!dom) continue
    const indent = block.paragraph.firstLineIndent
    dom.style.textIndent = indent > 0 ? `${Math.round(indent * 96)}px` : '0px'
  }

  let sections = groupBlocks(blocks)
  // Defensive: every section must have at least one paragraph to type into.
  for (const s of sections) {
    if (!s.paragraphs || s.paragraphs.length === 0) s.paragraphs.push(createParagraph())
  }

  // Keep the retained block list in sync with the live DOM so a later external
  // change diffs against reality, not a pre-typing snapshot.
  lastRenderedBlocks.value = blocks
  lastSectionCount.value = blocks.filter(b => b.kind === 'section-title').length

  skipNextWatcher.value = true
  emit('syncSections', sections)
}

/// Read back ONLY the cursor's section into the model and emit that one
/// section. Every onInput edit is confined to one section — cross-section
/// backspace/delete is preventDefault'd (onKeydown) and locked section-titles
/// block input (onBeforeinput) — so the whole-sheet readback fullSyncFromDOM
/// performs is unnecessary on the typing path. That readback called
/// window.getComputedStyle() per paragraph AND per styled run
/// (parseParagraphElement): an O(document) layout read per keystroke, which is
/// the typing lag at 51k words. Reading one section makes it O(section) — a
/// handful of getComputedStyle calls. Falls back to fullSyncFromDOM whenever it
/// can't confidently localize (worst case = today's behavior).
function syncFromDOM() {
  const root = sheetRef.value
  if (!root || !props.modelValue) return

  const sectionId = getSectionIdAtCursor()
  const titleEls = root.querySelectorAll('.section-title')
  // Structural gate: if the live section-title count differs from the retained
  // baseline, an edit crossed a section boundary (added/removed/merged a
  // section) — a localized read would miss the other side. Fall back to the
  // full readback. O(section-titles) DOM walk, no layout reads.
  if (!sectionId || !lastRenderedBlocks.value || titleEls.length !== lastSectionCount.value) {
    fullSyncFromDOM()
    return
  }

  // Locate this section's title element within the titles we already walked.
  let titleEl = null
  for (const el of titleEls) {
    if (el.dataset.sectionId === sectionId) { titleEl = el; break }
  }
  if (!titleEl) { fullSyncFromDOM(); return }
  // Collect this section's paragraphs POSITIONALLY — the consecutive
  // `.paragraph` siblings after the title, up to the next `.section-title` (or
  // a trailing decoration / end). This matches groupBlocks' positional logic,
  // NOT an attribute match: a paragraph created by execCommand('insertParagraph')
  // (the Enter handler) is a fresh <div> that may not carry data-section-id, so
  // querying by attribute would miss it and silently drop the just-split
  // paragraph. Walking siblings by class is robust to that.
  const paraEls = []
  let sibling = titleEl.nextElementSibling
  while (sibling && sibling.classList.contains('paragraph')) {
    paraEls.push(sibling)
    sibling = sibling.nextElementSibling
  }

  // Build the section's block list: one title block + its paragraph blocks.
  const titleBlock = {
    kind: 'section-title',
    sectionId,
    sectionType: titleEl.dataset.sectionType || 'section',
    title: readSectionTitleText(titleEl),
  }
  // Preserve the render-derived chapterIndex from the retained baseline — a
  // typing edit doesn't change the title or type, so the index is unchanged and
  // re-baking it would need an O(document) chapter walk. (If the section
  // somehow isn't in the baseline the gate above caught it, but guard anyway.)
  const prevTitle = lastRenderedBlocks.value.find(
    b => b.kind === 'section-title' && b.sectionId === sectionId
  )
  if (!prevTitle) { fullSyncFromDOM(); return }
  titleBlock.chapterIndex = prevTitle.chapterIndex

  const blocks = [titleBlock]
  for (const el of paraEls) {
    blocks.push({
      kind: 'paragraph',
      sectionId,
      paragraphId: el.dataset.paraId,
      paragraph: parseParagraphElement(el),
    })
  }

  // Compute and bake first-line indents within this section only. The title is
  // blocks[0]; computeFirstLineIndent looks back only to the previous block in
  // this local list, so a section's indents are self-contained.
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind !== 'paragraph') continue
    blocks[i].paragraph.firstLineIndent = computeFirstLineIndent(blocks, i)
  }

  // Reflect computed indents back into this section's live DOM paragraphs only.
  let pi = 0
  for (const block of blocks) {
    if (block.kind !== 'paragraph') continue
    const dom = paraEls[pi]
    pi++
    if (!dom) continue
    const indent = block.paragraph.firstLineIndent
    dom.style.textIndent = indent > 0 ? `${Math.round(indent * 96)}px` : '0px'
  }

  // Group this section's blocks back into a Section (defensive ≥1 paragraph).
  const sections = groupBlocks(blocks)
  const s = sections[0]
  if (!s) { fullSyncFromDOM(); return }
  if (!s.paragraphs || s.paragraphs.length === 0) s.paragraphs.push(createParagraph())

  // Splice the section's blocks into the retained list, replacing its old
  // title + paragraphs in place. Section-title count is unchanged by a
  // within-section edit, so lastSectionCount stays correct without recompute.
  const all = lastRenderedBlocks.value
  const startIdx = all.findIndex(
    b => b.kind === 'section-title' && b.sectionId === sectionId
  )
  if (startIdx === -1) { fullSyncFromDOM(); return }
  let endIdx = startIdx + 1
  while (endIdx < all.length && all[endIdx].kind !== 'section-title') endIdx++
  lastRenderedBlocks.value = all.slice(0, startIdx).concat(blocks, all.slice(endIdx))

  skipNextWatcher.value = true
  emit('syncSection', { id: s.id, title: s.title, paragraphs: s.paragraphs })
}

// --- Page-break layout -------------------------------------------------------
// pageBreaks (from usePagination) are indices into the flattened block
// sequence (section-titles + paragraphs, no epigram). layoutPageBreaks walks
// the live DOM content blocks in that same order and stamps data-page-start on
// whichever block begins a page. CSS targets [data-page-start] generally, so a
// page can begin on either a section-title or a paragraph.

function layoutPageBreaks() {
  const root = sheetRef.value
  if (!root) return

  root.querySelectorAll('.page-break-line').forEach(el => el.remove())
  root.querySelectorAll('.editor-sentinel').forEach(el => el.remove())
  root.querySelectorAll('[data-page-start]').forEach(el => el.removeAttribute('data-page-start'))

  const blocks = flattenSections(props.modelValue?.sections || [])
  if (blocks.length === 0) return

  const breaks = pageBreaks.value
  let blockIndex = 0
  let pageNum = 1
  let lastContentNode = null
  let lastParagraphNode = null
  let currentNode = root.firstElementChild

  while (currentNode) {
    const isContent = currentNode.classList?.contains('section-title') ||
      currentNode.classList?.contains('paragraph')
    if (!isContent) {
      currentNode = currentNode.nextElementSibling
      continue
    }

    if (blockIndex === 0 || breaks.includes(blockIndex)) {
      if (blockIndex !== 0) pageNum++
      currentNode.setAttribute('data-page-start', String(pageNum))
    }

    lastContentNode = currentNode
    if (currentNode.classList.contains('paragraph')) lastParagraphNode = currentNode
    blockIndex++
    currentNode = currentNode.nextElementSibling
  }

  // Trailing page-break line + sentinel for visual closure and to absorb
  // clicks below the last page break (same purpose as the old code).
  if (lastContentNode) {
    const hr = document.createElement('hr')
    hr.className = 'page-break-line'
    hr.setAttribute('contenteditable', 'false')
    hr.style.cssText = `border:none;border-top:1px dashed var(--page-break-color);opacity:0.25;margin:1.2em 0;`
    root.insertBefore(hr, lastContentNode.nextSibling)

    const sentinel = document.createElement('div')
    sentinel.className = 'editor-sentinel'
    sentinel.setAttribute('contenteditable', 'false')
    sentinel.style.cssText = 'height:48px;user-select:none;'
    const focusTarget = lastParagraphNode || lastContentNode
    sentinel.addEventListener('click', (e) => {
      e.preventDefault()
      if (focusTarget) {
        const range = document.createRange()
        range.selectNodeContents(focusTarget)
        range.collapse(false)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
      }
    })
    root.appendChild(sentinel)
  }
}

// --- Reconciliation (external model changes) ---------------------------------
// When the model changes outside the editor (undo, rename, delete, type-change,
// restore), patch the live DOM surgically by stable block id instead of the
// full `innerHTML` rebuild renderEditor performs — so the cursor and scroll
// stay where the user left them. The pure op computation lives in
// useEditorReconcile.js; this function owns the DOM application, cursor
// save/restore, the epigram, and a drift-gate fallback to renderEditor.

/// Render a single block to its full outer HTML, matching renderEditor's
/// rendering byte-for-byte so an unchanged block is `keep`, not a false
/// `replace`. Uses the block's baked `chapterIndex` (set by flattenSections or
/// bakeChapterIndices) for the render-derived chapter prefix.
function renderBlockHTML(block) {
  if (block.kind === 'section-title') {
    const idx = block.chapterIndex
    const chapterPrefix = idx != null ? sectionFormat.formatChapter(idx) : ''
    return sectionTitleToHTML(
      { id: block.sectionId, title: block.title, sectionType: block.sectionType },
      idx,
      chapterPrefix,
      { fresh: block.sectionId === freshSectionId.value }
    )
  }
  return paragraphToHTML(block.paragraph, { sectionId: block.sectionId })
}

/// The visible text of an editable block — the same string the DOM renders and
/// `bookmarkSelection` measures offsets against. Paragraph runs are joined with
/// no separator (useParagraphHTML.js), and a title's editable unit is its
/// subtitle/title span, whose text is `block.title`. Used to shift a bookmarked
/// caret by the character delta when a block's text changes on undo/redo.
function blockPlainText(block) {
  if (block.kind === 'section-title') return block.title || ''
  return (block.paragraph?.elements || []).map(e => e.textRun?.content || '').join('')
}

/// Map a caret offset measured in `oldText` to the corresponding offset in
/// `newText`. The two are assumed to differ by a single replaced middle region
/// (the common case for undo/redo of typing within one paragraph): a common
/// prefix and common suffix flank the change. A caret in the unchanged prefix
/// or suffix is shifted by the net length change of the middle; a caret that sat
/// inside the replaced region lands at its start. This is why undoing "big dog"
/// (typed before "specifications") moves the caret from "after big dog" back to
/// the insertion point instead of 7 characters deep into "specifications".
function adjustOffsetForReplace(oldText, newText, offset) {
  if (oldText === newText) return offset
  const oldLen = oldText.length
  const newLen = newText.length
  if (offset <= 0) return 0
  let prefix = 0
  while (prefix < oldLen && prefix < newLen && oldText[prefix] === newText[prefix]) prefix++
  if (offset <= prefix) return offset
  let suffix = 0
  while (
    suffix < oldLen - prefix && suffix < newLen - prefix &&
    oldText[oldLen - 1 - suffix] === newText[newLen - 1 - suffix]
  ) suffix++
  const oldChangeEnd = oldLen - suffix
  const newChangeEnd = newLen - suffix
  if (offset >= oldChangeEnd) return offset - oldChangeEnd + newChangeEnd
  return prefix
}

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

  // Epigram: a non-content block at the very front, not part of flattenSections.
  const wantEpigram = !!(props.modelValue.hasEpigram && props.modelValue.epigramText)
  let epigramNode = root.querySelector('.epigram-block')
  if (wantEpigram) {
    const epigramHtml = `<div class="epigram-block">${escapeHtml(props.modelValue.epigramText).replace(/\n/g, '<br>')}</div>`
    if (!epigramNode) {
      epigramNode = document.createElement('div')
      root.insertBefore(epigramNode, root.firstChild)
    }
    if (epigramNode.outerHTML !== epigramHtml) epigramNode.outerHTML = epigramHtml
    epigramNode = root.querySelector('.epigram-block')
  } else if (epigramNode) {
    epigramNode.remove()
    epigramNode = null
  }

  const { ops, removedKeys } = computeReconcileOps(oldBlocks, newBlocks, renderBlockHTML)

  // Apply ops in new order, keeping a prevNode cursor so each block lands in the
  // right place. Content blocks live after the epigram (if any); the hr/sentinel
  // are gone, so epigram + content are the only children while we patch.
  let prevNode = epigramNode || null
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
    const expectedNext = prevNode
      ? prevNode.nextSibling
      : (epigramNode ? epigramNode.nextSibling : root.firstChild)
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

  // Shallow-copy paragraph blocks so baking computed indents does not mutate
  // the store's reactive paragraphs.
  const blocks = flattenSections(props.modelValue?.sections || []).map(b => {
    if (b.kind === 'paragraph') return { ...b, paragraph: { ...b.paragraph } }
    return b
  })

  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind !== 'paragraph') continue
    blocks[i].paragraph.firstLineIndent = computeFirstLineIndent(blocks, i)
  }
  // Record the baked block list so a later external change can diff against it
  // instead of rebuilding the whole sheet.
  lastRenderedBlocks.value = blocks
  lastSectionCount.value = blocks.filter(b => b.kind === 'section-title').length

  let chapterIndex = 0
  let html = blocks.map(b => {
    if (b.kind === 'section-title') {
      const idx = b.sectionType === 'chapter' ? ++chapterIndex : null
      const chapterPrefix = idx != null ? sectionFormat.formatChapter(idx) : ''
      return sectionTitleToHTML(
        { id: b.sectionId, title: b.title, sectionType: b.sectionType },
        idx,
        chapterPrefix,
        { fresh: b.sectionId === freshSectionId.value }
      )
    }
    return paragraphToHTML(b.paragraph, { sectionId: b.sectionId })
  }).join('')

  if (props.modelValue?.hasEpigram && props.modelValue?.epigramText) {
    const epigramHtml = `<div class="epigram-block">${escapeHtml(props.modelValue.epigramText).replace(/\n/g, '<br>')}</div>`
    html = epigramHtml + html
  }

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

// Current page number at the cursor: walk back from the cursor's block to the
// nearest [data-page-start] marker. (Mid-page blocks have no marker of their
// own, so reading the cursor block's own data-page-start would wrongly default
// to 1 — this walk finds the page-start block that owns the current page.)
function currentPageAtCursor() {
  const sheet = sheetRef.value
  if (!sheet) return 1
  const current = getParagraphAtCursor() || getSectionTitleAtCursor()
  if (!current) return 1
  let walk = current
  while (walk) {
    if (walk.dataset?.pageStart) return parseInt(walk.dataset.pageStart, 10)
    walk = walk.previousElementSibling
  }
  return 1
}

// Place the cursor on the first paragraph of the page whose start block is
// `startEl` (a section-title or paragraph). If the page starts with a
// section-title, drop into the first paragraph after it.
//
// `behavior` defaults to 'smooth' for in-view page navigation (adjacent pages,
// a short pleasant glide). View-switch restoration passes 'auto' (instant): a
// switch can jump many pages, and a smooth glide there would briefly flash the
// wrong page (the scroll-layer keeps its old pixel scrollTop until the glide
// finishes) before settling — instant jumps straight to the target page.
function focusPageStart(startEl, behavior = 'smooth') {
  let target = startEl
  if (startEl.classList.contains('section-title')) {
    let next = startEl.nextElementSibling
    while (next && !next.classList.contains('paragraph') && !next.classList.contains('section-title')) {
      next = next.nextElementSibling
    }
    if (next && next.classList.contains('paragraph')) target = next
  }
  placeCursorAtStart(target)
  target.scrollIntoView({ behavior, block: 'start' })
}

function navigatePage(direction) {
  const sheet = sheetRef.value
  if (!sheet) return
  const currentPage = currentPageAtCursor()
  const targetPage = currentPage + direction
  if (targetPage < 1) return
  const startEl = sheet.querySelector(`[data-page-start="${targetPage}"]`)
  if (!startEl) return
  focusPageStart(startEl)
}

// Absolute scroll-to-page for view switching (5.1b): place the cursor + scroll
// to the start of page `n`, reusing the same focusPageStart navigatePage uses.
// Unlike navigatePage this takes an absolute page number (captured from the
// outgoing view) rather than a relative step. Instant ('auto') behavior — see
// focusPageStart — so the switch doesn't glide through intermediate pages.
//
// CRITICAL: on a manuscript→editor switch the editor mounts FRESH. Its
// data-page-start stamps are applied by layoutPageBreaks(), which renderEditor
// defers to a nextTick. But App.vue queues this scrollToPage the instant
// viewMode flips — BEFORE the editor's deferred layoutPageBreaks runs — so the
// stamps are absent when we arrive, the querySelector finds nothing, and we'd
// silently no-op, leaving the editor at the manuscript's old pixel scrollTop
// (which in the editor's denser layout is a DIFFERENT page — the 9→13 drift,
// same ~1.44x ratio as the original 15→23 bug). layoutPageBreaks is synchronous
// and idempotent (clears + re-stamps from the already-populated pageBreaks
// prop, and renderEditor has already built the content DOM by onMounted), so
// calling it here guarantees the stamps exist before we query.
function scrollToPage(n) {
  const sheet = sheetRef.value
  if (!sheet) return
  layoutPageBreaks()
  const targetPage = Math.max(1, n)
  const startEl = sheet.querySelector(`[data-page-start="${targetPage}"]`)
  if (startEl) focusPageStart(startEl, 'auto')
}

// The page currently at the TOP of the visible area — the editor's screen-based
// notion of "current page" for view switching. We read the VISIBLE page, not
// the caret's page: if the writer scrolled with the scrollbar without clicking,
// the caret is stale (still wherever they last clicked), so currentPageAtCursor
// would report a page they're not looking at. The manuscript side already reads
// the visible page (getCurrentContentPage); reading the same way here makes the
// two directions symmetric and the switch preserve what's on screen. Walks the
// [data-page-start] markers in DOM order and picks the highest one at or above
// the scroll-layer's visible top (its top + ~40px padding).
function currentPageAtTop() {
  const sheet = sheetRef.value
  if (!sheet) return 1
  const layer = sheet.closest('.scroll-layer')
  const targetY = layer ? layer.getBoundingClientRect().top + 40 : 40
  const starts = sheet.querySelectorAll('[data-page-start]')
  let current = 1
  for (const el of starts) {
    if (el.getBoundingClientRect().top <= targetY) {
      current = parseInt(el.getAttribute('data-page-start'), 10)
    } else {
      break // DOM order === page order; nothing further can be at/above the line
    }
  }
  return current
}

// The page number at the caret — used by App.vue when switching FROM the editor
// to another view so the incoming view can land on the same page. Screen-based
// (see currentPageAtTop); page numbers agree across views because pagination is
// shared.
function getCurrentPage() {
  return currentPageAtTop()
}

// Jump the cursor to the first paragraph of the next/previous page that begins
// with a section-title (the section-aware replacement for navigateHeadingPage).
function navigateSectionPage(direction) {
  const sheet = sheetRef.value
  if (!sheet) return
  const currentPage = currentPageAtCursor()
  const sectionTitles = Array.from(sheet.querySelectorAll('.section-title[data-page-start]'))
  const sectionPages = sectionTitles.map(el => parseInt(el.dataset.pageStart, 10))
  let targetPage
  if (direction > 0) {
    targetPage = sectionPages.find(p => p > currentPage)
  } else {
    targetPage = [...sectionPages].reverse().find(p => p < currentPage)
  }
  if (!targetPage) return
  const startEl = sheet.querySelector(`.section-title[data-page-start="${targetPage}"]`)
  if (!startEl) return
  focusPageStart(startEl)
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

.editor-sheet :deep(.section-title .chapter-prefix) {
  /* locked, derived — no special styling beyond inheriting the title's look */
}

.editor-sheet :deep(.epigram-block) {
  font-style: italic;
  text-align: center;
  margin-bottom: 1.5em;
  white-space: pre-line;
  opacity: 0.7;
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