<template>
  <div class="toaster" v-if="toasts.length > 0">
    <div
      v-for="t in toasts"
      :key="t.id"
      class="toast"
      :class="['type-' + t.type]"
      @click="dismiss(t.id)"
    >
      <span class="toast-message">{{ t.message }}</span>
    </div>
  </div>
</template>

<script setup>
import { useToastsStore } from '../stores/toasts.js'

const toastsStore = useToastsStore()
const { toasts } = toastsStore

function dismiss(id) {
  toastsStore.dismissToast(id)
}
</script>

<style scoped>
.toaster {
  position: fixed;
  bottom: 48px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: 8px;
  z-index: 100;
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  cursor: pointer;
  max-width: min(80vw, 520px);
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--text-primary);
  background: var(--glass-bg, rgba(20, 20, 25, 0.78));
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--bg-glass-border);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  transition: background 0.2s, border-color 0.2s;
}

.toast:hover {
  background: var(--hover-bg-strong);
}

.toast-message {
  white-space: pre-wrap;
  word-break: break-word;
}

/* Accent stripe by type. Error toasts get a red accent; success uses the
   theme accent; info stays neutral. */
.toast.type-error {
  border-left: 3px solid #e5484d;
}

.toast.type-success {
  border-left: 3px solid var(--accent);
}

.toast.type-info {
  border-left: 3px solid var(--bg-glass-border);
}
</style>