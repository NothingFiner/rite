<template>
  <div class="drawer left" :class="{ open }">
    <div class="drawer-content">
      <div class="text-options">
        <h3 class="drawer-heading">Text Options</h3>
        <div class="drawer-label">Margins</div>
        <div class="zoom-row">
          <button
            class="zoom-btn"
            :class="{ active: theme.editorMargin === 'compact' }"
            @click="theme.setMargin('compact')"
          >
            Compact
          </button>
          <button
            class="zoom-btn"
            :class="{ active: theme.editorMargin === 'manuscript' }"
            @click="theme.setMargin('manuscript')"
          >
            Manuscript
          </button>
        </div>
        <div class="drawer-label">Zoom</div>
        <div class="zoom-row">
          <button
            v-for="z in [12, 16, 20]"
            :key="z"
            class="zoom-btn"
            :class="{ active: theme.editorZoom === z }"
            @click="theme.setZoom(z)"
          >
            {{ z }}pt
          </button>
        </div>
        <div class="drawer-label">Font</div>
        <select
          class="drawer-input font-select"
          :value="format.editorFont"
          @change="e => format.setFont(e.target.value)"
        >
          <option v-for="opt in format.fontOptions" :key="opt.label" :value="opt.family">{{ opt.label }}</option>
        </select>
      </div>
    </div>
  </div>
</template>

<script setup>
// Receives the theme and format composables as props and drives them directly
// (setMargin / setZoom / setFont). See GeneralOptionsDrawer for the rationale.
defineProps({
  open: { type: Boolean, default: false },
  theme: { type: Object, required: true },
  format: { type: Object, required: true },
})
</script>

<style scoped>
/* Base drawer shell — duplicated per drawer component by convention (see
   NavigationDrawer.vue); scoped styles only reach this component's template. */
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
}

.drawer-heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.drawer-label {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
  margin-top: 10px;
}

.drawer-input {
  width: 100%;
  background: var(--input-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: 6px;
  padding: 6px 8px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}

.drawer-input:focus {
  border-color: var(--accent);
}

.text-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.zoom-row {
  display: flex;
  gap: 6px;
}

.zoom-btn {
  flex: 1;
  height: 32px;
  border-radius: 6px;
  border: 1px solid var(--bg-glass-border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.zoom-btn:hover {
  background: var(--hover-bg-strong);
  color: var(--text-primary);
}

.zoom-btn.active {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.font-select {
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  padding-right: 24px;
}
</style>