<template>
  <div class="manuscript-viewport" ref="viewportRef">
    <ManuscriptPage
      v-for="page in allPages"
      :key="page.key"
      :data-page-key="page.key"
      :header="page.header"
      :body="page.body"
      :page-class="page.pageClass"
    />
  </div>
</template>

<script setup>
import { ref, computed, toRef } from 'vue'
import { paragraphToHTML, sectionTitleToHTML, escapeHtml } from '../../composables/useParagraphHTML.js'
import { flattenSections, computeFirstLineIndent } from '../../composables/useSectionBlocks.js'
import { useSectionFormat } from '../../composables/useSectionFormat.js'
import { applySearchHighlights, clearSearchHighlights } from '../../composables/useSearchHighlights.js'
import { contentPageNumberFromKey, contentKeyForPage } from '../../composables/manuscriptPageMap.js'
import ManuscriptPage from './manuscriptPage.vue'

const props = defineProps({
  modelValue: Object,
  // Page breaks from the SINGLE shared `usePagination` instance owned by
  // App.vue (roadmap 2.5), passed through DocumentRenderer — not a per-view
  // instance. Same contract: array of flattened block indices starting a page.
  pageBreaks: { type: Array, default: () => [] },
  // Word count from the SINGLE shared `useWordCount` instance owned by App.vue
  // (same lift-to-App pattern as pagination). Previously this view spun up its
  // OWN instance whose debounced watcher started at 0 and populated ~300ms
  // after mount — so the title page blinked "0 words" → real count on every
  // view switch. Reading the already-warm shared count kills the blink.
  wordCount: { type: Number, default: 0 },
  tocItems: { type: Array, default: () => [] },
})

const viewportRef = ref(null)
const pageBreaks = toRef(props, 'pageBreaks')
const wordCount = toRef(props, 'wordCount')
const sectionFormat = useSectionFormat()

function msApplySearchHighlights(matches, currentIndex) {
  applySearchHighlights(viewportRef.value, matches, currentIndex)
}

function msClearSearchHighlights() {
  clearSearchHighlights(viewportRef.value)
}

const title = computed(() => (props.modelValue.title || '').toUpperCase())
const author = computed(() => props.modelValue.author || 'Author Name')
const authorContact = computed(() => props.modelValue.authorContact || '')

function getSurname(authorName) {
  const parts = (authorName || '').trim().split(/\s+/)
  return parts[parts.length - 1] || 'Author'
}

function abbreviateTitle(titleStr) {
  const words = (titleStr || '').trim().toUpperCase().split(/\s+/)
  if (words.length <= 3) return words.join(' ')
  return words.slice(0, 3).join(' ') + '...'
}

function buildTitlePage() {
  const body = `
    <div class="contact-block">
      <div class="contact-left">${escapeHtml(authorContact.value)}</div>
      <div class="contact-right">${wordCount.value} words</div>
    </div>
    <div class="title-center">
      <h1 class="ms-title">${escapeHtml(title.value)}</h1>
      <p class="ms-byline">by ${escapeHtml(author.value)}</p>
    </div>
  `
  return { key: 'title', header: '', body, pageClass: 'title-page' }
}

// Flat TOC: one line per section (the nav already derives display titles with
// chapter numbers). No Part/Chapter grouping. HIDDEN sections are excluded —
// the printed manuscript TOC is the one place hidden sections do not appear
// (the nav drawer still lists them; that's the only way to reach one).
function buildTocPage() {
  const tocItems = (Array.isArray(props.tocItems) ? props.tocItems : []).filter(item => !item.hidden)
  const items = tocItems.map(item => `
    <li class="toc-ms-item">
      <span class="toc-ms-title">${escapeHtml(item.displayTitle)}</span>
      <span class="toc-ms-dots"></span>
      <span class="toc-ms-page">${item.page}</span>
    </li>
  `).join('')
  const body = `
    <h2 class="toc-heading">Contents</h2>
    <ul class="toc-ms-list">${items}</ul>
  `
  return { key: 'toc', header: '', body, pageClass: 'toc-page' }
}

function buildEpigramPage() {
  const body = `<div class="epigram-body">${escapeHtml(props.modelValue.epigramText || '')}</div>`
  return { key: 'epigram', header: '', body, pageClass: 'epigram-page' }
}

// Content pages are sliced from the flattened block sequence (section-titles +
// paragraphs) at the block-index page breaks from usePagination. Section-title
// blocks render as styled ms-para headings; paragraph blocks render as body
// paragraphs with the shared section-aware first-line indent rule.
function buildContentPages() {
  const sections = props.modelValue?.sections || []
  if (sections.length === 0) return []

  const blocks = flattenSections(sections).map(b => {
    if (b.kind === 'paragraph') return { ...b, paragraph: { ...b.paragraph } }
    return b
  })
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind !== 'paragraph') continue
    blocks[i].paragraph.firstLineIndent = computeFirstLineIndent(blocks, i)
  }

  const breaks = pageBreaks.value
  const pages = []
  let batch = []
  for (let i = 0; i < blocks.length; i++) {
    if (breaks.includes(i) && batch.length > 0) {
      pages.push(batch)
      batch = []
    }
    batch.push(blocks[i])
  }
  if (batch.length > 0) pages.push(batch)

  const surname = getSurname(props.modelValue.author)
  const abbrevTitle = abbreviateTitle(props.modelValue.title)
  // Chapter index is global across all pages (chapter 3 stays chapter 3), so it
  // lives in the closure and increments as we render each page in order.
  let chapterIndex = 0

  return pages.map((batch, i) => {
    const body = batch.map(b => {
      if (b.kind === 'section-title') {
        const idx = b.sectionType === 'chapter' ? ++chapterIndex : null
        const chapterPrefix = idx != null ? sectionFormat.formatChapter(idx) : ''
        return sectionTitleToHTML(
          { id: b.sectionId, title: b.title, sectionType: b.sectionType, hidden: b.hidden },
          idx,
          chapterPrefix,
          { manuscript: true }
        )
      }
      return paragraphToHTML(b.paragraph, { manuscript: true })
    }).join('')

    return {
      key: `content-${i}`,
      header: `${surname} / ${abbrevTitle} / ${i + 1}`,
      body,
      pageClass: '',
    }
  })
}

const allPages = computed(() => {
  const pages = [buildTitlePage()]
  if (props.modelValue?.hasTOC && Array.isArray(props.tocItems) && props.tocItems.some(i => !i.hidden)) {
    pages.push(buildTocPage())
  }
  if (props.modelValue.hasEpigram && props.modelValue.epigramText) {
    pages.push(buildEpigramPage())
  }
  pages.push(...buildContentPages())
  return pages
})

// --- View-aware scrolling (5.1 / 5.1b) ---------------------------------------
// The manuscript renders front matter (title / TOC / epigram) BEFORE the
// numbered content pages. Content page N (the pagination page number shared
// with the editor) is the ManuscriptPage whose data-page-key is `content-N-1`
// (buildContentPages keys them `content-${i}` with a 0-based i, header i+1).
// Front matter has no content-page number; when the viewport is on front
// matter, the current page is reported as 1 (the first content page), so a
// switch to the editor lands on editor page 1. Symmetrically, editor page 1
// lands on `content-0` (skipping the title/TOC/epigram), since the editor has
// no front matter.

// The scroll container is App.vue's `.scroll-layer` (the viewport itself
// doesn't scroll — it's taller than the layer and the layer scrolls). Find it
// via closest() so this component doesn't need a ref to it passed down.
function scrollLayerEl() {
  return viewportRef.value?.closest('.scroll-layer') || null
}

// Which content page is currently at the top of the visible area. Walks the
// content ManuscriptPage elements in DOM order and picks the highest one whose
// top is at or above the visible top line (the scroll-layer top + its 38px
// padding). Returns 1 when on front matter (or when nothing is found).
function getCurrentContentPage() {
  const viewport = viewportRef.value
  if (!viewport) return 1
  const layer = scrollLayerEl()
  // Without the scroll-layer, fall back to the browser viewport top.
  const targetY = layer ? layer.getBoundingClientRect().top + 40 : 40
  const contentPages = viewport.querySelectorAll('.manuscript-page[data-page-key^="content-"]')
  let current = 1
  for (const page of contentPages) {
    if (page.getBoundingClientRect().top <= targetY) {
      const pageNumber = contentPageNumberFromKey(page.getAttribute('data-page-key'))
      // contentPageNumberFromKey returns null only for front-matter keys, which
      // the querySelector filter already excluded — but guard anyway so a bad
      // attribute can't silently keep `current` stale.
      if (pageNumber != null) current = pageNumber
    } else {
      break // DOM order === page order; nothing further can be at/above the line
    }
  }
  return current
}

// Scroll a content page into view. `n` is the shared pagination page number
// (1-based), mapped to the `content-N-1` ManuscriptPage via the pure helper.
// Instant ('auto') behavior: this is called on a view switch, where a smooth
// glide would briefly show the wrong page (the scroll-layer keeps its old
// editor pixel scrollTop until the glide ends) before settling on the target.
function scrollToContentPage(n) {
  const viewport = viewportRef.value
  if (!viewport) return
  const key = contentKeyForPage(n)
  const page = viewport.querySelector(`[data-page-key="${key}"]`)
  if (page) page.scrollIntoView({ behavior: 'auto', block: 'start' })
}

// Scroll a section into view (used when a nav item is clicked while in the
// manuscript view — 5.1, stay in the current view). Section-title elements
// carry data-section-id in the rendered manuscript HTML.
function msScrollToSection(id) {
  const viewport = viewportRef.value
  if (!viewport) return
  const el = viewport.querySelector(`[data-section-id="${id}"]`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// Uniform interface with the editor so DocumentRenderer can route to whichever
// view is active without knowing which is which.
function getCurrentPage() {
  return getCurrentContentPage()
}
function scrollToPage(n) {
  scrollToContentPage(n)
}

defineExpose({
  applySearchHighlights: msApplySearchHighlights,
  clearSearchHighlights: msClearSearchHighlights,
  scrollToSection: msScrollToSection,
  scrollToPage,
  getCurrentPage,
})
</script>

<style scoped>
.manuscript-viewport {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 20px 0 40px;
  min-height: 100%;
}
</style>