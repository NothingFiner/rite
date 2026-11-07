<template>
  <div class="notes-view">
    <div class="notes-list">
      <!-- One row per entry (S-001): the overview first, the sections in
           document order, the orphaned draft last. Rows only select; the
           section jump is the pane's control (SPEC.md 5.17). -->
      <button
        v-for="entry in entries"
        :key="entry.id"
        type="button"
        class="notes-entry"
        :class="{
          'is-chapter': entry.kind === 'chapter',
          'is-section': entry.kind === 'section',
          'notes-orphans': entry.kind === 'orphaned',
          selected: entry.id === selectedEntryId,
        }"
        :data-entry-id="entry.id"
        @click="selectEntry(entry.id)"
      >{{ entry.title }}</button>
    </div>
    <div class="note-pane"></div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { noteEntries } from '../composables/useNotes.js'

const props = defineProps({
  // The document store. NotesView reads `store.doc` and `store.notes` and
  // commits through `store.commitNote(entryId, text)`.
  store: { type: Object, required: true },
  // The active theme (`{ bg, text, accent }`), the same object the editor
  // surface is painted with.
  theme: { type: Object, default: null },
  // Generated per-section recaps, keyed by section id: `{ [sectionId]: text }`.
  recaps: { type: Object, default: () => ({}) },
  // The entry selected when the view opens.
  initialEntryId: { type: String, default: 'overview' },
  // The text view the writer came from. The section jump returns to it.
  originView: { type: String, default: 'editor' },
})

const emit = defineEmits(['select', 'jump'])

// The selected row starts from the id the view was opened with and changes
// only by clicking a row.
const selectedEntryId = ref(props.initialEntryId)

const entries = computed(() => noteEntries(props.store.doc))

function selectEntry(entryId) {
  selectedEntryId.value = entryId
  emit('select', entryId)
}
</script>

<style scoped>
.notes-view {
  /* Flows inside the App scroll-layer like the other views (HistoryView.vue);
     no fixed height or internal page scroll. */
  min-height: 100%;
  display: flex;
  align-items: stretch;
}

.notes-list {
  flex: 0 0 220px;
  overflow-y: auto;
  padding: 16px 8px;
  background: var(--glass-bg);
  border-right: 1px solid var(--bg-glass-border);
}

/* Row chrome mirrors the drawer's .nav-section rows (same flat grammar), with
   a native button so each row is keyboard-reachable without extra wiring. */
.notes-entry {
  display: block;
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  color: var(--text-primary);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  margin-bottom: 2px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.notes-entry:hover,
.notes-entry.selected {
  background: var(--hover-bg);
}
</style>
