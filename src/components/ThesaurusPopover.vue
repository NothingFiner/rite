<template>
  <div
    v-if="visible"
    ref="rootRef"
    class="thesaurus-popover"
    :style="{ position: 'fixed', left: `${position.left}px`, top: `${position.top}px` }"
  >
    <div class="thesaurus-word">{{ word }}</div>

    <!-- The rules hold the scrolling sense list between the word above and the
         actions below, so the chrome never scrolls out of view. -->
    <hr class="thesaurus-separator" />

    <!-- Mutually exclusive states: in flight, failed, nothing found, then the
         senses. Only the last shows the sense groups and the OK button. -->
    <div v-if="loading" class="thesaurus-loading">Looking up {{ word }}…</div>
    <div v-else-if="error" class="thesaurus-error">{{ error }}</div>
    <div v-else-if="senses.length === 0" class="thesaurus-empty">No synonyms found</div>
    <div v-else class="thesaurus-senses">
      <div v-for="(sense, senseIndex) in senses" :key="senseIndex" class="thesaurus-sense">
        <div class="thesaurus-pos">{{ sense.partOfSpeech }}</div>
        <div class="thesaurus-sense-number">sense {{ sense.senseNumber }}</div>
        <div class="thesaurus-gloss">{{ sense.gloss }}</div>
        <div class="thesaurus-synonyms">
          <button
            v-for="synonym in sense.synonyms"
            :key="synonym"
            type="button"
            class="thesaurus-synonym"
            :aria-pressed="isMarked(senseIndex, synonym) ? 'true' : 'false'"
            @click="mark(senseIndex, synonym)"
          >
            {{ synonym }}
          </button>
        </div>
        <div v-if="sense.antonyms.length" class="thesaurus-antonyms">
          Antonyms: {{ sense.antonyms.join(', ') }}
        </div>
      </div>
    </div>

    <hr class="thesaurus-separator" />

    <div class="thesaurus-actions">
      <button type="button" class="btn-ghost thesaurus-cancel" @click="emit('cancel')">
        Cancel
      </button>
      <button
        v-if="hasSenseList"
        type="button"
        class="btn-primary thesaurus-ok"
        :disabled="!marked"
        @click="applyMarked"
      >
        OK
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  placePopover,
  shapeReplacement,
  splitAffixes,
} from '../composables/useThesaurus.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  // The word exactly as it appears in the document ("Happy,"), so the
  // replacement can keep its leading capital and trailing punctuation.
  word: { type: String, default: '' },
  // One group per WordNet sense: { partOfSpeech, senseNumber, gloss, synonyms,
  // antonyms }.
  senses: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  // The click point, in viewport pixels.
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
})

const emit = defineEmits(['apply', 'cancel'])

// The mark is a single global selection across all senses — the last synonym
// clicked — or null when nothing is marked. OK stays disabled without it.
const marked = ref(null)

const hasSenseList = computed(
  () => !props.loading && !props.error && props.senses.length > 0,
)

function isMarked(senseIndex, synonym) {
  return (
    marked.value !== null &&
    marked.value.senseIndex === senseIndex &&
    marked.value.synonym === synonym
  )
}

function mark(senseIndex, synonym) {
  // Moving, not accumulating: marking another synonym drops the previous mark.
  marked.value = { senseIndex, synonym }
}

function applyMarked() {
  if (!marked.value) return
  // Only the shaped string leaves the popover, never the mark itself.
  emit('apply', shapeReplacement(marked.value.synonym, splitAffixes(props.word)))
}

// A new lookup replaces the senses; a stale mark must not survive into them.
watch(
  () => [props.senses, props.word, props.visible],
  () => {
    marked.value = null
  },
)

// Escape and an outside click are document-level, so they work without the
// popover having focus. Both listeners live while the popover is visible —
// including a mount that starts visible — and an emit here is never a hide:
// only a visible=false prop or unmount takes them down again.
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
// the senses arriving, the loading line turning into the sense list).
watch(
  () => [props.visible, props.x, props.y, props.loading, props.error, props.senses],
  () => {
    nextTick(place)
  },
  { immediate: true },
)

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
// opened, so it re-places itself on resize while it is on screen.
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
.thesaurus-popover {
  /* Sits above the drawers (25) and status bar (30); below the prompt modal
     (60) and the toast layer (100). */
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

.thesaurus-separator {
  /* Full bleed: the rules run to the popover's sides, so the only inset is the
     1px border. The 12px is the popover's own horizontal padding. */
  margin: 0 -12px;
  border: 0;
  border-top: 1px solid var(--bg-glass-border);
}

.thesaurus-word {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.thesaurus-loading,
.thesaurus-error,
.thesaurus-empty {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  font-style: italic;
}

.thesaurus-error {
  color: var(--accent);
  font-style: normal;
}

.thesaurus-senses {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.thesaurus-sense {
  padding: 8px;
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm, 6px);
}

.thesaurus-pos {
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  font-style: italic;
  color: var(--accent);
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm, 6px);
}

.thesaurus-sense-number {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-secondary);
}

.thesaurus-gloss {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-primary);
}

.thesaurus-synonyms {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.thesaurus-synonym {
  padding: 4px 10px;
  font-size: 13px;
  color: var(--text-primary);
  background: transparent;
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.thesaurus-synonym:hover {
  background: var(--hover-bg-strong);
}

.thesaurus-synonym[aria-pressed='true'] {
  border-color: var(--accent);
  background: var(--hover-bg-strong);
}

.thesaurus-antonyms {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.thesaurus-actions {
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
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (max-width: 400px) {
  .thesaurus-popover {
    width: calc(100vw - 16px);
  }
}
</style>