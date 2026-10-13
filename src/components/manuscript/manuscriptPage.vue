<template>
  <div class="manuscript-page" :class="pageClass" :style="pageStyle">
    <div v-if="header" class="page-header">{{ header }}</div>
    <div class="page-body" v-html="body"></div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useManuscriptFormat } from '../../composables/useManuscriptFormat.js'

defineProps({
  header: { type: String, default: '' },
  body: { type: String, default: '' },
  pageClass: { type: String, default: '' },
})

// The page geometry, body font, paper color, and first-line indent all come from
// the SINGLE shared manuscript format (useManuscriptFormat) — the same preset
// usePagination measures against, so a visible page and a computed page break
// can't disagree about page size. They're pushed onto the root element as CSS
// custom properties (--ms-*) via :style, then consumed by the rules below.
// Custom properties INHERIT, so the :deep() rules targeting the v-html body
// content (.ms-para etc.) read the same values without each paragraph needing
// its own binding. Switching the format updates the reactive computed → the
// :style object → the inherited custom properties → every page re-renders at
// the new size live, and usePagination's watch re-measures in parallel.
const { format } = useManuscriptFormat()

const pageStyle = computed(() => {
  const f = format.value
  return {
    width: `${f.pageWidth}px`,
    height: `${f.pageHeight}px`,
    background: f.pageBackground,
    padding: `${f.margin}px`,
    '--ms-font-family': f.fontFamily,
    '--ms-font-size': `${f.fontSize}px`,
    '--ms-line-height': `${f.lineHeight}px`,
    '--ms-text-indent': `${f.textIndent}px`,
    '--ms-text-color': f.textColor,
    '--ms-margin': `${f.margin}px`,
  }
})
</script>

<style scoped>
.manuscript-page {
  /* width / height / background / padding come from the :style custom
     properties above; only the structural presentation lives here. */
  box-sizing: border-box;
  position: relative;
  overflow: hidden;
  box-shadow:
    0 1px 1px rgba(0,0,0,0.12),
    0 2px 2px rgba(0,0,0,0.12),
    0 4px 4px rgba(0,0,0,0.12),
    0 8px 8px rgba(0,0,0,0.12);
  border: 1px solid rgba(0,0,0,0.06);
  flex-shrink: 0;
}

.page-header {
  position: absolute;
  /* header sits at half the page margin from the top, right-aligned to the
     margin — the conventional manuscript running header position. */
  top: calc(var(--ms-margin) / 2);
  right: var(--ms-margin);
  font-family: var(--ms-font-family);
  font-size: var(--ms-font-size);
  color: var(--ms-text-color);
  text-align: right;
}

.page-body {
  height: 100%;
  overflow: hidden;
}

.page-body :deep(.ms-para) {
  font-family: var(--ms-font-family);
  font-size: var(--ms-font-size);
  line-height: var(--ms-line-height);
  margin: 0;
  text-align: left;
  text-indent: var(--ms-text-indent);
  color: var(--ms-text-color);
}

.page-body :deep(.ms-para.scene-break) {
  text-indent: 0;
  text-align: center;
}

.page-body :deep(.ms-para.heading-1) {
  text-indent: 0;
  text-align: center;
  text-transform: uppercase;
  font-weight: 700;
  /* section headings render one step larger than body; chapter headings match
     body. Both keep a one-line gap above. */
  font-size: calc(var(--ms-font-size) + 2px);
  margin-top: var(--ms-line-height);
}

.page-body :deep(.ms-para.heading-2) {
  text-indent: 0;
  text-align: center;
  text-transform: uppercase;
  font-weight: 600;
  font-size: var(--ms-font-size);
  margin-top: var(--ms-line-height);
}

.page-body :deep(.ms-para.no-indent) {
  text-indent: 0;
}

/* Hidden section (5.10): the pagination measurer needs the empty
   `.ms-para.section-hidden` element present to keep block indices aligned,
   but the visible page shows nothing for it — no heading text, no gap. The
   section's own-page rule comes from the pagination section loop, which is
   unaffected by this display:none. */
.page-body :deep(.ms-para.section-hidden) {
  display: none;
}

/* Title page */
.manuscript-page.title-page :deep(.contact-block) {
  display: flex;
  justify-content: space-between;
  font-family: var(--ms-font-family);
  font-size: var(--ms-font-size);
  line-height: 1.4;
  color: var(--ms-text-color);
}

.manuscript-page.title-page :deep(.contact-left) {
  white-space: pre-line;
}

.manuscript-page.title-page :deep(.contact-right) {
  text-align: right;
}

.manuscript-page.title-page :deep(.title-center) {
  margin-top: 220px;
  text-align: center;
  font-family: var(--ms-font-family);
  color: var(--ms-text-color);
}

.page-body :deep(.ms-title) {
  font-size: var(--ms-font-size);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: var(--ms-line-height);
  color: var(--ms-text-color);
}

.page-body :deep(.ms-byline) {
  font-size: var(--ms-font-size);
  margin: 0;
  color: var(--ms-text-color);
}

/* TOC page */
.manuscript-page.toc-page {
  font-family: var(--ms-font-family);
  font-size: var(--ms-font-size);
  color: var(--ms-text-color);
  padding-top: var(--ms-margin);
}

.page-body :deep(.toc-heading) {
  text-align: center;
  text-transform: uppercase;
  font-size: var(--ms-font-size);
  font-weight: 700;
  letter-spacing: 0.5px;
  margin-bottom: calc(var(--ms-line-height) * 2);
}

.page-body :deep(.toc-ms-list) {
  list-style: none;
  padding: 0;
  margin: 0;
}

.page-body :deep(.toc-ms-item) {
  display: flex;
  align-items: baseline;
  margin-bottom: 8px;
}

.page-body :deep(.toc-ms-item.heading-1) {
  font-weight: 700;
  text-transform: uppercase;
}

.page-body :deep(.toc-ms-item.heading-2) {
  padding-left: 24px;
}

.page-body :deep(.toc-ms-title) {
  white-space: nowrap;
}

.page-body :deep(.toc-ms-dots) {
  flex: 1;
  border-bottom: 1px dotted var(--ms-text-color);
  margin: 0 8px;
  opacity: 0.4;
  height: 1px;
}

.page-body :deep(.toc-ms-page) {
  white-space: nowrap;
}

/* Epigram page */
.manuscript-page.epigram-page {
  display: flex;
  align-items: center;
  justify-content: center;
}

.page-body :deep(.epigram-body) {
  font-family: var(--ms-font-family);
  font-size: var(--ms-font-size);
  line-height: var(--ms-line-height);
  text-align: center;
  white-space: pre-line;
  font-style: italic;
  color: var(--ms-text-color);
  max-width: 400px;
}
</style>