<template>
  <div class="statusbar glass">
    <div class="status-left">
      <span class="status-title">{{ title }}{{ modified ? ' *' : '' }}</span>
      <button class="btn-ghost" @click="$emit('openFile')">Open</button>
      <button class="btn-ghost" @click="$emit('saveFile')">Save</button>
      <button class="btn-ghost" @click="$emit('importFile')">Import</button>
    </div>
    <div class="status-right">
      <div class="theme-picker">
        <div
          class="theme-swatch current"
          :style="{ background: currentTheme.bg, borderColor: swatchBorder(currentTheme.bg) }"
          @click="$emit('toggleThemePicker')"
        ></div>
        <div v-if="showThemePicker" class="theme-tooltip">
          <div
            v-for="(t, i) in themes"
            :key="i"
            class="theme-swatch"
            :class="{ active: theme === i }"
            :style="{ background: t.bg, borderColor: swatchBorder(t.bg) }"
            @click="$emit('selectTheme', i)"
          ></div>
        </div>
      </div>
      <span class="word-count">{{ wordCount }} words ({{ selectedWordCount }} Selected)</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  modified: { type: Boolean, default: false },
  theme: { type: Number, default: 0 },
  themes: { type: Array, default: () => [] },
  showThemePicker: { type: Boolean, default: false },
  wordCount: { type: Number, default: 0 },
  selectedWordCount: { type: Number, default: 0 },
})

const currentTheme = computed(() => props.themes[props.theme] || props.themes[0] || { bg: '#333333' })

function isLightColor(hex) {
  if (!hex) return false
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5
}

function swatchBorder(bg) {
  return isLightColor(bg) ? 'rgba(0, 0, 0, 0.35)' : 'rgba(255, 255, 255, 0.35)'
}

defineEmits(['openFile', 'saveFile', 'importFile', 'toggleThemePicker', 'selectTheme'])
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

.word-count {
  color: var(--text-secondary);
}

.btn-ghost {
  background: transparent;
  border: 1px solid var(--bg-glass-border);
  color: var(--text-primary);
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-ghost:hover {
  background: var(--hover-bg-strong);
}

.theme-picker {
  position: relative;
}

.theme-swatch {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid;
}

.theme-swatch.active {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.theme-tooltip {
  position: absolute;
  bottom: 26px;
  right: 0;
  display: flex;
  gap: 8px;
  padding: 8px;
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  border: 1px solid var(--bg-glass-border);
  border-radius: 8px;
  z-index: 30;
}
</style>
