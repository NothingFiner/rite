<template>
  <div class="reference-entry-view">
    <div class="reference-definition-column">
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
    <!-- Each group renders only while it has members, so an entry without
         metadata shows no rail and no orphaned headings (S-009). -->
    <aside v-if="hasMeta" class="reference-meta">
      <div v-if="aliases.length" class="reference-alias-row">
        <span
          v-for="(alias, aliasIndex) in aliases"
          :key="aliasIndex"
          class="reference-alias"
        >{{ alias }}</span>
      </div>
      <div v-if="tags.length" class="reference-tag-row">
        <span
          v-for="(tag, tagIndex) in tags"
          :key="tagIndex"
          class="reference-tag"
        >{{ tag }}</span>
      </div>
      <div v-if="facts.length" class="reference-fact-list">
        <div v-for="(fact, factIndex) in facts" :key="factIndex" class="reference-fact">
          <span class="reference-fact-label">{{ fact.label }}</span><span class="reference-fact-value">{{ fact.value }}</span>
        </div>
      </div>
    </aside>
  </div>
</template>

<script setup>
// The detail page for one reference entry (SPEC.md 5.19a). S-008's definition
// surface and S-009's alias, tag and fact chips are the two surfaces here.
// Props and emits are the tests' contract, and the markup is the
// implementation's job.
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

// The fields default to empty arrays, so an entry record that lacks them
// renders no chips instead of a broken list.
const aliases = computed(() => props.entry.aliases || [])
const tags = computed(() => props.entry.tags || [])
const facts = computed(() => props.entry.facts || [])

// The rail exists only while one of the three groups has members.
const hasMeta = computed(
  () => aliases.value.length > 0 || tags.value.length > 0 || facts.value.length > 0,
)

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
  /* Two grid columns put the metadata rail beside the definition (S-009). */
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(140px, 30%);
  gap: 10px 18px;
  align-content: start;
  min-height: 100%;
}

.reference-definition-column {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
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

.reference-meta {
  /* The rail caps at 30% of the pane, so chip rows wrap instead of squeezing the prose. */
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.reference-alias-row,
.reference-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.reference-alias,
.reference-tag {
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
}

.reference-fact-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reference-fact {
  /* The accent bar marks one fact record, so its label and value read as a pair. */
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  border-left: 2px solid var(--accent);
  padding-left: 8px;
}

.reference-fact-value {
  color: var(--text-primary);
}
</style>
