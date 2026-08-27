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
import { paragraphToHTML, paragraphsToHTML, escapeHtml } from '../../composables/useParagraphHTML.js'
import { usePagination } from '../../composables/usePagination.js'
import { applySearchHighlights, clearSearchHighlights } from '../../composables/useSearchHighlights.js'
import { ParagraphStyle, isHeading, getHeadingLevel, shouldHaveFirstLineIndent, isEmptyParagraph } from '../../constants/ParagraphStyle.js'
import { THEMES } from '../../constants/themes.js'
import { generateParagraphId, defaultTextStyle } from '../../constants/DocumentModel.js'
import { useHeadingFormat } from '../../composables/useHeadingFormat.js'

const props = defineProps({
  modelValue: Object,
  theme: { type: Number, default: 0 },
  zoom: { type: Number, default: 16 },
  margin: { type: String, default: 'compact' },
})
const emit = defineEmits(['syncBody', 'update'])

const sheetRef = ref(null)
const freshHeadingId = ref(null)
const skipNextWatcher = ref(false)
const docRef = toRef(props, 'modelValue')
const { pageBreaks } = usePagination(docRef)
const headingFormat = useHeadingFormat()

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

function applyHeadingLocks() {
  const root = sheetRef.value
  if (!root) return
  const headings = root.querySelectorAll('.paragraph.heading-1, .paragraph.heading-2, .paragraph.heading-3, .paragraph.heading-4, .paragraph.heading-5, .paragraph.heading-6')
  headings.forEach(el => {
    if (el.dataset.paraId !== freshHeadingId.value) {
      el.setAttribute('contenteditable', 'false')
    } else {
      el.removeAttribute('contenteditable')
    }
  })
}

function lockFreshHeading() {
  if (!freshHeadingId.value) return
  const root = sheetRef.value
  if (!root) return
  const el = root.querySelector(`[data-para-id="${freshHeadingId.value}"]`)
  if (el) el.setAttribute('contenteditable', 'false')
  freshHeadingId.value = null
}

function domToParagraphs(root) {
  const paragraphs = []
  const targets = Array.from(root.children)

  for (const child of targets) {
    if (child.nodeName === 'DIV' || child.nodeName === 'P') {
      if (
        child.classList?.contains('page-number-label') ||
        child.classList?.contains('page-break-line') ||
        child.classList?.contains('epigram-block') ||
        child.classList?.contains('editor-sentinel')
      ) continue

      const style = window.getComputedStyle(child)
      const leftIndentPx = parseInt(style.marginLeft, 10) || 0
      const rightIndentPx = parseInt(style.marginRight, 10) || 0
      const firstLinePx = parseInt(style.textIndent, 10) || 0

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

      paragraphs.push({
        id: child.dataset.paraId || generateParagraphId(),
        paragraphStyle: child.dataset.paraStyle || ParagraphStyle.Normal,
        leftIndent: leftIndentPx > 0 ? Math.round(leftIndentPx / 96 * 10) / 10 : undefined,
        rightIndent: rightIndentPx > 0 ? Math.round(rightIndentPx / 96 * 10) / 10 : undefined,
        firstLineIndent: firstLinePx > 0 ? Math.round(firstLinePx / 96 * 10) / 10 : undefined,
        elements
      })
    }
  }

  if (paragraphs.length === 0) {
    paragraphs.push({ id: generateParagraphId(), paragraphStyle: ParagraphStyle.Normal, elements: [{ textRun: { content: '', textStyle: defaultTextStyle() } }] })
  }

  return paragraphs
}

function syncFromDOM() {
  const root = sheetRef.value
  if (!root || !props.modelValue) return
  const paragraphs = domToParagraphs(root)
  const domParas = Array.from(root.querySelectorAll('.paragraph'))

  // Recompute first-line indent considering page breaks so the first
  // non-heading paragraph on each page gets indent even if it follows a
  // heading or empty paragraph on the previous page.
  for (let i = 0; i < paragraphs.length; i++) {
    const dom = domParas[i]
    if (isHeading(paragraphs[i].paragraphStyle)) {
      paragraphs[i].firstLineIndent = 0
    } else if (dom && dom.hasAttribute('data-page-first-content') && i > 0) {
      const prev = paragraphs[i - 1]
      const prev2 = paragraphs[i - 2]
      if (prev && isHeading(prev.paragraphStyle)) {
        paragraphs[i].firstLineIndent = 0
      } else if (prev && isEmptyParagraph(prev) && prev2 && isEmptyParagraph(prev2)) {
        paragraphs[i].firstLineIndent = 0
      } else {
        paragraphs[i].firstLineIndent = 0.5
      }
    } else if (shouldHaveFirstLineIndent(paragraphs, i)) {
      paragraphs[i].firstLineIndent = 0.5
    } else {
      paragraphs[i].firstLineIndent = 0
    }
  }

  // Reflect computed first-line indents back into the live DOM so paragraphs
  // created by the browser (which don't copy inline styles) show the right indent.
  for (let i = 0; i < domParas.length && i < paragraphs.length; i++) {
    const p = paragraphs[i]
    const dom = domParas[i]
    const level = getHeadingLevel(p.paragraphStyle)
    if (level > 0) {
      dom.style.textIndent = '0px'
    } else if (typeof p.firstLineIndent === 'number') {
      dom.style.textIndent = p.firstLineIndent > 0 ? `${Math.round(p.firstLineIndent * 96)}px` : '0px'
    } else {
      dom.style.textIndent = '48px'
    }
  }

  skipNextWatcher.value = true
  emit('syncBody', paragraphs)
}

function layoutPageBreaks() {
  const root = sheetRef.value
  if (!root) return

  // Remove any legacy inserted break elements (from previous renders)
  root.querySelectorAll('.page-break-line').forEach(el => el.remove())
  root.querySelectorAll('.page-number-label').forEach(el => el.remove())
  root.querySelectorAll('.editor-sentinel').forEach(el => el.remove())
  // Clear old page-start and page-first-content attributes before re-applying
  root.querySelectorAll('.paragraph[data-page-start]').forEach(el => el.removeAttribute('data-page-start'))
  root.querySelectorAll('.paragraph[data-page-first-content]').forEach(el => el.removeAttribute('data-page-first-content'))

  const paragraphs = props.modelValue?.body?.content || []
  if (paragraphs.length === 0) return

  const breaks = pageBreaks.value

  // Walk the live DOM and mark the first paragraph of each page
  let pageNum = 1
  let paraIndex = 0
  let currentNode = root.firstElementChild
  let lastParagraphNode = null
  let firstContentMarked = false

  while (currentNode) {
    if (!currentNode.classList?.contains('paragraph')) {
      currentNode = currentNode.nextElementSibling
      continue
    }

    if (paraIndex === 0 || breaks.includes(paraIndex)) {
      if (paraIndex !== 0) pageNum++
      currentNode.setAttribute('data-page-start', String(pageNum))
      firstContentMarked = false
    }

    if (!firstContentMarked && !isHeading(paragraphs[paraIndex]?.paragraphStyle) && !isEmptyParagraph(paragraphs[paraIndex])) {
      currentNode.setAttribute('data-page-first-content', String(pageNum))
      firstContentMarked = true
    }

    lastParagraphNode = currentNode
    paraIndex++
    currentNode = currentNode.nextElementSibling
  }

  // Trailing page-break line after the last paragraph for visual closure
  if (lastParagraphNode) {
    const hr = document.createElement('hr')
    hr.className = 'page-break-line'
    hr.setAttribute('contenteditable', 'false')
    hr.style.cssText = `border:none;border-top:1px dashed var(--page-break-color);opacity:0.25;margin:1.2em 0;`
    root.insertBefore(hr, lastParagraphNode.nextSibling)

    // Sentinel block absorbs cursor placement attempts below the last page break.
    // It must NOT have pointer-events:none or clicks pass through to the editable parent.
    const sentinel = document.createElement('div')
    sentinel.className = 'editor-sentinel'
    sentinel.setAttribute('contenteditable', 'false')
    sentinel.style.cssText = 'height:48px;user-select:none;'
    sentinel.addEventListener('click', (e) => {
      e.preventDefault()
      // Focus the last paragraph instead of letting the cursor land in empty space.
      if (lastParagraphNode) {
        const range = document.createRange()
        range.selectNodeContents(lastParagraphNode)
        range.collapse(false)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
      }
    })
    root.appendChild(sentinel)
  }
}

function ensureHeadingText(paragraphs) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
  for (const p of paragraphs) {
    const level = getHeadingLevel(p.paragraphStyle)
    if (level > 0) {
      counts[level]++
      const text = p.elements.map(el => el.textRun.content).join('').trim()
      if (!text) {
        // Empty heading: generate a default label so the user sees something
        const fallback = headingFormat.formatHeading(level, counts[level]) || `HEADING ${counts[level]}`
        p.elements = [{ textRun: { content: fallback, textStyle: defaultTextStyle() } }]
      }
      // If text is non-empty, we NEVER overwrite it here. Custom names are preserved.
    }
  }
}

function renderEditor() {
  const root = sheetRef.value
  if (!root) return
  // Work on a shallow copy so ensureHeadingText does not mutate the store's reactive array.
  const paragraphs = (props.modelValue?.body?.content || []).map(p => ({ ...p }))
  // Ensure every paragraph has a stable id so DOM reads can map back to the correct paragraph.
  for (const p of paragraphs) {
    if (!p.id) p.id = generateParagraphId()
  }
  ensureHeadingText(paragraphs)

  // Compute first-line indent for every paragraph before generating HTML.
  // Paragraphs that are the first non-heading text on a new page always get
  // indent, unless they immediately follow a heading or a scene break.
  const breaks = pageBreaks.value
  let firstContentOnPage = -1
  for (let i = 0; i < paragraphs.length; i++) {
    if (breaks.includes(i) && i > 0) {
      firstContentOnPage = -1
    }
    if (isHeading(paragraphs[i].paragraphStyle)) {
      paragraphs[i].firstLineIndent = 0
      continue
    }
    if (firstContentOnPage === -1 && !isEmptyParagraph(paragraphs[i])) {
      firstContentOnPage = i
      const prev = paragraphs[i - 1]
      const prev2 = paragraphs[i - 2]
      if (prev && isHeading(prev.paragraphStyle)) {
        paragraphs[i].firstLineIndent = 0
      } else if (prev && isEmptyParagraph(prev) && prev2 && isEmptyParagraph(prev2)) {
        paragraphs[i].firstLineIndent = 0
      } else {
        paragraphs[i].firstLineIndent = i === 0 ? 0 : 0.5
      }
      continue
    }
    if (firstContentOnPage === -1) {
      paragraphs[i].firstLineIndent = 0
      continue
    }
    if (shouldHaveFirstLineIndent(paragraphs, i)) {
      paragraphs[i].firstLineIndent = 0.5
    } else {
      paragraphs[i].firstLineIndent = 0
    }
  }

  let html = paragraphsToHTML(paragraphs)
  if (props.modelValue?.hasEpigram && props.modelValue?.epigramText) {
    const epigramHtml = `<div class="epigram-block">${escapeHtml(props.modelValue.epigramText).replace(/\n/g, '<br>')}</div>`
    html = epigramHtml + html
  }
  root.innerHTML = html
  applyHeadingLocks()
  nextTick(() => layoutPageBreaks())
}

function onInput() {
  syncFromDOM()
}

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

function getHeadingParagraphAtCursor() {
  const el = getParagraphAtCursor()
  if (el && isHeading(el.dataset.paraStyle)) {
    return el
  }
  return null
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

function getPreviousParagraph(el) {
  let prev = el.previousElementSibling
  while (prev && !prev.classList?.contains('paragraph')) {
    prev = prev.previousElementSibling
  }
  return prev || null
}

function getNextParagraph(el) {
  let next = el.nextElementSibling
  while (next && !next.classList?.contains('paragraph')) {
    next = next.nextElementSibling
  }
  return next || null
}

// --- Page/line navigation (exposed to the parent for keyboard shortcuts) -----
// These operate on this component's own sheet DOM (sheetRef.value) and read the
// data-page-start / data-para-style attributes set by layoutPageBreaks.

// Extend the current selection to the end of the next sibling paragraph (a
// "select line" action), or select the whole current paragraph if there is no
// next paragraph.
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

// Jump the cursor to the first paragraph of the page `direction` pages away from
// the cursor's current page. Each paragraph carries its page number in
// data-page-start, set by layoutPageBreaks.
function navigatePage(direction) {
  const sheet = sheetRef.value
  if (!sheet) return
  const paras = Array.from(sheet.querySelectorAll('.paragraph'))
  const current = getParagraphAtCursor()
  if (!current) return
  const currentPage = parseInt(current.dataset.pageStart, 10) || 1
  const targetPage = currentPage + direction
  if (targetPage < 1) return
  const target = paras.find(p => parseInt(p.dataset.pageStart, 10) === targetPage)
  if (!target) return
  placeCursorAtStart(target)
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// Jump the cursor to the first paragraph of the next/previous page that begins
// with a heading.
function navigateHeadingPage(direction) {
  const sheet = sheetRef.value
  if (!sheet) return
  const paras = Array.from(sheet.querySelectorAll('.paragraph'))
  const current = getParagraphAtCursor()
  if (!current) return
  const currentPage = parseInt(current.dataset.pageStart, 10) || 1
  const headings = paras.filter(p => /^heading[1-6]$/.test(p.dataset.paraStyle))
  const headingPages = headings.map(h => parseInt(h.dataset.pageStart, 10) || 1)
  let targetPage
  if (direction > 0) {
    targetPage = headingPages.find(p => p > currentPage)
  } else {
    targetPage = [...headingPages].reverse().find(p => p < currentPage)
  }
  if (!targetPage) return
  const target = paras.find(p => parseInt(p.dataset.pageStart, 10) === targetPage)
  if (!target) return
  placeCursorAtStart(target)
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function onKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault()
    const heading = getHeadingParagraphAtCursor()
    const inFresh = heading && heading.dataset.paraId === freshHeadingId.value
    if (inFresh) {
      lockFreshHeading()
      let nextPara = heading.nextElementSibling
      while (nextPara && !nextPara.classList?.contains('paragraph')) {
        nextPara = nextPara.nextElementSibling
      }
      if (nextPara && !isHeading(nextPara.dataset.paraStyle)) {
        placeCursorAtStart(nextPara)
        syncFromDOM()
        return
      }
      const newPara = document.createElement('div')
      newPara.className = 'paragraph'
      newPara.dataset.paraId = generateParagraphId()
      newPara.innerHTML = '<br>'
      heading.parentNode.insertBefore(newPara, heading.nextSibling)
      placeCursorAtStart(newPara)
      syncFromDOM()
      return
    }
    document.execCommand('defaultParagraphSeparator', false, 'div')
    document.execCommand('insertParagraph', false, null)
    // The browser often copies text-indent from the previous paragraph.
    // New paragraphs should start flush so the user controls the indent explicitly.
    const sel2 = window.getSelection()
    if (sel2.rangeCount) {
      let node = sel2.anchorNode
      let para = node.nodeType === 3 ? node.parentElement : node
      while (para && !para.classList?.contains('paragraph')) {
        para = para.parentElement
      }
      if (para) {
        para.style.textIndent = '0px'
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
    const heading = getHeadingParagraphAtCursor()

    if (heading) {
      // Cursor is inside a heading.
      if (heading.dataset.paraId === freshHeadingId.value) {
        // Fresh heading: allow text editing, but prevent paragraph deletion.
        if (e.key === 'Backspace' && isCaretAtStart(range, heading)) {
          e.preventDefault()
          return
        }
        if (e.key === 'Delete' && isCaretAtEnd(range, heading)) {
          e.preventDefault()
          return
        }
        // Otherwise allow normal text editing inside the fresh heading.
        return
      }
      // Locked heading: never allow backspace/delete.
      e.preventDefault()
      return
    }

    if (para) {
      // Cursor is in a normal paragraph: block boundary merges into headings.
      if (e.key === 'Backspace') {
        const prev = getPreviousParagraph(para)
        if (prev && isHeading(prev.dataset.paraStyle) && isCaretAtStart(range, para)) {
          e.preventDefault()
          return
        }
      }
      if (e.key === 'Delete') {
        const next = getNextParagraph(para)
        if (next && isHeading(next.dataset.paraStyle) && isCaretAtEnd(range, para)) {
          e.preventDefault()
          return
        }
      }
    }
  }

  if (e.key === 'Escape') {
    const heading = getHeadingParagraphAtCursor()
    if (heading && heading.dataset.paraId === freshHeadingId.value) {
      lockFreshHeading()
      let target = heading.nextElementSibling
      while (target && !target.classList?.contains('paragraph')) {
        target = target.nextElementSibling
      }
      if (target) {
        placeCursorAtStart(target)
      }
      e.preventDefault()
      return
    }
  }
}

function onBeforeinput(e) {
  const heading = getHeadingParagraphAtCursor()
  if (heading) {
    if (heading.dataset.paraId === freshHeadingId.value) {
      return
    }
    e.preventDefault()
  }
}

function onPaste(e) {
  e.preventDefault()
  const text = (e.clipboardData || window.clipboardData).getData('text/plain')
  document.execCommand('insertText', false, text)
  syncFromDOM()
}

function onMousedown(e) {
  if (!freshHeadingId.value) return
  const root = sheetRef.value
  if (!root) return
  const freshEl = root.querySelector(`[data-para-id="${freshHeadingId.value}"]`)
  if (freshEl && !freshEl.contains(e.target)) {
    lockFreshHeading()
  }
}

// --- Heading-insert helpers -------------------------------------------------
// These collapse what was previously two ~130-line functions (insertHeading +
// insertHeadingAtPageTop) that duplicated the title-computation, cursor-placement,
// and render-then-focus logic. The only real difference between the two was the
// index strategy, so each gets its own helper and the shared work lives in one
// insertHeading().

// Primitive: collapse the selection to the start of `el`.
function placeCursorAtStart(el) {
  const range = document.createRange()
  range.setStart(el, 0)
  range.collapse(true)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
}

// After inserting a heading, place the cursor in the first editable normal
// paragraph below it so the user can immediately start writing body content.
// If no such paragraph exists, just scroll the heading into view.
function focusBelowHeading(headingEl) {
  const nextPara = headingEl.nextElementSibling
  if (nextPara && nextPara.classList?.contains('paragraph') && !isHeading(nextPara.dataset.paraStyle)) {
    placeCursorAtStart(nextPara)
    nextPara.scrollIntoView({ behavior: 'smooth', block: 'center' })
  } else {
    headingEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

// Build the initial heading text. An explicit title is kept as-is; otherwise,
// when autoGenerate is on for this level, count existing headings of that level
// and format the next number (e.g. "Part II"). Returns the empty string when no
// title and no auto-generation applies.
function computeInitialTitle(type, title, paragraphs) {
  const level = getHeadingLevel(type)
  if (level <= 0 || title) return title
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
  for (const p of paragraphs) {
    const l = getHeadingLevel(p.paragraphStyle)
    if (l > 0) counts[l]++
  }
  counts[level]++
  const fmt = headingFormat.headingFormats.value[level]
  if (fmt && fmt.autoGenerate) {
    return headingFormat.formatHeading(level, counts[level])
  }
  return title
}

// Index strategy A — insert immediately after the paragraph holding the cursor
// (or at the end if there is no cursor). Used by the non-page-top insert mode.
function computeCursorInsertIndex(paragraphs) {
  const sel = window.getSelection()
  let currentParaId = null
  if (sel.rangeCount) {
    let node = sel.anchorNode
    if (node) {
      let el = node.nodeType === 3 ? node.parentElement : node
      while (el && !el.classList?.contains('paragraph')) {
        el = el.parentElement
      }
      if (el) currentParaId = el.dataset.paraId
    }
  }
  if (currentParaId) {
    const found = paragraphs.findIndex(p => p.id === currentParaId)
    if (found !== -1) return found + 1
  }
  return paragraphs.length
}

// Index strategy B — insert at the top of the current page. If `afterId` is
// given (a section/chapter selected in the nav drawer), insert after the last
// paragraph of that item's page. Otherwise walk back from the cursor to the
// page start; if the page already begins with a heading, force a new page by
// inserting after the last paragraph on the current page instead.
function computePageTopInsertIndex(paragraphs, root, afterId) {
  if (afterId) {
    const targetIdx = paragraphs.findIndex(p => p.id === afterId)
    if (targetIdx !== -1) {
      // Walk forward from target to find the last paragraph before the next heading.
      let lastIdx = targetIdx
      for (let i = targetIdx + 1; i < paragraphs.length; i++) {
        if (isHeading(paragraphs[i].paragraphStyle)) break
        lastIdx = i
      }
      return lastIdx + 1
    }
  }

  const sel = window.getSelection()
  let cursorPara = null
  if (sel.rangeCount) {
    let node = sel.anchorNode
    if (node) {
      let el = node.nodeType === 3 ? node.parentElement : node
      while (el && !el.classList?.contains('paragraph')) {
        el = el.parentElement
      }
      if (el) cursorPara = el
    }
  }

  // Find the page start: walk backwards from the cursor to the preceding page-number-label.
  let pageStartPara = null
  if (cursorPara) {
    let walk = cursorPara.previousElementSibling
    while (walk) {
      if (walk.classList?.contains('page-number-label')) {
        pageStartPara = walk.nextElementSibling
        while (pageStartPara && !pageStartPara.classList?.contains('paragraph')) {
          pageStartPara = pageStartPara.nextElementSibling
        }
        break
      }
      walk = walk.previousElementSibling
    }
  }

  // If no page break was found, the first paragraph is the page start.
  if (!pageStartPara) {
    let first = root.firstElementChild
    while (first && !first.classList?.contains('paragraph')) {
      first = first.nextElementSibling
    }
    pageStartPara = first
  }

  const pageHasHeading = pageStartPara && isHeading(pageStartPara.dataset.paraStyle)

  let targetParaId = null
  if (pageHasHeading) {
    // Page already has a heading — force a new page by inserting after the
    // last paragraph on the current page.
    let lastParaOnPage = null
    if (cursorPara) {
      let walk = cursorPara.nextElementSibling
      while (walk) {
        if (walk.classList?.contains('page-number-label')) break
        if (walk.classList?.contains('paragraph')) lastParaOnPage = walk
        walk = walk.nextElementSibling
      }
    }
    // If no next page-number-label was found, we are on the last page.
    if (!lastParaOnPage) {
      let walk = root.lastElementChild
      while (walk) {
        if (walk.classList?.contains('paragraph')) {
          lastParaOnPage = walk
          break
        }
        walk = walk.previousElementSibling
      }
    }
    targetParaId = lastParaOnPage?.dataset.paraId
  } else {
    targetParaId = pageStartPara?.dataset.paraId
  }

  if (targetParaId) {
    const found = paragraphs.findIndex(p => p.id === targetParaId)
    if (found !== -1) return pageHasHeading ? found + 1 : found
  }
  return paragraphs.length
}

// Insert a heading paragraph.
//   atPageTop: false → place it right after the cursor paragraph.
//   atPageTop: true  → place it at the top of the current page (or, if afterId is
//                     given, after the last paragraph of that nav item's page).
//                     Ensures an editable normal paragraph follows, and for a
//                     new H1 marks it "fresh" so the user can type its title
//                     inline before committing with Enter/Escape.
function insertHeading(type, title, { atPageTop = false, afterId = null } = {}) {
  syncFromDOM()
  const root = sheetRef.value
  if (!root) return

  const paragraphs = [...(props.modelValue.body.content || [])]
  const idx = atPageTop
    ? computePageTopInsertIndex(paragraphs, root, afterId)
    : computeCursorInsertIndex(paragraphs)

  const initialTitle = computeInitialTitle(type, title, paragraphs)
  const newPara = {
    id: generateParagraphId(),
    paragraphStyle: type,
    elements: [{ textRun: { content: initialTitle, textStyle: defaultTextStyle() } }],
  }
  paragraphs.splice(idx, 0, newPara)

  if (atPageTop) {
    // Ensure there's an editable normal paragraph after the heading.
    const next = paragraphs[idx + 1]
    if (!next || isHeading(next.paragraphStyle)) {
      const emptyPara = {
        id: generateParagraphId(),
        paragraphStyle: ParagraphStyle.Normal,
        elements: [{ textRun: { content: '', textStyle: defaultTextStyle() } }],
      }
      paragraphs.splice(idx + 1, 0, emptyPara)
    }
  }

  // A freshly inserted H1 stays editable until the user commits it with Enter
  // or Escape, or clicks away (see lockFreshHeading / onMousedown). Applied in
  // both insert modes so behaviour is consistent regardless of entry path.
  if (type === ParagraphStyle.Heading1) {
    freshHeadingId.value = newPara.id
  }

  ensureHeadingText(paragraphs)
  skipNextWatcher.value = true
  emit('syncBody', paragraphs)

  // Defer renderEditor until Vue's render cycle completes to avoid
  // innerHTML clashing with Vue's DOM patching.
  setTimeout(() => {
    renderEditor()
    nextTick(() => {
      const el = root.querySelector(`[data-para-id="${newPara.id}"]`)
      if (el) focusBelowHeading(el)
    })
  }, 0)
}

function scrollToParagraph(id) {
  const root = sheetRef.value
  if (!root) return
  const el = root.querySelector(`[data-para-id="${id}"]`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

function renderFromDoc() {
  renderEditor()
}

watch(() => props.modelValue?.body?.content, () => {
  if (skipNextWatcher.value) {
    skipNextWatcher.value = false
    return
  }
  // Re-render when store doc changes externally (rename, delete, loadDocument).
  // Skip if the change was initiated by the editor itself (syncFromDOM, insertHeading).
  renderEditor()
}, { deep: true })

watch(pageBreaks, () => {
  layoutPageBreaks()
})

// NOTE: there is deliberately no watch(props.theme) or watch(props.zoom).
// Previously both triggered a full renderEditor() (innerHTML rebuild), which
// discarded the caret every time the user changed theme or zoom. That rebuild
// was unnecessary: editorStyles (the reactive computed bound via :style)
// already updates background/text-color/font-size live, and page breaks are
// laid out by usePagination against fixed manuscript metrics, so zoom does not
// shift them. The only theme-dependent thing the rebuild bought was the
// page-break <hr> border color, which now flows through the --page-break-color
// CSS variable set in editorStyles — so it updates live too, no rebuild needed.

onMounted(() => {
  renderEditor()
})

defineExpose({ syncFromDOM, renderFromDoc, insertHeading, scrollToParagraph, selectLine, navigatePage, navigateHeadingPage, applySearchHighlights: editorApplySearchHighlights, clearSearchHighlights: editorClearSearchHighlights })
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

.editor-sheet :deep(.paragraph.heading-1) {
  font-size: 1.5em;
  font-weight: 700;
  text-align: left;
  text-transform: uppercase;
  margin-top: 2em;
  margin-bottom: 1em;
  text-indent: 0;
}

.editor-sheet :deep(.paragraph.heading-2) {
  font-size: 1.2em;
  font-weight: 600;
  text-align: left;
  text-transform: uppercase;
  margin-top: 1.5em;
  margin-bottom: 0.8em;
  text-indent: 0;
}

.editor-sheet :deep(.paragraph.heading-3) {
  font-size: 1.1em;
  font-weight: 600;
  text-align: left;
  text-transform: uppercase;
  margin-top: 1.2em;
  margin-bottom: 0.6em;
  text-indent: 0;
}

.editor-sheet :deep(.paragraph.heading-4),
.editor-sheet :deep(.paragraph.heading-5),
.editor-sheet :deep(.paragraph.heading-6) {
  font-size: 1em;
  font-weight: 600;
  text-align: left;
  text-transform: uppercase;
  margin-top: 1em;
  margin-bottom: 0.5em;
  text-indent: 0;
}

.editor-sheet :deep(.epigram-block) {
  font-style: italic;
  text-align: center;
  margin-bottom: 1.5em;
  white-space: pre-line;
  opacity: 0.7;
}

/* Page break visuals are rendered via CSS pseudo-elements on the first
   paragraph of each page so there are no interstitial DOM nodes that
   the cursor can land in between. */
.editor-sheet :deep(.paragraph[data-page-start]) {
  position: relative;
  border-top: 1px dashed rgba(128, 128, 128, 0.35);
  margin-top: 1.2em;
  padding-top: 24px;
}

.editor-sheet :deep(.paragraph[data-page-start="1"]) {
  border-top: none;
  margin-top: 0;
  padding-top: 0;
}

.editor-sheet :deep(.paragraph[data-page-start])::before {
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
