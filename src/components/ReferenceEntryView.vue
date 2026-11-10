<template>
  <div class="reference-entry-view">
    <!-- A defined entry reads as prose. Only the empty state is editable, so
         the two surfaces never show together (SPEC.md 5.19a, S-008). -->
    <div v-if="hasDefinition" class="reference-definition" v-html="renderedDefinition"></div>
    <template v-else>
      <p class="reference-definition-empty">No definition yet.</p>
      <!-- The draft is a local ref, so editing never mutates the entry prop.
           The writer commits it through save-definition. -->
      <textarea
        v-model="definitionDraft"
        class="reference-definition-source"
        aria-label="Definition source"
      ></textarea>
      <button type="button" class="reference-save" @click="saveDefinition">Save definition</button>
    </template>
  </div>
</template>

<script setup>
// The detail page for one reference entry (SPEC.md 5.19a). S-008's definition
// surface ships here. S-009's alias, tag and fact chips stay deferred. Props
// and emits are the tests' contract, and the markup is the implementation's job.
import { computed, ref, watch } from 'vue'
import { renderMarkdown } from '../composables/useMarkdown.js'

const props = defineProps({
  entry: { type: Object, required: true },
  mentions: { type: Array, default: () => [] },
})

const emit = defineEmits([
  'save-definition',
  'remove-mention',
  'include-section',
  'merge',
  'jump',
])

const hasDefinition = computed(() => (props.entry.definition || '').trim().length > 0)

// One shared renderer, so the definition matches the note preview's markdown.
const renderedDefinition = computed(() => renderMarkdown(props.entry.definition))

const definitionDraft = ref(props.entry.definition)

// The draft follows the shown entry, so one entry's text never opens in
// another entry's empty state.
watch(
  () => props.entry,
  (entry) => {
    definitionDraft.value = entry.definition
  },
)

function saveDefinition() {
  emit('save-definition', definitionDraft.value)
}
</script>

<style scoped>
.reference-entry-view {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 100%;
}

.reference-definition {
  /* Rendered markdown prose from useMarkdown.js, same tone as the note. */
  font-size: 14px;
  line-height: 1.55;
  color: var(--text-primary);
}

.reference-definition-empty {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  opacity: 0.6;
}

.reference-definition-source {
  /* Draft room without resizing, mirroring .note-source in NotesView.vue. */
  width: 100%;
  min-height: 120px;
  resize: vertical;
  font: inherit;
  font-size: 14px;
  line-height: 1.55;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}

.reference-definition-source:focus {
  outline: none;
  border-color: var(--accent);
}

.reference-save {
  align-self: flex-start;
  font: inherit;
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0.75;
  background: none;
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  cursor: pointer;
}

.reference-save:hover {
  opacity: 1;
  color: var(--text-primary);
}
</style>
