<template>
  <div
    class="editor-sheet"
    contenteditable="true"
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
import { ref, onMounted, nextTick, watch, computed, toRef } from 'vue'
import { paragraphToHTML, sectionTitleToHTML, escapeHtml } from '../../composables/useParagraphHTML.js'
import { flattenSections, groupBlocks, computeFirstLineIndent } from '../../composables/useSectionBlocks.js'
import { usePagination } from '../../composables/usePagination.js'
import { applySearchHighlights, clearSearchHighlights } from '../../composables/useSearchHighlights.js'
import { THEMES } from '../../constants/themes.js'
import { generateParagraphId, generateSectionId, createSection, createParagraph, defaultTextStyle } from '../../constants/DocumentModel.js'
import { useSectionFormat } from '../../composables/useSectionFormat.js'

const props = defineProps({
  modelValue: Object,
  theme: { type: Number, default: 0 },
  zoom: { type: Number, default: 16 },
  margin: { type: String, default: 'compact' },
})
const emit = defineEmits(['syncSections', 'update', 'deleteSection'])

const sheetRef = ref(null)
// The id of a just-inserted section whose title the user is editing inline. While
// set, that one .section-title stays contenteditable; every other section-title
// is locked. Cleared by Enter/Escape/click-away (see lockFreshSection). This is the
// old `freshHeadingId` mechanism retargeted at section titles.
const freshSectionId = ref(null)
const skipNextWatcher = ref(false)
const docRef = toRef(props, 'modelValue')
const { pageBreaks } = usePagination(docRef)
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

function syncFromDOM() {
  const root = sheetRef.value
  if (!root || !props.modelValue) return
  const blocks = domToBlocks(root)

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

  skipNextWatcher.value = true
  emit('syncSections', sections)
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

// --- Cursor / block helpers --------------------------------------------------

function getParagraphAtCursor() {
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

function getSectionTitleAtCursor() {
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

function getSectionIdAtCursor() {
  const el = getParagraphAtCursor() || getSectionTitleAtCursor()
  if (!el) return null
  return el.dataset.sectionId || null
}

function isCaretAtStart(range, element) {
  const temp = range.cloneRange()
  temp.selectNodeContents(element)
  temp.collapse(true)
  return range.compareBoundaryPoints(Range.START_TO_START, temp) === 0
}

function isCaretAtEnd(range, element) {
  const temp = range.cloneRange()
  temp.selectNodeContents(element)
  temp.collapse(false)
  return range.compareBoundaryPoints(Range.END_TO_END, temp) === 0
}

// The editable span inside a section-title: .section-subtitle for a Chapter
// (the prefix is locked), .section-title-text for a Section (the whole title).
function editableSpanOf(sectionEl) {
  return sectionEl.querySelector('.section-subtitle') ||
    sectionEl.querySelector('.section-title-text') ||
    sectionEl
}

// --- Page/line navigation (exposed to the parent for keyboard shortcuts) -----

function placeCursorAtStart(el) {
  const range = document.createRange()
  range.setStart(el, 0)
  range.collapse(true)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
}

/// Return the plain text of the current selection within the editor sheet, or
/// '' when nothing is selected or the selection lies outside the sheet. Used by
/// the Assistant panel's `selection` scope — the model reads the writer's
/// selected text as context.
function getSelectionText() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return ''
  const text = sel.toString()
  if (!text) return ''
  // Confirm the selection is within this editor sheet so we don't capture
  // selections made in other UI (e.g. the nav drawer).
  const root = sheetRef.value
  if (!root) return text
  let node = sel.anchorNode
  let el = node?.nodeType === 3 ? node.parentElement : node
  while (el && el !== root) el = el.parentElement
  return el === root ? text : ''
}

function selectLine() {
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
function focusPageStart(startEl) {
  let target = startEl
  if (startEl.classList.contains('section-title')) {
    let next = startEl.nextElementSibling
    while (next && !next.classList.contains('paragraph') && !next.classList.contains('section-title')) {
      next = next.nextElementSibling
    }
    if (next && next.classList.contains('paragraph')) target = next
  }
  placeCursorAtStart(target)
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
    const sel2 = window.getSelection()
    if (sel2.rangeCount) {
      let node = sel2.anchorNode
      let para = node.nodeType === 3 ? node.parentElement : node
      while (para && !para.classList?.contains('paragraph')) {
        para = para.parentElement
      }
      if (para) para.style.textIndent = '0px'
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
  // Re-render when the store doc changes externally (rename, delete, load).
  // Skipped when the change originated here (syncFromDOM, insertSection).
  renderEditor()
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
})

defineExpose({
  syncFromDOM,
  renderFromDoc,
  insertSection,
  scrollToParagraph,
  scrollToSection,
  selectLine,
  navigatePage,
  navigateSectionPage,
  applySearchHighlights: editorApplySearchHighlights,
  clearSearchHighlights: editorClearSearchHighlights,
  // The Assistant panel's `selection` scope reads the editor's current text
  // selection. Returns the plain-text selection within the sheet, or '' when
  // nothing is selected / the selection is outside the editor.
  getSelectionText,
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