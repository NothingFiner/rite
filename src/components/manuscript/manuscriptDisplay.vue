<template>
  <div class="manuscript-viewport" ref="viewportRef">
    <ManuscriptPage
      v-for="page in allPages"
      :key="page.key"
      :header="page.header"
      :body="page.body"
      :page-class="page.pageClass"
    />
  </div>
</template>

<script setup>
import { ref, computed, toRef } from 'vue'
import { paragraphToHTML, sectionTitleToHTML, escapeHtml } from '../../composables/useParagraphHTML.js'
import { usePagination } from '../../composables/usePagination.js'
import { flattenSections, computeFirstLineIndent } from '../../composables/useSectionBlocks.js'
import { useSectionFormat } from '../../composables/useSectionFormat.js'
import { useWordCount } from '../../composables/useWordCount.js'
import { applySearchHighlights, clearSearchHighlights } from '../../composables/useSearchHighlights.js'
import ManuscriptPage from './manuscriptPage.vue'

const props = defineProps({
  modelValue: Object,
  tocItems: { type: Array, default: () => [] },
})

const viewportRef = ref(null)
const docRef = toRef(props, 'modelValue')
const { pageBreaks } = usePagination(docRef)
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

// Debounced whole-document count, shared with the editor status bar so the
// two cannot drift. The debounce is moot in this read-only view (no keystroke
// stream), but the shared implementation is the point. See useWordCount.
const { wordCount } = useWordCount(docRef)

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
// chapter numbers). No Part/Chapter grouping.
function buildTocPage() {
  const tocItems = Array.isArray(props.tocItems) ? props.tocItems : []
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
          { id: b.sectionId, title: b.title, sectionType: b.sectionType },
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
  if (props.modelValue?.hasTOC && Array.isArray(props.tocItems) && props.tocItems.length > 0) {
    pages.push(buildTocPage())
  }
  if (props.modelValue.hasEpigram && props.modelValue.epigramText) {
    pages.push(buildEpigramPage())
  }
  pages.push(...buildContentPages())
  return pages
})

defineExpose({ applySearchHighlights: msApplySearchHighlights, clearSearchHighlights: msClearSearchHighlights })
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