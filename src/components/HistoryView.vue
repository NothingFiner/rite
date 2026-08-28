<template>
  <!--
    The full-area History view (viewMode === 'history'), selected from the
    Toolbar like Editor/Manuscript. The version *list* lives in the
    HistoryListDrawer (a left drawer that auto-opens with this view); this
    component is the canvas to its right. It shows one of:
      • an empty prompt when no version is selected,
      • a read-only HistoryPreview of the selected version,
      • a side-by-side DiffView of the selected version against the current doc.
    A header bar carries the selected version's timestamp and a Back-to-editor
    control (emitted to App.vue, which switches viewMode back).
  -->
  <div class="history-view">
    <div class="history-view-header">
      <button class="history-back" @click="$emit('back')">
        <svg width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M228 128a8 8 0 0 1-8 8H44l68 68a8 8 0 0 1-11.3 11.3l-80-80a8 8 0 0 1 0-11.3l80-80A8 8 0 0 1 112 44L44 112h176a8 8 0 0 1 8 8Z" />
        </svg>
        Back to editor
      </button>
      <span class="history-view-title">
        <template v-if="history.selectedTimestamp.value">
          {{ history.diffBlocks.value ? 'Diff vs current' : 'Preview' }} · {{ formatHistoryTimestamp(history.selectedTimestamp.value) }}
        </template>
        <template v-else>Version history</template>
      </span>
    </div>

    <div class="history-view-canvas">
      <p v-if="history.error.value" class="history-view-error">{{ history.error.value }}</p>

      <div v-if="history.loading.value" class="history-view-placeholder">Loading…</div>

      <DiffView
        v-else-if="history.diffBlocks.value"
        :diff-blocks="history.diffBlocks.value"
      />
      <HistoryPreview
        v-else-if="history.previewDocument.value"
        :document="history.previewDocument.value"
      />
      <div v-else class="history-view-placeholder">
        Select a version from the list to preview it, or choose “Diff vs current”
        to compare it against your live document.
      </div>
    </div>
  </div>
</template>

<script setup>
import HistoryPreview from './HistoryPreview.vue'
import DiffView from './DiffView.vue'
import { formatHistoryTimestamp } from '../composables/useVersionHistory.js'

defineProps({
  // The reactive useVersionHistory instance from App.vue.
  history: { type: Object, required: true },
})

defineEmits(['back'])
</script>

<style scoped>
.history-view {
  /* Flows inside the App scroll-layer (the single page-scroll container, same
     model as editor/manuscript). No fixed height / internal scroll — the page
     scrolls. */
  min-height: 100%;
}

.history-view-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.1));
  background: var(--glass-bg, rgba(20, 20, 25, 0.5));
}

.history-back {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 5px;
  border: 1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.15));
  background: transparent;
  color: var(--text-secondary, #a0a0b0);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.history-back:hover {
  background: var(--hover-bg-strong, rgba(255, 255, 255, 0.1));
  color: var(--text-primary, #f0f0f5);
}

.history-view-title {
  font-size: 13px;
  color: var(--text-secondary, #a0a0b0);
  font-variant-numeric: tabular-nums;
}

.history-view-canvas {
  display: flex;
  flex-direction: column;
}

.history-view-placeholder {
  margin: 0 auto;
  padding: 64px 32px;
  max-width: 420px;
  text-align: center;
  font-size: 14px;
  color: var(--text-secondary, #a0a0b0);
  opacity: 0.7;
  line-height: 1.6;
}

.history-view-error {
  margin: 16px auto;
  padding: 12px 16px;
  max-width: 520px;
  font-size: 13px;
  color: rgba(248, 81, 73, 0.9);
  background: rgba(248, 81, 73, 0.08);
  border-radius: 6px;
}
</style>