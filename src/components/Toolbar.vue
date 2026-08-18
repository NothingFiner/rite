<template>
  <div class="toolbar toolbar-top" data-tauri-drag-region>
    <div class="toolbar-spacer"></div>
    <div class="toolbar-brand">
      <span class="brand-text">rite</span>
    </div>
    <div class="toolbar-group">
      <button
        class="tool-btn"
        :class="{ active: mode === 'editor' }"
        @click="$emit('setMode', 'editor')"
      >
        Editor
      </button>
      <button
        class="tool-btn"
        :class="{ active: mode === 'manuscript' }"
        @click="$emit('setMode', 'manuscript')"
      >
        Manuscript
      </button>
      <div class="divider"></div>
      <button
        class="tool-btn drawer-toggle"
        :class="{ active: rightOpen }"
        @click="$emit('toggleRight')"
        :title="rightOpen ? 'Close Info' : 'Open Info'"
      >
        <svg width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M216 80h-32V48a16 16 0 0 0-16-16H40a16 16 0 0 0-16 16v128a8 8 0 0 0 13 6.22L72 154v30a16 16 0 0 0 16 16h93.59L219 230.22a8 8 0 0 0 5 1.78a8 8 0 0 0 8-8V96a16 16 0 0 0-16-16M66.55 137.78L40 159.25V48h128v88H71.58a8 8 0 0 0-5.03 1.78M216 207.25l-26.55-21.47a8 8 0 0 0-5-1.78H88v-32h80a16 16 0 0 0 16-16V96h32Z" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  mode: { type: String, default: 'editor' },
  rightOpen: { type: Boolean, default: false },
})

defineEmits(['toggleRight', 'setMode'])
</script>

<style scoped>
.toolbar-top {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 86px;
  z-index: 20;
  background: var(--glass-bg, rgba(20, 20, 25, 0.78));
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-bottom: 1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.1));
  user-select: none;
  -webkit-user-select: none;
  app-region: drag;
  -webkit-app-region: drag;
}

.toolbar-spacer {
  width: 80px;
  flex-shrink: 0;
}

.toolbar-brand {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.brand-text {
  font-family: 'Turret Road', -apple-system, sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary, #f0f0f5);
  letter-spacing: 2px;
  text-transform: lowercase;
  opacity: 0.9;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.tool-btn {
  height: 26px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary, #a0a0b0);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  user-select: none;
  app-region: no-drag;
  -webkit-app-region: no-drag;
}

.tool-btn:hover {
  background: var(--hover-bg-strong, rgba(255, 255, 255, 0.12));
  color: var(--text-primary, #f0f0f5);
}

.tool-btn.active {
  background: var(--accent-bg, rgba(79, 142, 247, 0.25));
  color: var(--accent, #4f8ef7);
  border-color: var(--accent, #4f8ef7);
  font-weight: 600;
}

.drawer-toggle {
  width: 26px;
  padding: 0;
  color: var(--text-secondary, #a0a0b0);
}

.drawer-toggle.active {
  background: var(--accent-bg, rgba(79, 142, 247, 0.25));
  color: var(--accent, #4f8ef7);
}

.divider {
  width: 1px;
  height: 16px;
  background: var(--bg-glass-border, rgba(255, 255, 255, 0.1));
  margin: 0 4px;
}

</style>
