<template>
  <Transition name="prompt-fade">
    <div v-if="visible" class="prompt-overlay" @click.self="$emit('cancel')">
      <div
        class="prompt-modal glass"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <h3 class="prompt-title">{{ title }}</h3>
        <p v-if="message" class="prompt-message">{{ message }}</p>
        <input
          ref="inputRef"
          class="prompt-input"
          v-model="value"
          :placeholder="placeholder"
          @keydown.enter="confirm"
          @keydown.escape="$emit('cancel')"
        />
        <div class="prompt-actions">
          <button class="btn-ghost" @click="$emit('cancel')">Cancel</button>
          <button class="btn-primary" :disabled="!canConfirm" @click="confirm">
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  message: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  confirmLabel: { type: String, default: 'OK' },
  // Seed value shown when the modal opens (e.g. a default document name).
  initialValue: { type: String, default: '' },
  // When true, the confirm button is allowed to submit an empty value. Off by
  // default so a name prompt can't create an unnamed document.
  allowEmpty: { type: Boolean, default: false },
})

const emit = defineEmits(['confirm', 'cancel'])

const inputRef = ref(null)
const value = ref(props.initialValue)

// The confirm button stays disabled until there is a non-empty value, unless
// the caller explicitly allows empty. Drives both the disabled binding and the
// confirm() guard so Enter on an empty input is a no-op too.
const canConfirm = computed(() => props.allowEmpty || value.value.trim().length > 0)

// Each time the modal opens, seed the input and focus + select-all so typing
// immediately replaces the default. Seeding on open (not on prop change) means
// a new `initialValue` for a fresh open is honored, but mid-open prop nudges
// don't clobber what the user has typed.
watch(
  () => props.visible,
  (open) => {
    if (!open) return
    value.value = props.initialValue
    nextTick(() => {
      inputRef.value?.focus()
      inputRef.value?.select()
    })
  },
)

function confirm() {
  if (!canConfirm.value) return
  emit('confirm', value.value.trim())
}
</script>

<style scoped>
.prompt-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.prompt-modal {
  width: 360px;
  max-width: calc(100vw - 32px);
  padding: 20px;
  border-radius: 12px;
  border: 1px solid var(--bg-glass-border);
  background: var(--popup-bg, var(--glass-bg));
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}

.prompt-title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.prompt-message {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--text-secondary);
}

.prompt-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  margin-bottom: 16px;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--input-bg, rgba(0, 0, 0, 0.2));
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm, 6px);
  outline: none;
}

.prompt-input:focus {
  border-color: var(--accent);
}

.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-ghost {
  background: transparent;
  border: 1px solid var(--bg-glass-border);
  color: var(--text-primary);
  padding: 6px 14px;
  border-radius: var(--radius-sm, 6px);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-ghost:hover {
  background: var(--hover-bg-strong);
}

.btn-primary {
  background: var(--accent);
  border: 1px solid var(--accent);
  color: var(--text-primary);
  padding: 6px 14px;
  border-radius: var(--radius-sm, 6px);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, opacity 0.2s;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.prompt-fade-enter-active,
.prompt-fade-leave-active {
  transition: opacity 0.15s ease;
}

.prompt-fade-enter-from,
.prompt-fade-leave-to {
  opacity: 0;
}
</style>