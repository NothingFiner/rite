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
        <template v-if="history.selectedTimestamp">
          {{ history.diffBlocks ? 'Diff vs current' : 'Preview' }} · {{ formatHistoryTimestamp(history.selectedTimestamp) }}
        </template>
        <template v-else>Version history</template>
      </span>
      <!-- Owns open/close of the version-list left drawer (Scheme A: the Toolbar
           History tab is view-switch-only; this in-header toggle is the single
           control for the list). `versionsOpen` mirrors App.vue's
           `leftDrawerOpen && leftDrawerMode === 'history'` so the button reflects
           the drawer's real state, including after Escape closes it. -->
      <button
        class="history-versions-toggle"
        :class="{ active: versionsOpen }"
        :title="versionsOpen ? 'Hide version list' : 'Show version list'"
        @click="$emit('toggle-versions')"
      >
        <svg width="14" height="14" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="96" y1="64" x2="208" y2="64" />
          <line x1="96" y1="128" x2="208" y2="128" />
          <line x1="96" y1="192" x2="208" y2="192" />
          <circle cx="56" cy="64" r="10" fill="currentColor" stroke="none" />
          <circle cx="56" cy="128" r="10" fill="currentColor" stroke="none" />
          <circle cx="56" cy="192" r="10" fill="currentColor" stroke="none" />
        </svg>
        Versions
      </button>
    </div>

    <div class="history-view-canvas">
      <p v-if="history.error" class="history-view-error">{{ history.error }}</p>

      <div v-if="history.loading" class="history-view-placeholder">Loading…</div>

      <DiffView
        v-else-if="history.diffBlocks"
        :diff-blocks="history.diffBlocks"
      />
      <HistoryPreview
        v-else-if="history.previewDocument"
        :document="history.previewDocument"
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
  // Whether the version-list left drawer is currently open. Drives the
  // Versions toggle's active state + title. Passed from App.vue as
  // `leftDrawerOpen && leftDrawerMode === 'history'`.
  versionsOpen: { type: Boolean, default: false },
})

defineEmits(['back', 'toggle-versions'])
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

/* The Versions toggle sits at the right end of the header (margin-left:auto in
   the flex row). Styled like .history-back so the two header controls read as a
   pair; .active marks the list-open state in the accent color. */
.history-versions-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  margin-left: auto;
  padding: 0 10px;
  border-radius: 5px;
  border: 1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.15));
  background: transparent;
  color: var(--text-secondary, #a0a0b0);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.history-versions-toggle:hover {
  background: var(--hover-bg-strong, rgba(255, 255, 255, 0.1));
  color: var(--text-primary, #f0f0f5);
}

.history-versions-toggle.active {
  background: var(--accent-bg, rgba(79, 142, 247, 0.25));
  color: var(--accent, #4f8ef7);
  border-color: var(--accent, #4f8ef7);
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