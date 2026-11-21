<template>
  <div
    v-if="visible"
    ref="rootRef"
    class="reference-lookup"
    :style="{ position: 'fixed', left: `${position.left}px`, top: `${position.top}px` }"
  >
    <div class="reference-lookup-word">{{ word }}</div>

    <!-- Mutually exclusive states: in flight, failed, no match, then the list.
         Each entry keeps its Rust-sent kind beside its name, so two entries
         sharing the word are distinguishable in the chooser. -->
    <div v-if="loading" class="reference-lookup-status">Looking up {{ word }}…</div>
    <div v-else-if="error" class="reference-lookup-status reference-lookup-error">
      {{ error }}
    </div>
    <div v-else-if="matches.length === 0" class="reference-lookup-status">
      No matching entries
    </div>
    <div v-else class="reference-lookup-list">
      <button
        v-for="match in matches"
        :key="match.id"
        type="button"
        class="reference-lookup-item"
        :data-entry-id="match.id"
        @click="emit('choose', match)"
      >
        <span class="reference-lookup-name">{{ match.name }}</span>
        <span class="reference-lookup-kind">{{ kindLabel(match.kind) }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { placePopover } from '../composables/useThesaurus.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  // The word as the lookup looked it up: the capture's core ("well-known",
  // not '"well-known."').
  word: { type: String, default: '' },
  // Rust's matches: { id, name, kind }.
  matches: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  // The right-click point, in viewport pixels.
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
})

const emit = defineEmits(['choose', 'cancel'])

// The kind is lowercase from serde's camelCase ("term", "character", "place").
// The writer reads a label, so capitalise it.
function kindLabel(kind) {
  const label = kind ?? ''
  return label.charAt(0).toUpperCase() + label.slice(1)
}

const rootRef = ref(null)
// Where the popover actually sits: the click point until it has been measured,
// then wherever `placePopover` says, which keeps it inside the window.
const position = ref({ left: props.x, top: props.y })

function place() {
  const element = rootRef.value
  if (element === null) {
    position.value = { left: props.x, top: props.y }
    return
  }
  const rect = element.getBoundingClientRect()
  position.value = placePopover({
    x: props.x,
    y: props.y,
    width: rect.width,
    height: rect.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  })
}

// Re-measure on every change that can resize the popover (a different word,
// the loading line turning into the match list).
watch(
  () => [props.visible, props.x, props.y, props.loading, props.error, props.matches],
  () => {
    nextTick(place)
  },
  { immediate: true },
)

// Escape and an outside click are document-level, so they work without the
// popover having focus. Both listeners live while the popover is visible. An
// emit here is never a hide: only a visible=false prop or unmount takes it
// down again.
function onDocumentKeydown(event) {
  if (!props.visible || event.key !== 'Escape') return
  emit('cancel')
}

function onDocumentMousedown(event) {
  if (!props.visible) return
  const root = rootRef.value
  if (root !== null && !root.contains(event.target)) emit('cancel')
}

// Shrinking the window can put the popover behind an edge it cleared when it
// opened. It re-places itself on resize while it is on screen.
function onWindowResize() {
  if (props.visible) place()
}

function installDismissal() {
  document.addEventListener('keydown', onDocumentKeydown)
  document.addEventListener('mousedown', onDocumentMousedown)
  window.addEventListener('resize', onWindowResize)
}

function removeDismissal() {
  document.removeEventListener('keydown', onDocumentKeydown)
  document.removeEventListener('mousedown', onDocumentMousedown)
  window.removeEventListener('resize', onWindowResize)
}

watch(
  () => props.visible,
  (open) => (open ? installDismissal() : removeDismissal()),
  { immediate: true },
)

onBeforeUnmount(removeDismissal)
</script>

<style scoped>
.reference-lookup {
  /* Sits above the drawers (25) and status bar (30). Below the prompt modal
     (60) and the toast layer (100), on the same level as the thesaurus
     popover. The two never open at once. */
  z-index: 40;
  position: fixed;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 280px;
  max-width: calc(100vw - 16px);
  max-height: min(70vh, 480px);
  padding: 12px;
  border: 1px solid var(--bg-glass-border);
  border-radius: 10px;
  background: var(--popup-bg, var(--glass-bg));
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}

.reference-lookup-word {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.reference-lookup-status {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  font-style: italic;
}

.reference-lookup-error {
  color: var(--accent);
  font-style: normal;
}

.reference-lookup-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}

.reference-lookup-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  font-size: 13px;
  text-align: left;
  color: var(--text-primary);
  background: transparent;
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.reference-lookup-item:hover {
  background: var(--hover-bg-strong);
}

.reference-lookup-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reference-lookup-kind {
  flex: none;
  font-size: 11px;
  font-style: italic;
  color: var(--text-secondary);
}

@media (max-width: 400px) {
  .reference-lookup {
    width: calc(100vw - 16px);
  }
}
</style>
