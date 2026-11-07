<template>
  <!-- 5.20a: the drawer lists rows in document order under chapter headings.
       A row click reports the choice upward. The shell owns the selection and
       the anchor, which the highlight and the dot both read from. -->
  <div class="references-drawer">
    <template v-if="hasSections">
      <template v-for="item in drawerRows" :key="item.key">
        <div v-if="item.type === 'group'" class="notes-group">{{ item.label }}</div>
        <button
          v-else
          type="button"
          class="notes-entry"
          :class="[kindClass(item.entry.kind), { selected: item.entry.id === selectedId }]"
          :data-entry-id="item.entry.id"
          :aria-selected="item.entry.id === selectedId"
          @click="selectEntry(item.entry.id)"
        >
          <span v-if="isAnchored(item.entry)" class="anchor-dot" aria-hidden="true"></span>
          <span class="notes-entry-label">{{ item.label }}</span>
        </button>
      </template>
    </template>
    <div v-else class="notes-empty">Nothing to outline.</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { noteEntries } from '../composables/useNotes.js'
import { sectionDisplayTitle } from '../composables/useSectionFormat.js'

// The drawer lists the document (Story overview, then the manuscript under a
// chapter heading, then the Retired group) and reports a selection upward.
// The shell owns the selection and the anchor; this component only draws them.
const props = defineProps({
  store: { type: Object, required: true },
  selectedId: { type: String, default: 'overview' },
  anchorId: { type: String, default: null },
})

const emit = defineEmits(['select'])

// The kind classes the SPEC contract names. An overview row has no kind of
// its own, so it carries none.
const KIND_CLASSES = {
  chapter: 'is-chapter',
  section: 'is-section',
  orphaned: 'notes-orphans',
}

// The two fixed rows spell their labels in the drawer's own casing. The
// overview title noteEntries returns is 'Story Overview', which the row
// contract does not use.
const FIXED_LABELS = { overview: 'Story overview', orphaned: 'Orphaned notes' }

function kindClass(kind) {
  return KIND_CLASSES[kind] ?? ''
}

// The dot marks the row matching the anchorId. Only section-backed rows
// qualify, so the overview and orphaned rows never carry one.
const isAnchored = (entry) => Boolean(entry.sectionId) && entry.id === props.anchorId

function selectEntry(entryId) {
  emit('select', entryId)
}

const entries = computed(() => noteEntries(props.store.doc))
const docSections = computed(() => {
  return Array.isArray(props.store.doc?.sections) ? props.store.doc.sections : []
})

// A document with no sections draws no rows and no headings, so only the
// empty state renders.
const hasSections = computed(() => docSections.value.length > 0)

// Rows in document order with the group headings between them. noteEntries
// provides the rows and their titles, so this walk only emits the headings.
// Only Chapter-type sections advance the index, the counter rule useNotes.js
// owns. A heading shows the subtitle when set, else the derived number name,
// because the stored title is blank for an unnamed chapter.
const drawerRows = computed(() => {
  if (!hasSections.value) return []
  const byId = new Map(entries.value.map((entry) => [entry.id, entry]))
  const rows = []

  const pushEntry = (entry) => {
    if (!entry) return
    rows.push({ key: entry.id, type: 'entry', entry, label: FIXED_LABELS[entry.id] ?? entry.title })
  }

  let chapterIndex = 0
  pushEntry(byId.get('overview'))
  for (const section of docSections.value) {
    if (section.sectionType === 'chapter') {
      chapterIndex += 1
      rows.push({
        key: `heading-${section.id}`,
        type: 'group',
        label: section.title || sectionDisplayTitle(section, chapterIndex),
      })
    }
    pushEntry(byId.get(section.id))
  }
  rows.push({ key: 'heading-retired', type: 'group', label: 'Retired' })
  pushEntry(byId.get('orphaned'))
  return rows
})
</script>

<style scoped>
.references-drawer {
  /* ReferencesView.vue defines the width contract and gives the page the rest
     of the row. 232px keeps the row labels on one line. */
  flex: none;
  width: 232px;
  overflow-y: auto;
  padding: 12px 12px 20px;
  border-right: 1px solid var(--bg-glass-border);
}

.notes-group {
  /* Group headings are the chapter dividers, not rows. */
  margin: 14px 6px 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.notes-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  font: inherit;
  text-align: left;
  color: var(--text-primary);
  background: none;
  border: 0;
  /* The transparent border stays in place, so the selected color never
     shifts the row text. */
  border-left: 2px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.notes-entry:hover {
  background: var(--hover-bg);
}

.notes-entry.selected {
  background: var(--accent-bg);
  border-left-color: var(--accent);
  color: var(--accent);
}

.notes-entry.is-chapter {
  font-weight: 600;
}

.notes-entry.is-section {
  padding-left: 18px;
}

.anchor-dot {
  /* Small and quiet, per the mock-up dot, so the row text stays primary. */
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.45;
}

.notes-entry-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notes-entry.notes-orphans {
  margin-top: 8px;
  font-style: italic;
  color: var(--text-secondary);
}

.notes-empty {
  padding: 10px 8px;
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
