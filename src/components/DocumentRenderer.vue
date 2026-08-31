<template>
  <ManuscriptDisplay v-if="mode === 'manuscript'" ref="msRef" :modelValue="modelValue" :pageBreaks="pageBreaks" :wordCount="wordCount" :tocItems="tocItems" />
  <EditorDisplay
    v-else
    ref="editorRef"
    :modelValue="modelValue"
    :pageBreaks="pageBreaks"
    :theme="theme"
    :zoom="zoom"
    :margin="margin"
    @sync-sections="$emit('syncSections', $event)"
    @delete-section="$emit('deleteSection', $event)"
    @update="$emit('update')"
  />
</template>

<script setup>
import { ref } from 'vue'
import ManuscriptDisplay from './manuscript/manuscriptDisplay.vue'
import EditorDisplay from './editor/editorDisplay.vue'

const props = defineProps({
  modelValue: Object,
  mode: { type: String, default: 'editor' },
  // Shared pagination + word count owned by App.vue (roadmap 2.5 + the word-
  // count consolidation). Forwarded to the active view so neither view spins
  // up its own instance/cold cache.
  pageBreaks: { type: Array, default: () => [] },
  wordCount: { type: Number, default: 0 },
  theme: { type: Number, default: 0 },
  zoom: { type: Number, default: 16 },
  margin: { type: String, default: 'compact' },
  tocItems: { type: Array, default: () => [] },
})

defineEmits(['syncSections', 'update', 'deleteSection'])

const editorRef = ref(null)
const msRef = ref(null)

function activeRef() {
  return props.mode === 'manuscript' ? msRef.value : editorRef.value
}

function syncFromDOM() {
  editorRef.value?.syncFromDOM()
}

function renderFromDoc() {
  editorRef.value?.renderFromDoc()
}

function insertSection(...args) {
  editorRef.value?.insertSection?.(...args)
}

function scrollToParagraph(id) {
  editorRef.value?.scrollToParagraph?.(id)
}

// Route to whichever view is active (editor or manuscript) — 5.1 made nav
// view-aware, so a chapter click in the manuscript stays in the manuscript.
function scrollToSection(id) {
  activeRef()?.scrollToSection?.(id)
}

// View-aware page preservation on switch (5.1b). The outgoing view reports the
// page it's currently showing; the incoming view scrolls to the SAME page
// number. Because pagination is a single shared instance (Fix 1, roadmap 2.5),
// the same number maps to the same content in both views, so the switch no
// longer drifts by preserving pixels (a dense editor and a paginated
// manuscript disagree about how far a pixel travels).
function getCurrentPage() {
  return activeRef()?.getCurrentPage?.() ?? 1
}

function scrollToPage(n) {
  activeRef()?.scrollToPage?.(n)
}

function selectLine() {
  editorRef.value?.selectLine?.()
}

function navigatePage(direction) {
  editorRef.value?.navigatePage?.(direction)
}

function navigateSectionPage(direction) {
  editorRef.value?.navigateSectionPage?.(direction)
}

function applySearchHighlights(matches, currentIndex) {
  activeRef()?.applySearchHighlights?.(matches, currentIndex)
}

function clearSearchHighlights() {
  activeRef()?.clearSearchHighlights?.()
}

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
  applySearchHighlights,
  clearSearchHighlights,
})
</script>