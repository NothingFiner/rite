<template>
  <div class="references-drawer" :style="drawerStyles">
    <!-- Whole-manuscript regeneration. Per-section Regenerate lives on each
         recap; this is the bulk action after a heavy revision. Gated on a
         configured model, the same rule as the other generation controls. -->
    <div v-if="canRegenerateAll" class="references-tools">
      <button
        type="button"
        class="references-regenerate-all"
        title="Regenerate all summaries"
        aria-label="Regenerate all summaries"
        :disabled="busy"
        @click="emit('regenerate-all')"
      >{{ busy ? 'Regenerating…' : 'Regenerate all' }}</button>
    </div>
    <div v-if="isEmptyDocument" class="notes-empty">Nothing to outline.</div>
    <button
      v-for="item in drawerItems"
      :key="item.entry.id"
      type="button"
      class="notes-entry"
      :class="{
        'is-chapter': item.entry.kind === 'chapter',
        'is-section': item.entry.kind === 'section',
        'notes-orphans': item.entry.kind === 'orphaned',
        selected: item.entry.id === selectedId,
      }"
      :data-entry-id="item.entry.id"
      @click="selectEntry(item.entry.id)"
    >{{ item.label }}</button>
  </div>
</template>

<script setup>
// The References drawer (SPEC.md 5.20a): the story overview, the manuscript in
// document order, then the orphaned draft. A chapter's own row stands as its
// heading — a group label above it repeated the chapter name and was not
// selectable. A row click reports the choice upward: the shell owns navigation,
// useNotes.js owns the row order and the naming rule.

import { computed } from 'vue'
import { noteEntries } from '../composables/useNotes.js'
import { llmConfigured } from '../composables/useLlmSettings.js'

// The rows paint with the chrome palette, except the selected one: the theme
// accent stays its colour (S-022's e2e pins it), and a saturated accent reads on
// the dark glass whatever the paper theme is. The paper theme's *text* colour
// does not come here: bound to this drawer it was dark ink on dark glass.
const props = defineProps({
  store: { type: Object, required: true },
  selectedId: { type: String, default: 'overview' },
  theme: { type: Object, default: null },
  // The raw llm-settings composable: the generation gate reads
  // `settings.settings.model` through `llmConfigured`.
  settings: { type: Object, default: null },
  busy: { type: Boolean, default: false },
  // Which reference surface the drawer head shows (5.19a): outline, characters
  // or glossary. Defaults to outline so the shipped 5.20a tests are unchanged.
  surface: { type: String, default: 'outline' },
  // The references record (5.19a). Entries are source stored beside the notes.
  references: { type: Object, default: () => ({ entries: [] }) },
  // The selected reference entry on the non-outline surfaces.
  selectedEntryId: { type: String, default: '' },
})

const emit = defineEmits([
  'select',
  'regenerate-all',
  'update:surface',
  'add-entry',
  'select-entry',
])

const canRegenerateAll = computed(() => llmConfigured(props.settings?.settings))

const drawerStyles = computed(() => {
  const theme = props.theme
  if (!theme || typeof theme !== 'object' || !theme.accent) return {}
  return { '--note-accent': theme.accent }
})

// The overview and orphaned rows exist for any document, so emptiness reads
// the document's sections, never the entry list.
const isEmptyDocument = computed(() => {
  const sections = props.store?.doc?.sections
  return !Array.isArray(sections) || sections.length === 0
})

// The mock-up spells the overview row "Story overview"; noteEntries emits title
// case, so the drawer overrides that one label and forwards the rest.
const drawerItems = computed(() => {
  if (isEmptyDocument.value) return []
  return noteEntries(props.store?.doc).map((entry) => ({
    entry,
    label: entry.kind === 'overview' ? 'Story overview' : entry.title,
  }))
})

function selectEntry(id) {
  emit('select', id)
}
</script>

<style scoped>
/* Row chrome adapted from NotesView.vue's list (same flat grammar). */
.references-tools {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.references-regenerate-all {
  font: inherit;
  font-size: 11px;
  color: var(--text-secondary);
  background: none;
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  cursor: pointer;
}

.references-regenerate-all:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--hover-bg);
}

.references-regenerate-all:disabled {
  opacity: 0.5;
  cursor: default;
}

.notes-entry {
  display: block;
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font: inherit;
  font-size: 13px;
  text-align: left;
  color: var(--text-primary);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  margin-bottom: 2px;
  cursor: pointer;
  user-select: none;
  position: relative;
  transition: background 0.15s;
}

.notes-entry:hover,
.notes-entry.selected {
  background: var(--hover-bg);
}

/* The drawer is chrome, so it paints with the chrome palette. The paper theme's
   text colour belongs to the page beside it: bound here it put dark ink on the
   dark glass drawer and the rows vanished. */
.notes-entry.selected {
  background: var(--accent-bg);
  box-shadow: inset 2px 0 0 var(--accent);
  color: var(--note-accent, var(--accent));
}

.notes-entry.is-chapter {
  font-weight: 600;
}

/* A section row indents 18px under its chapter. That matches the mock-up's
   row indent, past the 8px base gutter. */
.notes-entry.is-section {
  padding-left: 18px;
}


.notes-empty {
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  padding: 20px 0;
}
</style>
