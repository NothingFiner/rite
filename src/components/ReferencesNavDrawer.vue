<template>
  <div class="references-drawer" :style="drawerStyles">
    <div v-if="isEmptyDocument" class="notes-empty">Nothing to outline.</div>
    <template v-for="item in drawerItems" :key="item.key">
      <h3 v-if="item.heading" class="drawer-heading notes-group">{{ item.heading }}</h3>
      <button
        v-else
        type="button"
        class="notes-entry"
        :class="{
          'is-chapter': item.entry.kind === 'chapter',
          'is-section': item.entry.kind === 'section',
          'notes-orphans': item.entry.kind === 'orphaned',
          selected: item.entry.id === selectedId,
          'is-anchor': item.entry.id === anchorId,
        }"
        :data-entry-id="item.entry.id"
        @click="selectEntry(item.entry.id)"
      >{{ item.label }}</button>
    </template>
  </div>
</template>

<script setup>
// The References drawer (SPEC.md 5.20a): the story overview, the manuscript
// under a heading per chapter, then the Retired group. A row click reports
// the choice upward. The shell owns navigation. useNotes.js owns the row
// order and the naming rule.

import { computed } from 'vue'
import { noteEntries } from '../composables/useNotes.js'

// The rows paint with the chrome palette, except the selected one: the theme
// accent stays its colour (S-022's e2e pins it), and a saturated accent reads on
// the dark glass whatever the paper theme is. The paper theme's *text* colour
// does not come here: bound to this drawer it was dark ink on dark glass.
const props = defineProps({
  store: { type: Object, required: true },
  selectedId: { type: String, default: 'overview' },
  anchorId: { type: String, default: null },
  theme: { type: Object, default: null },
})

const emit = defineEmits(['select'])

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

// The flat noteEntries order becomes an alternating heading/row list: a
// heading precedes every chapter row, and a Retired heading precedes the
// orphaned row.
const drawerItems = computed(() => {
  if (isEmptyDocument.value) return []
  const items = []
  for (const entry of noteEntries(props.store?.doc)) {
    if (entry.kind === 'chapter') {
      // The heading names the chapter by its sectionName, not its row title.
      // The row title prefixes "Chapter N:" onto the subtitle. Group
      // headings carry the subtitle alone.
      items.push({ key: `group-${entry.id}`, heading: entry.name })
    }
    if (entry.kind === 'orphaned') {
      items.push({ key: 'group-retired', heading: 'Retired' })
    }
    // The mock-up spells the overview row "Story overview". noteEntries emits
    // title case, so the drawer overrides that one label and forwards the rest.
    items.push({
      key: entry.id,
      entry,
      label: entry.kind === 'overview' ? 'Story overview' : entry.title,
    })
  }
  return items
})

function selectEntry(id) {
  emit('select', id)
}
</script>

<style scoped>
/* A group label, not a row: smaller than the entries, dim, and spaced away
   from the row above it. At 13px/600 it read as a duplicate of the chapter
   row that follows it (both were bold and the same size). */
.drawer-heading {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin: 12px 6px 4px;
}

.drawer-heading:first-child {
  margin-top: 0;
}

/* Row chrome adapted from NotesView.vue's list (same flat grammar). */
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

/* The anchor dot sits in the gutter, absolutely placed so the state shifts
   no row layout. */
.notes-entry.is-anchor::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 50%;
  width: 5px;
  height: 5px;
  transform: translateY(-50%);
  border-radius: 50%;
  background: currentColor;
  opacity: 0.45;
}

.notes-empty {
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  padding: 20px 0;
}
</style>
