<template>
  <div class="notes-view" :style="notesStyles">
    <div class="notes-list">
      <!-- Rows come from `noteEntries(store.doc)` in `useNotes.js`, which owns
           the order. A click only selects a row and emits `select`. Navigation
           is the pane's section jump (SPEC.md 5.17). -->
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
    <div class="note-pane">
      <div class="note-head">
        <div class="note-title">{{ selectedTitle }}</div>
        <!-- The jump keeps the slot after .note-title, unbroken by elements
             so the sibling selector holds (SPEC.md 5.17). Only section-backed
             rows carry a sectionId, so overview and orphaned show none. -->
        <button
          v-if="selectedSectionId"
          type="button"
          class="note-jump"
          title="Go to section"
          aria-label="Go to section"
          @click="jumpToSection"
        >Go to section</button>
        <!-- The pencil stays last in .note-head. While editing the pencil
             gives way to check and reset, which reading mode never shows. -->
        <template v-if="isEditing">
          <button
            type="button"
            class="note-save"
            title="Save note"
            aria-label="Save note"
            @click="saveDraft"
          >✓</button>
          <span class="note-edit-divider"></span>
          <button
            type="button"
            class="note-reset"
            title="Reset edit"
            aria-label="Reset edit"
            @click="resetDraft"
          >↺</button>
        </template>
        <button
          v-else
          type="button"
          class="note-edit"
          title="Edit note"
          aria-label="Edit note"
          @click="startEditing"
        >✎</button>
      </div>
      <!-- :value plus @input, because the handler records the draft on the
           noteDraftUndo stack, whose order v-model does not own (S-026). -->
      <textarea
        v-if="isEditing"
        :value="draftText"
        class="note-source"
        aria-label="Note draft"
        @input="onDraftInput"
      ></textarea>
      <div
        v-else-if="noteText.trim()"
        class="note-rendered"
        v-html="renderMarkdown(noteText)"
      ></div>
      <div v-else class="note-empty">No note yet.</div>
      <!-- The recap is generated context beside the writer's words, so it
           follows the note body and stays read-only prose. -->
      <div v-if="selectedRecap" class="note-recap">
        <p class="note-recap-label">Summary</p>
        <p class="note-recap-text">{{ selectedRecap }}</p>
        <button
          type="button"
          class="note-insert-recap"
          title="Insert into note"
          aria-label="Insert into note"
          @click="insertRecap"
        >Insert into note</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { noteDraftUndo, noteEntries, readNote } from '../composables/useNotes.js'
import { renderMarkdown } from '../composables/useMarkdown.js'

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

// The pane shows the note of the selected entry in reading mode: rendered
// markdown when there is text, the empty state otherwise (SPEC.md 5.17).
const selectedEntry = computed(() =>
  entries.value.find((entry) => entry.id === selectedEntryId.value)
)
const selectedTitle = computed(() => selectedEntry.value?.title ?? '')
const selectedSectionId = computed(() => selectedEntry.value?.sectionId ?? '')
const noteText = computed(() => readNote(props.store.notes, selectedEntryId.value))

// Whitespace-only text counts as no recap, so a blank stored recap never
// renders this block.
const selectedRecap = computed(() => {
  const recapText = props.recaps?.[selectedSectionId.value] ?? ''
  return recapText.trim() ? recapText : ''
})

// Paints the surface from the same palette the editor sheet binds (S-022).
// The scoped vars carry the colours into the CSS below, and the chrome vars
// stay untouched. Without a theme object the style object is bare, so the
// scoped styles decide everything.
const notesStyles = computed(() => {
  const theme = props.theme
  if (!theme || typeof theme !== 'object') return {}
  return {
    backgroundColor: theme.bg,
    color: theme.text,
    '--note-text': theme.text,
    '--note-accent': theme.accent,
  }
})

// One draft at a time, owned by the entry selected when it opened. Reading
// mode is the default. The pencil starts the session at the committed text.
const isEditing = ref(false)
const draftText = ref('')

function startEditing() {
  draftText.value = readNote(props.store.notes, selectedEntryId.value)
  // Seeding runs before begin, so the session opens on the text the writer
  // starts with.
  noteDraftUndo.begin(
    () => draftText.value,
    (value) => { draftText.value = value },
  )
  isEditing.value = true
}

// The draft moves first and the controller records after it, so the stack top
// follows the live text. Programmatic assignments never pass here, so undo
// and redo write the draft without pushing a step.
function onDraftInput(event) {
  draftText.value = event.target.value
  noteDraftUndo.record(draftText.value)
}

// Writes the draft for the entry it was opened on, through the store. A draft
// equal to the committed text skips the write, so closing an untouched session
// marks nothing modified and sends nothing to Rust.
function commitDirtyDraft() {
  if (!isEditing.value) return
  if (draftText.value === noteText.value) return
  props.store.commitNote(selectedEntryId.value, draftText.value)
}

function selectEntry(entryId) {
  // A closing session belongs to the previous entry, so its draft lands on
  // that entry before the selection moves (SPEC.md 5.17).
  commitDirtyDraft()
  isEditing.value = false
  noteDraftUndo.end()
  selectedEntryId.value = entryId
  emit('select', entryId)
}

// The check commits the draft for the still-selected entry, then ends the
// session. The commit runs before the flag drops, because a sessionless
// draft skips the write.
function saveDraft() {
  commitDirtyDraft()
  isEditing.value = false
  noteDraftUndo.end()
}

// The reset lifts the committed text over the draft and keeps the session
// open, per SPEC.md 5.17. Nothing writes to the record, because the stored
// note did not change. The assignment skips record (see onDraftInput), so the
// session keeps its history.
function resetDraft() {
  draftText.value = readNote(props.store.notes, selectedEntryId.value)
}

// Inserting appends the recap to the draft without committing. The writes
// happen at the check, an entry change or the view closing (SPEC.md 5.17).
// A closed session seeds the committed text first, so the writer's words
// precede the recap. The trimEnd keeps exactly one blank line between them,
// the same join `orphanSectionNote` uses in useNotes.js.
function insertRecap() {
  if (!selectedRecap.value) return
  if (!isEditing.value) startEditing()
  const existing = draftText.value.trimEnd()
  draftText.value = existing
    ? `${existing}\n\n${selectedRecap.value}`
    : selectedRecap.value
  // The textarea fires nothing for this assignment, so the recap records
  // here to stay undoable.
  noteDraftUndo.record(draftText.value)
}

// Emits the selected row's sectionId, deferring the view switch and the
// scroll to the parent (SPEC.md 5.17).
function jumpToSection() {
  if (selectedSectionId.value) emit('jump', selectedSectionId.value)
}

// The view closing is not a discard: a dirty draft lands on the same entry,
// per SPEC.md 5.17. The undo session closes with it, or the app-wide
// singleton would eat the manuscript's next menu undo.
onBeforeUnmount(() => {
  commitDirtyDraft()
  noteDraftUndo.end()
})
</script>

<style scoped>
.notes-view {
  /* The view flows inside the App scroll-layer, as in HistoryView.vue.
   * It sets no fixed height and no internal page scroll. */
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
  color: var(--note-text, var(--text-primary));
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

/* The selected row paints with the theme accent (S-022). The fallback keeps
   a themeless mount on the chrome accent. */
.notes-entry.selected {
  color: var(--note-accent, var(--accent));
}

.note-pane {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.note-head {
  margin-bottom: 12px;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.note-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.note-edit,
.note-save,
.note-reset,
.note-jump,
.note-insert-recap {
  /* Quiet small controls, shared by the head glyphs and the jump and recap
     labels. Font size stands off the row font so they stay affordances. */
  flex: none;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  padding: 2px 6px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}

.note-edit:hover,
.note-save:hover,
.note-reset:hover,
.note-jump:hover,
.note-insert-recap:hover {
  color: var(--text-primary);
  background: var(--hover-bg);
}

.note-edit-divider {
  /* A thin vertical rule, sized to the small glyph row so it centers between
     the check and reset buttons. */
  flex: none;
  width: 1px;
  height: 14px;
  align-self: center;
  background: var(--bg-glass-border);
}

.note-source {
  /* Draft room without resizing: a paragraph of note plus margin. */
  width: 100%;
  min-height: 160px;
  resize: vertical;
  font: inherit;
  font-size: 14px;
  line-height: 1.55;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  box-sizing: border-box;
}

.note-rendered {
  font-size: 14px;
  line-height: 1.55;
  color: var(--note-text, var(--text-primary));
}

.note-empty {
  font-size: 13px;
  color: var(--text-secondary);
}

.note-recap {
  /* Generated recap prose beside the writer's note. The glass surface
     marks it as context, not writer text; read-only means no textarea. */
  margin-top: 12px;
  font-size: 14px;
  line-height: 1.55;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}

.note-recap-label {
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* The paragraph carries no default margin, because the block padding sets
   the rhythm already. */
.note-recap-text {
  margin: 0;
}

.note-recap .note-insert-recap {
  margin-top: 8px;
}
</style>
