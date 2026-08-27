<template>
  <ManuscriptDisplay v-if="mode === 'manuscript'" ref="msRef" :modelValue="modelValue" :tocItems="tocItems" />
  <EditorDisplay v-else ref="editorRef" :modelValue="modelValue" :theme="theme" :zoom="zoom" :margin="margin" @sync-body="$emit('syncBody', $event)" @update="$emit('update')" />
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
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

defineEmits(['syncBody', 'update'])

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

function insertHeading(...args) {
  editorRef.value?.insertHeading?.(...args)
}

function scrollToParagraph(id) {
  editorRef.value?.scrollToParagraph?.(id)
}

function selectLine() {
  editorRef.value?.selectLine?.()
}

function navigatePage(direction) {
  editorRef.value?.navigatePage?.(direction)
}

function navigateHeadingPage(direction) {
  editorRef.value?.navigateHeadingPage?.(direction)
}

function applySearchHighlights(matches, currentIndex) {
  activeRef()?.applySearchHighlights?.(matches, currentIndex)
}

function clearSearchHighlights() {
  activeRef()?.clearSearchHighlights?.()
}

// Mode-switch rendering is handled by each component's onMounted.
// ManuscriptDisplay re-renders automatically via computed props.
// EditorDisplay calls renderEditor() in its onMounted hook.

defineExpose({ syncFromDOM, renderFromDoc, insertHeading, scrollToParagraph, selectLine, navigatePage, navigateHeadingPage, applySearchHighlights, clearSearchHighlights })
</script>
