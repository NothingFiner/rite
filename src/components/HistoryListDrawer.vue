<template>
  <!--
    The version list for the History view, housed in the standard left drawer.
    The History *view* itself (preview / diff canvas) is a full-area viewMode
    selected from the Toolbar; this drawer is its list rail. Selecting a version
    reconstructs it for the read-only preview canvas; "Diff vs current" loads
    the side-by-side diff into the canvas; "Restore" makes the reconstructed
    version the live document (undoable via Cmd+Z). The drawer follows the
    NavigationDrawer precedent and owns its own scoped copy of the `.drawer`
    base styles.
  -->
  <div class="drawer left" :class="{ open: open }">
    <div class="drawer-content">
      <div class="drawer-section">
        <h3 class="drawer-heading">History</h3>

        <p v-if="history.error" class="history-error">{{ history.error }}</p>

        <ul class="history-list" v-if="hasLastPath">
          <li
            v-for="entry in history.entries"
            :key="entry.timestamp"
            class="history-row"
            :class="{ active: history.selectedTimestamp === entry.timestamp }"
            @click="onSelect(entry.timestamp)"
          >
            <span class="history-kind" :class="entry.kind" :title="entry.kind === 'snapshot' ? 'Snapshot (full save)' : 'Delta (autosave)'">
              {{ entry.kind === 'snapshot' ? 'S' : 'Δ' }}
            </span>
            <span class="history-label">{{ formatHistoryTimestamp(entry.timestamp) }}</span>
          </li>
          <li v-if="history.entries.length === 0 && !history.loading" class="history-empty">
            No history yet — save or autosave will record versions.
          </li>
          <li v-if="history.loading && history.entries.length === 0" class="history-empty">
            Loading…
          </li>
        </ul>

        <div v-else class="drawer-empty">
          <p>Save the document to start its version history.</p>
        </div>
      </div>

      <div class="drawer-footer" v-if="history.selectedTimestamp && hasLastPath">
        <button
          class="history-action"
          :disabled="history.loading"
          @click="onRestore"
        >
          Restore this version
        </button>
        <button
          class="history-action secondary"
          :disabled="history.loading"
          @click="onDiff"
        >
          {{ history.diffBlocks ? 'Back to preview' : 'Diff vs current' }}
        </button>
        <p class="history-restore-hint">
          Restoring is non-destructive: the file on disk is untouched until you
          save, and Cmd+Z reverts the restore.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ask } from '@tauri-apps/api/dialog'
import { formatHistoryTimestamp } from '../composables/useVersionHistory.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  // The reactive useVersionHistory instance from App.vue.
  history: { type: Object, required: true },
  // Whether the open document has been saved at least once (has a sidecar
  // location). When false, the list is replaced with a "save first" prompt.
  hasLastPath: { type: Boolean, default: false },
})

function onSelect(timestamp) {
  // If a diff is open for this same version, just drop the diff back to preview
  // instead of re-reconstructing. Otherwise load the preview for the newly
  // selected version.
  if (props.history.diffBlocks && props.history.selectedTimestamp === timestamp) {
    props.history.clearDiff()
    return
  }
  props.history.selectVersion(timestamp)
}

async function onRestore() {
  const ts = props.history.selectedTimestamp
  if (!ts) return
  // Tauri's async `ask` (Rust-side native dialog) instead of the synchronous
  // `window.confirm`, which blocks the webview on a JS panel that doesn't
  // render in this overlay-titlebar window (see useFileIO.js for the full
  // rationale). Async keeps the webview responsive while the dialog is up.
  const confirmed = await ask(
    'Restore this version? It becomes the live document. Your current unsaved ' +
    'changes stay recoverable with Cmd+Z until you save.',
    { title: 'Rite', type: 'warning' }
  )
  if (!confirmed) return
  props.history.restoreVersion(ts)
}

function onDiff() {
  const ts = props.history.selectedTimestamp
  if (!ts) return
  if (props.history.diffBlocks) {
    props.history.clearDiff()
  } else {
    props.history.diffAgainstCurrent(ts)
  }
}
</script>

<style scoped>
.drawer {
  position: fixed;
  top: 38px;
  bottom: 36px;
  width: 260px;
  transition: transform 0.25s ease;
  z-index: 25;
}

.drawer.left {
  left: 48px;
  transform: translateX(-100%);
}

.drawer.left.open {
  transform: translateX(0);
}

.drawer-content {
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  background: var(--glass-bg);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border-right: 1px solid var(--bg-glass-border);
  display: flex;
  flex-direction: column;
}

.drawer-section {
  flex: 1;
  overflow-y: auto;
}

.drawer-heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.history-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.history-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 5px;
  cursor: pointer;
  color: var(--text-secondary, #a0a0b0);
  transition: background 0.12s, color 0.12s;
}

.history-row:hover {
  background: var(--hover-bg-strong, rgba(255, 255, 255, 0.08));
  color: var(--text-primary, #f0f0f5);
}

.history-row.active {
  background: var(--accent-bg, rgba(79, 142, 247, 0.18));
  color: var(--text-primary, #f0f0f5);
}

.history-kind {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  border: 1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.15));
}

.history-kind.snapshot {
  background: var(--accent-bg, rgba(79, 142, 247, 0.2));
  color: var(--accent, #4f8ef7);
}

.history-kind.delta {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary, #a0a0b0);
}

.history-label {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.history-empty,
.drawer-empty p {
  font-size: 12px;
  color: var(--text-secondary, #a0a0b0);
  opacity: 0.7;
  padding: 8px;
  line-height: 1.5;
}

.history-error {
  font-size: 12px;
  color: rgba(248, 81, 73, 0.9);
  margin-bottom: 8px;
}

.drawer-footer {
  flex-shrink: 0;
  padding-top: 12px;
  border-top: 1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.1));
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-action {
  height: 30px;
  border-radius: 5px;
  border: 1px solid var(--accent, #4f8ef7);
  background: var(--accent-bg, rgba(79, 142, 247, 0.15));
  color: var(--accent, #4f8ef7);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.history-action:hover:not(:disabled) {
  background: var(--accent-bg, rgba(79, 142, 247, 0.28));
}

.history-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.history-action.secondary {
  border-color: var(--bg-glass-border, rgba(255, 255, 255, 0.2));
  background: transparent;
  color: var(--text-secondary, #a0a0b0);
}

.history-action.secondary:hover:not(:disabled) {
  background: var(--hover-bg-strong, rgba(255, 255, 255, 0.08));
  color: var(--text-primary, #f0f0f5);
}

.history-restore-hint {
  font-size: 11px;
  color: var(--text-secondary, #a0a0b0);
  opacity: 0.65;
  line-height: 1.4;
  margin: 0;
}
</style>