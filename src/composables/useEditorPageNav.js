// Editor page-break layout + page navigation, extracted from editorDisplay.vue
// (roadmap 5.6, PR2). Pure DOM operations — no Vue, no reactivity. The editor
// root is passed in as `root` (editorDisplay hands over `sheetRef.value`); the
// page-break index and the section list are passed in as plain arrays, since
// they're the reactive values the orchestrator owns. The cursor helpers
// (getParagraphAtCursor / getSectionTitleAtCursor / placeCursorAtStart) and
// flattenSections are imported — this module doesn't redefine them.
//
// Why pure functions (not a `use*` factory): like useEditorCursor.js, these own
// no state. layoutPageBreaks is fully testable in jsdom (no Selection needed);
// the navigation helpers that read the caret depend on the live Selection and
// are covered by the e2e suite, the agreed split for 5.6.

import { getParagraphAtCursor, getSectionTitleAtCursor, placeCursorAtStart } from './useEditorCursor.js'
import { flattenSections } from './useSectionBlocks.js'

/// Stamp `data-page-start` on the content block that begins each page and
/// append a trailing page-break `<hr>` + click-sentinel. `pageBreaks` is the
/// array of flattened-block indices (from usePagination) that start a new page;
/// `sections` is the doc's section list, flattened here so the walk order matches
/// the pagination index. Idempotent: it clears every prior stamp + decoration
/// before re-applying, so calling it repeatedly (e.g. on every pageBreaks watch
/// tick, or defensively inside scrollToPage) never accumulates stale markers.
export function layoutPageBreaks(root, sections, pageBreaks) {
  if (!root) return

  root.querySelectorAll('.page-break-line').forEach(el => el.remove())
  root.querySelectorAll('.editor-sentinel').forEach(el => el.remove())
  root.querySelectorAll('[data-page-start]').forEach(el => el.removeAttribute('data-page-start'))

  const blocks = flattenSections(sections || [])
  if (blocks.length === 0) return

  const breaks = pageBreaks
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

/// Current page number at the cursor: walk back from the cursor's block to the
/// nearest [data-page-start] marker. (Mid-page blocks have no marker of their
/// own, so reading the cursor block's own data-page-start would wrongly default
/// to 1 — this walk finds the page-start block that owns the current page.)
export function currentPageAtCursor(root) {
  if (!root) return 1
  const current = getParagraphAtCursor() || getSectionTitleAtCursor()
  if (!current) return 1
  let walk = current
  while (walk) {
    if (walk.dataset?.pageStart) return parseInt(walk.dataset.pageStart, 10)
    walk = walk.previousElementSibling
  }
  return 1
}

/// Place the cursor on the first paragraph of the page whose start block is
/// `startEl` (a section-title or paragraph). If the page starts with a
/// section-title, drop into the first paragraph after it.
///
/// `behavior` defaults to 'smooth' for in-view page navigation (adjacent pages,
/// a short pleasant glide). View-switch restoration passes 'auto' (instant): a
/// switch can jump many pages, and a smooth glide there would briefly flash the
/// wrong page (the scroll-layer keeps its old pixel scrollTop until the glide
/// finishes) before settling — instant jumps straight to the target page.
export function focusPageStart(startEl, behavior = 'smooth') {
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

/// Step the cursor to the start of the page `direction` pages away from the
/// caret's current page. No-op past the first page or when the target page has
/// no stamped start block.
export function navigatePage(root, direction) {
  if (!root) return
  const currentPage = currentPageAtCursor(root)
  const targetPage = currentPage + direction
  if (targetPage < 1) return
  const startEl = root.querySelector(`[data-page-start="${targetPage}"]`)
  if (!startEl) return
  focusPageStart(startEl)
}

/// Absolute scroll-to-page for view switching (5.1b): place the cursor + scroll
/// to the start of page `n`, reusing the same focusPageStart navigatePage uses.
/// Unlike navigatePage this takes an absolute page number (captured from the
/// outgoing view) rather than a relative step. Instant ('auto') behavior — see
/// focusPageStart — so the switch doesn't glide through intermediate pages.
///
/// CRITICAL: on a manuscript→editor switch the editor mounts FRESH. Its
/// data-page-start stamps are applied by layoutPageBreaks, which renderEditor
/// defers to a nextTick. But the caller queues this scrollToPage the instant
/// viewMode flips — BEFORE the editor's deferred layoutPageBreaks runs — so the
/// stamps can be absent when we arrive, the querySelector finds nothing, and
/// we'd silently no-op, leaving the editor at the manuscript's old pixel
/// scrollTop (which in the editor's denser layout is a DIFFERENT page).
/// layoutPageBreaks is synchronous and idempotent (clears + re-stamps from the
/// already-populated pageBreaks, and renderEditor has already built the content
/// DOM by onMounted), so calling it here guarantees the stamps exist before we
/// query. `sections` + `pageBreaks` are passed through so the defensive stamp
/// doesn't need to reach back into reactive state.
export function scrollToPage(root, n, sections, pageBreaks) {
  if (!root) return
  layoutPageBreaks(root, sections, pageBreaks)
  const targetPage = Math.max(1, n)
  const startEl = root.querySelector(`[data-page-start="${targetPage}"]`)
  if (startEl) focusPageStart(startEl, 'auto')
}

/// The page currently at the TOP of the visible area — the editor's screen-based
/// notion of "current page" for view switching. We read the VISIBLE page, not
/// the caret's page: if the writer scrolled with the scrollbar without clicking,
/// the caret is stale (still wherever they last clicked), so currentPageAtCursor
/// would report a page they're not looking at. Walks the [data-page-start]
/// markers in DOM order and picks the highest one at or above the scroll-layer's
/// visible top (its top + ~40px padding).
export function currentPageAtTop(root) {
  if (!root) return 1
  const layer = root.closest('.scroll-layer')
  const targetY = layer ? layer.getBoundingClientRect().top + 40 : 40
  const starts = root.querySelectorAll('[data-page-start]')
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

/// The page number at the caret — used when switching FROM the editor to another
/// view so the incoming view can land on the same page. Screen-based (see
/// currentPageAtTop); page numbers agree across views because pagination is
/// shared.
export function getCurrentPage(root) {
  return currentPageAtTop(root)
}

/// Jump the cursor to the first paragraph of the next/previous page that begins
/// with a section-title (the section-aware page jump).
export function navigateSectionPage(root, direction) {
  if (!root) return
  const currentPage = currentPageAtCursor(root)
  const sectionTitles = Array.from(root.querySelectorAll('.section-title[data-page-start]'))
  const sectionPages = sectionTitles.map(el => parseInt(el.dataset.pageStart, 10))
  let targetPage
  if (direction > 0) {
    targetPage = sectionPages.find(p => p > currentPage)
  } else {
    targetPage = [...sectionPages].reverse().find(p => p < currentPage)
  }
  if (!targetPage) return
  const startEl = root.querySelector(`.section-title[data-page-start="${targetPage}"]`)
  if (!startEl) return
  focusPageStart(startEl)
}