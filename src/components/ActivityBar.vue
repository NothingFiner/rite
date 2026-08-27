<template>
  <div class="activity-bar">
    <div class="activity-icons">
      <button
        v-for="item in items"
        :key="item.id"
        class="activity-icon"
        :class="{ active: activeId === item.id && drawerOpen }"
        :title="item.label"
        @click="onClick(item.id)"
      >
        <component :is="item.icon" />
      </button>
    </div>
    <Transition name="format-fade">
      <div class="activity-divider" v-if="viewMode === 'editor'"></div>
    </Transition>
    <TransitionGroup name="format-slide" tag="div" class="activity-format" v-if="viewMode === 'editor'">
      <button
        key="bold"
        class="activity-icon format-btn"
        :class="{ active: formats?.bold }"
        title="Bold (Cmd+B)"
        tabindex="-1"
        @mousedown.prevent
        @click="$emit('toggleFormat', 'bold')"
      >
        <b>B</b>
      </button>
      <button
        key="italic"
        class="activity-icon format-btn"
        :class="{ active: formats?.italic }"
        title="Italic (Cmd+I)"
        tabindex="-1"
        @mousedown.prevent
        @click="$emit('toggleFormat', 'italic')"
      >
        <i>I</i>
      </button>
      <button
        key="underline"
        class="activity-icon format-btn"
        :class="{ active: formats?.underline }"
        title="Underline (Cmd+U)"
        tabindex="-1"
        @mousedown.prevent
        @click="$emit('toggleFormat', 'underline')"
      >
        <u>U</u>
      </button>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { h, Transition, TransitionGroup } from 'vue'

const props = defineProps({
  activeId: { type: String, default: '' },
  drawerOpen: { type: Boolean, default: false },
  viewMode: { type: String, default: 'editor' },
  formats: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['select', 'toggleFormat'])

const BookIcon = () => h('svg', {
  width: 24,
  height: 24,
  viewBox: '0 0 256 256',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.5,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
}, [
        h('path', {
          fill: 'currentColor',
          d: 'M232 48h-72a40 40 0 0 0-32 16a40 40 0 0 0-32-16H24a8 8 0 0 0-8 8v144a8 8 0 0 0 8 8h72a24 24 0 0 1 24 24a8 8 0 0 0 16 0a24 24 0 0 1 24-24h72a8 8 0 0 0 8-8V56a8 8 0 0 0-8-8M96 192H32V64h64a24 24 0 0 1 24 24v112a39.8 39.8 0 0 0-24-8m128 0h-64a39.8 39.8 0 0 0-24 8V88a24 24 0 0 1 24-24h64ZM160 88h40a8 8 0 0 1 0 16h-40a8 8 0 0 1 0-16m48 40a8 8 0 0 1-8 8h-40a8 8 0 0 1 0-16h40a8 8 0 0 1 8 8m0 32a8 8 0 0 1-8 8h-40a8 8 0 0 1 0-16h40a8 8 0 0 1 8 8'
        })
])

const CogIcon = () => h('svg', {
  width: 24,
  height: 24,
  viewBox: '0 0 256 256',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.5,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
}, [
    h('path', {
      fill: 'currentColor',
      d: 'M200 156c0 6.5-7.33 12-16 12s-16-5.5-16-12s7.33-12 16-12s16 5.5 16 12m32-100v144a16 16 0 0 1-16 16H40a16 16 0 0 1-16-16V56a16 16 0 0 1 16-16h176a16 16 0 0 1 16 16m-88.63 116.88l-44-104a8 8 0 0 0-14.74 0l-44 104a8 8 0 0 0 14.74 6.24L66.84 152h50.32l11.47 27.12a8 8 0 0 0 14.74-6.24M216 124c0-15.44-14.36-28-32-28a34.86 34.86 0 0 0-20.78 6.68a8 8 0 0 0 9.56 12.83A18.84 18.84 0 0 1 184 112c8.56 0 15.8 5.36 16 11.76v8a35.24 35.24 0 0 0-16-3.76c-17.64 0-32 12.56-32 28s14.36 28 32 28a35.1 35.1 0 0 0 16.93-4.26A8 8 0 0 0 216 176ZM73.61 136h36.78L92 92.53Z'
    })
])

const ListIcon = () => h('svg', {
  width: 24,
  height: 24,
  viewBox: '0 0 256 256',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.5,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
}, [

        h('path', {
          fill: 'currentColor',
          d: 'M128 80a48 48 0 1 0 48 48a48.05 48.05 0 0 0-48-48m0 80a32 32 0 1 1 32-32a32 32 0 0 1-32 32m109.94-52.79a8 8 0 0 0-3.89-5.4l-29.83-17l-.12-33.62a8 8 0 0 0-2.83-6.08a111.9 111.9 0 0 0-36.72-20.67a8 8 0 0 0-6.46.59L128 41.85L97.88 25a8 8 0 0 0-6.47-.6a112.1 112.1 0 0 0-36.68 20.75a8 8 0 0 0-2.83 6.07l-.15 33.65l-29.83 17a8 8 0 0 0-3.89 5.4a106.5 106.5 0 0 0 0 41.56a8 8 0 0 0 3.89 5.4l29.83 17l.12 33.62a8 8 0 0 0 2.83 6.08a111.9 111.9 0 0 0 36.72 20.67a8 8 0 0 0 6.46-.59L128 214.15L158.12 231a7.9 7.9 0 0 0 3.9 1a8.1 8.1 0 0 0 2.57-.42a112.1 112.1 0 0 0 36.68-20.73a8 8 0 0 0 2.83-6.07l.15-33.65l29.83-17a8 8 0 0 0 3.89-5.4a106.5 106.5 0 0 0-.03-41.52m-15 34.91l-28.57 16.25a8 8 0 0 0-3 3c-.58 1-1.19 2.06-1.81 3.06a7.94 7.94 0 0 0-1.22 4.21l-.15 32.25a95.9 95.9 0 0 1-25.37 14.3L134 199.13a8 8 0 0 0-3.91-1h-3.83a8.1 8.1 0 0 0-4.1 1l-28.84 16.1A96 96 0 0 1 67.88 201l-.11-32.2a8 8 0 0 0-1.22-4.22c-.62-1-1.23-2-1.8-3.06a8.1 8.1 0 0 0-3-3.06l-28.6-16.29a90.5 90.5 0 0 1 0-28.26l28.52-16.28a8 8 0 0 0 3-3c.58-1 1.19-2.06 1.81-3.06a7.94 7.94 0 0 0 1.22-4.21l.15-32.25a95.9 95.9 0 0 1 25.37-14.3L122 56.87a8 8 0 0 0 4.1 1h3.64a8.1 8.1 0 0 0 4.1-1l28.84-16.1A96 96 0 0 1 188.12 55l.11 32.2a8 8 0 0 0 1.22 4.22c.62 1 1.23 2 1.8 3.06a8.1 8.1 0 0 0 3 3.06l28.6 16.29a90.5 90.5 0 0 1 .05 28.29Z'
        })
])

const items = [
  // The id stays 'chapters' (compared in App.vue's drawer-open conditions and
  // here in useKeyboardShortcuts' Cmd+Enter handler); only the user-facing
  // label changes to reflect the flat-sections model.
  { id: 'chapters', label: 'Sections', icon: BookIcon },
  { id: 'general-options', label: 'General Options', icon: ListIcon },
  { id: 'text-options', label: 'Text Options', icon: CogIcon },
]

function onClick(id) {
  emit('select', id)
}
</script>

<style scoped>
.activity-bar {
  position: fixed;
  top: 38px;
  left: 0;
  bottom: 36px;
  width: 48px;
  z-index: 30;
  background: var(--glass-bg, rgba(20, 20, 25, 0.78));
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-right: 1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.1));
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
}

.activity-icons {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.activity-icon {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #a0a0b0);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
  position: relative;
}

.activity-icon:hover {
  background: var(--hover-bg-strong, rgba(255, 255, 255, 0.12));
  color: var(--text-primary, #f0f0f5);
}

.activity-icon.active {
  color: var(--text-primary, #f0f0f5);
}

.activity-icon.active::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 20px;
  background: var(--accent, #4f8ef7);
  border-radius: 0 2px 2px 0;
}

.activity-divider {
  width: 28px;
  height: 1px;
  background: var(--bg-glass-border, rgba(255, 255, 255, 0.1));
  margin: 8px 0;
}

.activity-format {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.format-btn {
  border: 1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.1));
  background: var(--input-bg, rgba(255, 255, 255, 0.06));
}

.format-btn:hover {
  background: var(--hover-bg, rgba(255, 255, 255, 0.1));
  border-color: var(--bg-glass-border, rgba(255, 255, 255, 0.15));
}

.format-btn.active {
  background: var(--accent-bg, rgba(79, 142, 247, 0.2));
  border-color: var(--accent, #4f8ef7);
  color: var(--text-primary, #f0f0f5);
}

.format-btn.active::before {
  display: none;
}

/* Format button animations */
.format-fade-enter-active,
.format-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.format-fade-enter-from,
.format-fade-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

.format-slide-enter-active,
.format-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.format-slide-enter-from,
.format-slide-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

.format-slide-move {
  transition: transform 0.2s ease;
}
</style>
