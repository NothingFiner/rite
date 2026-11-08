<template>
  <div class="statusbar glass" role="contentinfo">
    <div class="status-left">
      <span class="status-title">{{ title || 'Untitled' }}</span>
      <span v-if="fileName" class="status-file">{{ fileName }}</span>
      <span
        v-if="saveStatus"
        class="save-status"
        :class="{ 'is-saving': saveStatus === 'Saving…', 'is-error': saveStatus === 'Save failed' }"
      >{{ saveStatus }}</span>
      <span v-if="anchorName" class="anchor-chip">{{ anchorName }}</span>
    </div>
    <div class="status-right">
      <span class="word-count">{{ wordCount }} words ({{ selectedWordCount }} Selected)</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, default: '' },
  saveStatus: { type: String, default: '' },
  wordCount: { type: Number, default: 0 },
  selectedWordCount: { type: Number, default: 0 },
  // Basename of the current file, including its extension (`novel.rite`), or
  // '' when the document has never been saved. Rendered in the status-left
  // group after the title; blank (nothing shown) while the file is unsaved.
  fileName: { type: String, default: '' },
  // Name of the anchor row, resolved by App. An empty value hides the chip.
  anchorName: { type: String, default: '' },
})
</script>

<style scoped>
.statusbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  z-index: 20;
  font-size: 13px;
  border-top: 1px solid var(--bg-glass-border);
  border-bottom: none;
  background: var(--glass-bg, rgba(20, 20, 25, 0.78));
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
}

.status-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-title {
  color: var(--text-primary);
  font-weight: 500;
}

/* Current file's basename (`novel.rite`), same muted treatment as the
   save-status label — a secondary fact sitting next to the title. */
.status-file {
  color: var(--text-secondary);
  font-size: 12px;
}

/* Save indicator: the title's right-hand label replacing the old binary `*`.
   Muted by default (Saved / Edited), accented while a write is in flight, red
   when the last write failed so the writer notices their work is not on disk. */
.save-status {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 400;
  padding-left: 2px;
}

.save-status.is-saving {
  color: var(--accent);
  font-weight: 500;
}

.save-status.is-error {
  color: #e5484d;
  font-weight: 500;
}

/* The chip names the section the writer came from while References is open
   (5.20a S-027). Muted 12px text matches the status-file label; a hairline
   border and the unbounded radius turn the label into a pill badge. */
.anchor-chip {
  color: var(--text-secondary);
  font-size: 12px;
  padding: 2px 8px;
  border: 1px solid var(--bg-glass-border);
  border-radius: 9999px;
}

.word-count {
  color: var(--text-secondary);
}
</style>
