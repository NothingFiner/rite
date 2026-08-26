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
import { ref, computed, watch, toRef } from 'vue'
import { paragraphToHTML, escapeHtml } from '../../composables/useParagraphHTML.js'
import { usePagination } from '../../composables/usePagination.js'
import { applySearchHighlights, clearSearchHighlights } from '../../composables/useSearchHighlights.js'
import { isHeading } from '../../constants/ParagraphStyle.js'
import ManuscriptPage from './manuscriptPage.vue'

const props = defineProps({
  modelValue: Object,
  tocItems: { type: Array, default: () => [] },
})

const viewportRef = ref(null)
const docRef = toRef(props, 'modelValue')
const { pageBreaks } = usePagination(docRef)

function msApplySearchHighlights(matches, currentIndex) {
  applySearchHighlights(viewportRef.value, matches, currentIndex)
}

function msClearSearchHighlights() {
  clearSearchHighlights(viewportRef.value)
}

const title = computed(() => (props.modelValue.title || '').toUpperCase())
const author = computed(() => props.modelValue.author || 'Author Name')
const authorContact = computed(() => props.modelValue.authorContact || '')

const wordCount = computed(() => {
  let count = 0
  for (const p of props.modelValue?.body?.content || []) {
    for (const el of p.elements) {
      const text = el.textRun.content || ''
      if (text.trim()) count += text.trim().split(/\s+/).length
    }
  }
  return count
})

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

function buildTocPage() {
  const groups = []
  let currentGroup = null
  const tocItems = Array.isArray(props.tocItems) ? props.tocItems : []

  for (const item of tocItems) {
    const level = item.level || 1
    if (level === 1) {
      currentGroup = { section: item, chapters: [] }
      groups.push(currentGroup)
    } else if (level === 2 && currentGroup) {
      currentGroup.chapters.push(item)
    } else if (level === 2 && !currentGroup) {
      currentGroup = { section: { title: 'Untitled Section', page: item.page }, chapters: [item] }
      groups.push(currentGroup)
    }
  }

  const renderGroup = (group) => {
    const sectionHtml = `
      <li class="toc-ms-item heading-1">
        <span class="toc-ms-title">${escapeHtml(group.section.title)}</span>
        <span class="toc-ms-dots"></span>
        <span class="toc-ms-page">${group.section.page}</span>
      </li>
    `
    const chaptersHtml = group.chapters.map(ch => `
      <li class="toc-ms-item heading-2">
        <span class="toc-ms-title">${escapeHtml(ch.title)}</span>
        <span class="toc-ms-dots"></span>
        <span class="toc-ms-page">${ch.page}</span>
      </li>
    `).join('')
    return sectionHtml + chaptersHtml
  }

  const items = groups.map(renderGroup).join('')
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

function buildContentPages() {
  const paragraphs = props.modelValue?.body?.content || []
  if (paragraphs.length === 0) return []

  const breaks = pageBreaks.value
  const pages = []
  let currentBatch = []

  for (let i = 0; i < paragraphs.length; i++) {
    if (breaks.includes(i) && currentBatch.length > 0) {
      pages.push(currentBatch)
      currentBatch = []
    }
    currentBatch.push(paragraphs[i])
  }
  if (currentBatch.length > 0) pages.push(currentBatch)

  const surname = getSurname(props.modelValue.author)
  const abbrevTitle = abbreviateTitle(props.modelValue.title)

  return pages.map((batch, i) => {
    const body = batch.map((p, j) => {
      // First paragraph on a new page should keep its indent even if it
      // follows a heading or empty paragraph on the previous page.
      if (j === 0 && i > 0 && !isHeading(p.paragraphStyle)) {
        return paragraphToHTML({ ...p, firstLineIndent: 0.5 }, { manuscript: true })
      }
      return paragraphToHTML(p, { manuscript: true })
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
