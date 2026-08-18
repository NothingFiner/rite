<template>
  <div class="manuscript-page" :class="pageClass">
    <div v-if="header" class="page-header">{{ header }}</div>
    <div class="page-body" v-html="body"></div>
  </div>
</template>

<script setup>
defineProps({
  header: { type: String, default: '' },
  body: { type: String, default: '' },
  pageClass: { type: String, default: '' },
})
</script>

<style scoped>
.manuscript-page {
  width: 720px;
  height: 960px;
  background: #FFFFE3;
  box-sizing: border-box;
  padding: 96px;
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
  top: 48px;
  right: 96px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  color: #1a1a1a;
  text-align: right;
}

.page-body {
  height: 100%;
  overflow: hidden;
}

.page-body :deep(.ms-para) {
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  line-height: 24px;
  margin: 0;
  text-align: left;
  text-indent: 48px;
  color: #1a1a1a;
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
  font-size: 14px;
  margin-top: 24px;
}

.page-body :deep(.ms-para.heading-2) {
  text-indent: 0;
  text-align: center;
  text-transform: uppercase;
  font-weight: 600;
  font-size: 12px;
  margin-top: 24px;
}

.page-body :deep(.ms-para.no-indent) {
  text-indent: 0;
}

/* Title page */
.manuscript-page.title-page :deep(.contact-block) {
  display: flex;
  justify-content: space-between;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  line-height: 1.4;
  color: #1a1a1a;
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
  font-family: 'Courier New', Courier, monospace;
  color: #1a1a1a;
}

.page-body :deep(.ms-title) {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 24px;
  color: #1a1a1a;
}

.page-body :deep(.ms-byline) {
  font-size: 12px;
  margin: 0;
  color: #1a1a1a;
}

/* TOC page */
.manuscript-page.toc-page {
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  color: #1a1a1a;
  padding-top: 96px;
}

.page-body :deep(.toc-heading) {
  text-align: center;
  text-transform: uppercase;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.5px;
  margin-bottom: 48px;
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
  border-bottom: 1px dotted #1a1a1a;
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
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  line-height: 24px;
  text-align: center;
  white-space: pre-line;
  font-style: italic;
  color: #1a1a1a;
  max-width: 400px;
}
</style>
