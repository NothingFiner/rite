<template>
  <ManuscriptDisplay v-if="mode === 'manuscript'" ref="msRef" :modelValue="modelValue" :tocItems="tocItems" />
  <EditorDisplay
    v-else
    ref="editorRef"
    :modelValue="modelValue"
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

function scrollToSection(id) {
  editorRef.value?.scrollToSection?.(id)
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
  selectLine,
  navigatePage,
  navigateSectionPage,
  applySearchHighlights,
  clearSearchHighlights,
})
</script>