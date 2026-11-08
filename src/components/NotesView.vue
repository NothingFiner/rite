<template>
  <div class="notes-view" :style="notesStyles">
    <div class="note-pane">
      <div class="note-head">
        <!-- The subtitle sits below the row, so .note-title and .note-jump
             stay adjacent siblings (SPEC.md 5.17). -->
        <div class="note-title-row">
          <div class="note-title">{{ selectedTitle }}</div>
          <!-- The jump keeps the slot after .note-title, unbroken by elements
               so the sibling selector holds (SPEC.md 5.17). Rows without a
               document sectionId (overview and orphaned) show none. -->
          <button
            v-if="selectedSectionId"
            type="button"
            class="note-jump"
            title="Go to section"
            aria-label="Go to section"
            @click="jumpToSection"
          >Go to section</button>
          <!-- The pencil stays last in the row. While editing the pencil
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
        <div v-if="selectedSubtitle" class="note-sub">{{ selectedSubtitle }}</div>
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
      <!-- Reading mode renders the note when there is text and shows the
           empty state otherwise (SPEC.md 5.17). -->
      <div
        v-else-if="noteText.trim()"
        class="note-rendered"
        v-html="renderMarkdown(noteText)"
      ></div>
      <div v-else class="note-empty">No note yet.</div>
      <!-- The recap is generated context beside the writer's words, so it
           follows the note body and stays read-only prose. -->
      <div v-if="selectedRecap" class="note-recap">
        <div v-if="selectedStale" class="note-recap-stale">Stale</div>
        <p class="note-recap-label">Assistant recap · read-only</p>
        <p class="note-recap-text">{{ selectedRecap }}</p>
        <button
          type="button"
          class="note-insert-recap"
          title="Insert into note"
          aria-label="Insert into note"
          @click="insertRecap"
        >Insert into note</button>
        <!-- Regenerate refreshes the recap at its own scope: summarizeOne
             with the section id, summarizeDocument for the overview row
             (S-020, S-036). It is offered on a current recap too. Staleness
             is a stored flag, so a note edited without tripping it leaves a
             summary that is quietly out of date and otherwise unrefreshable. -->
        <button
          type="button"
          class="note-regenerate"
          title="Regenerate recap"
          aria-label="Regenerate recap"
          @click="regenerateRecap"
        >Regenerate</button>
      </div>
      <!-- The recap slot for a row with no stored recap (S-018, S-035). It
           sits as a sibling after .note-recap, never inside it, so the empty
           state never contains .note-recap-text (S-016). -->
      <div v-else-if="showRecapGate" class="note-recap-empty">
        <p>{{ gateProse }}</p>
        <!-- The gate reads `llmConfigured` (useLlmSettings.js): a model
             configured, never the API key. The closed gate is pointer prose
             with no navigation, as in OutlineView (S-019). -->
        <button
          v-if="gateOpen"
          type="button"
          class="note-generate"
          :title="gateGenerateLabel"
          :aria-label="gateGenerateLabel"
          @click="generateRecaps"
        >{{ gateGenerateLabel }}</button>
        <p v-else>Configure a model in <span class="note-options-link">General Options</span>.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { noteDraftUndo, noteEntries, readNote, writeNote } from '../composables/useNotes.js'
import { renderMarkdown } from '../composables/useMarkdown.js'
import { llmConfigured } from '../composables/useLlmSettings.js'

const props = defineProps({
  // The document store. NotesView reads `store.doc` and `store.notes`. A
  // commit swaps the record `writeNote` returns into `store.notes` and flags
  // the document through `store.markModified`.
  store: { type: Object, required: true },
  // The active theme (`{ bg, text, accent }`), the same object the editor
  // surface is painted with.
  theme: { type: Object, default: null },
  // Generated per-section recaps, keyed by section id: `{ [sectionId]: text }`.
  recaps: { type: Object, default: () => ({}) },
  // The entry the pane shows. The parent owns the selection and sends it here.
  entryId: { type: String, default: 'overview' },
  // The text view the writer came from. The section jump returns to it.
  originView: { type: String, default: 'editor' },
  // The summaries composable object (the reactive wrap App.vue owns), or null
  // on a direct mount. It carries the generate and regenerate triggers and the
  // summaries entries with their stale flags.
  summaries: { type: Object, default: null },
  // The raw llm-settings composable object, or null on a direct mount. The
  // generation gate reads it through `llmConfigured` (useLlmSettings.js).
  settings: { type: Object, default: null },
})

const emit = defineEmits(['select', 'jump'])

// The pane starts on the prop's entry and follows it when the parent moves it.
const selectedEntryId = ref(props.entryId)

// Row clicks move the ref directly. A prop change runs the commit-before-move
// rule that selectEntry applies (SPEC.md 5.20a).
watch(
  () => props.entryId,
  (entryId) => {
    if (entryId === selectedEntryId.value) return
    commitDirtyDraft()
    noteDraftUndo.end()
    isEditing.value = false
    selectedEntryId.value = entryId
  },
)

const entries = computed(() => noteEntries(props.store.doc))

// The pane resolves the selected id to the overview row when the document
// has no such entry, as happens for a deleted section (SPEC.md 5.20a). Every
// read below goes through this resolved entry, so the header, the note text
// and the editor stay on the same page.
const selectedEntry = computed(() => {
  const matchingEntry = entries.value.find((entry) => entry.id === selectedEntryId.value)
  if (matchingEntry) return matchingEntry
  return entries.value.find((entry) => entry.id === 'overview')
})
const selectedTitle = computed(() =>
  // The header names the entry as the writer typed it (`entry.name`).
  // `sectionName` in useSectionFormat.js owns that rule.
  selectedEntry.value?.name || selectedEntry.value?.title || ''
)
const selectedSectionId = computed(() => selectedEntry.value?.sectionId ?? '')
// The overview row keys the recap reads below: its recap is the document
// summary, not a per-section entry.
const isOverviewEntry = computed(() => selectedEntry.value?.kind === 'overview')
const noteText = computed(() => readNote(props.store.notes, selectedEntry.value.id))

// The subtitle names the section's chapter, the nearest chapter row before
// it in `noteEntries` order. Sections before any chapter show the bare
// type. Overview, orphaned and chapter rows carry no subtitle.
const selectedSubtitle = computed(() => {
  if (selectedEntry.value?.kind !== 'section') return ''
  let chapterName = ''
  for (const entry of entries.value) {
    if (entry.id === selectedEntry.value.id) break
    if (entry.kind === 'chapter') chapterName = entry.name
  }
  return chapterName ? `${chapterName} · section` : 'section'
})

// The document summary arrives either as rust's `{ summary, stale }` record
// or as a bare string. A missing or blank one reads as no recap (S-034).
const documentRecap = computed(() => {
  const entry = props.summaries?.documentSummary
  const recapText = typeof entry === 'string' ? entry : (entry?.summary ?? '')
  return recapText.trim() ? recapText : ''
})

// Staleness reads the object's own `stale`, else the document-level boolean
// beside the bare string (S-036).
const documentRecapStale = computed(() => {
  const entry = props.summaries?.documentSummary
  if (entry && typeof entry === 'object') return Boolean(entry.stale)
  return Boolean(props.summaries?.documentSummaryStale)
})

// Whitespace-only text counts as no recap, so a blank stored recap never
// renders this block. The overview's recap comes from documentRecap (S-034).
const selectedRecap = computed(() => {
  if (isOverviewEntry.value) return documentRecap.value
  const recapText = props.recaps?.[selectedSectionId.value] ?? ''
  return recapText.trim() ? recapText : ''
})

// The generation gate (S-018, S-019): a configured model, never the API key.
// The rule lives in `llmConfigured` (useLlmSettings.js). The settings prop is
// the composable object, so the predicate reads its `settings` member.
const gateOpen = computed(() => llmConfigured(props.settings?.settings))

// The gate speaks the row's terms: the manuscript for the overview, the
// section for the rest (S-018, S-035).
const gateProse = computed(() =>
  isOverviewEntry.value
    ? 'Nothing has been summarized for this manuscript yet.'
    : 'Nothing has been summarized for this section yet.',
)

// The overview generates one document summary, so its label is singular
// (S-035). Sections and chapters keep the per-section loop's plural (S-018).
const gateGenerateLabel = computed(() =>
  isOverviewEntry.value ? 'Generate summary' : 'Generate summaries',
)

// The summaries entry for the selected section, or null. The predicate is the
// section id, not the row kind: a chapter is a section too and gets a summary
// from `summarize_and_store_section`, so keying on `kind === 'section'` hid
// every chapter's recap. Overview and the orphaned draft carry no section id,
// which is what keeps the recap surface off the retired row (trap 3).
const selectedSummaryEntry = computed(() => {
  if (!selectedSectionId.value) return null
  const sectionId = selectedSectionId.value
  const summaryEntries = props.summaries?.summaryEntries ?? []
  return summaryEntries.find((entry) => entry.sectionId === sectionId) ?? null
})

// Staleness is the summaries entry's own flag (S-020), not a client-side
// diff. On the overview it routes through documentRecapStale (S-036).
const selectedStale = computed(() => {
  if (isOverviewEntry.value) return documentRecapStale.value
  return Boolean(selectedSummaryEntry.value?.stale)
})

// The empty slot stands in for the recap block once the row has none stored
// (S-018, S-035). It wires only through the summaries prop, so direct mounts
// without it render nothing extra.
const showRecapGate = computed(() => {
  if (!props.summaries) return false
  if (isOverviewEntry.value) return !selectedRecap.value
  if (!selectedSectionId.value) return false
  return !selectedRecap.value
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
  draftText.value = readNote(props.store.notes, selectedEntry.value.id)
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

// Writes the draft for the entry the session opened on: the record
// `writeNote` returns swaps into `store.notes`, then `markModified` flags the
// change. A draft equal to the committed text does neither, so an untouched
// session marks nothing.
function commitDirtyDraft() {
  if (!isEditing.value) return
  if (draftText.value === noteText.value) return
  props.store.notes = writeNote(props.store.notes, selectedEntry.value.id, draftText.value)
  props.store.markModified?.()
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
  draftText.value = readNote(props.store.notes, selectedEntry.value.id)
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
  noteDraftUndo.record(draftText.value)
}

// The only work of the click (S-018, S-035): the summaries composable owns
// the loop. Sections and chapters run the per-section loop. The overview
// runs the document-summary loop.
function generateRecaps() {
  if (isOverviewEntry.value) {
    props.summaries?.summarizeDocument()
    return
  }
  props.summaries?.generateSummaries()
}

// Regenerates one section: the bare section id string, which summarizeOne
// resolves (S-020). The overview has no section id, so its recap refreshes
// through the document-summary loop instead (S-036).
function regenerateRecap() {
  if (isOverviewEntry.value) {
    props.summaries?.summarizeDocument()
    return
  }
  props.summaries?.summarizeOne(selectedSectionId.value)
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

.note-pane {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.note-head {
  margin-bottom: 12px;
}

.note-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.note-sub {
  margin-top: 4px;
  font-size: 12px;
  /* The pane paints the paper theme's background, so its text follows the
     paper palette. The chrome greys are mixed for the dark glass drawers and
     all but vanish on cream. */
  color: var(--note-text, var(--text-secondary));
  opacity: 0.7;
}

.note-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--note-text, var(--text-primary));
}

.note-edit,
.note-save,
.note-reset,
.note-jump,
.note-insert-recap,
.note-generate,
.note-regenerate {
  /* Quiet small controls, shared by the head glyphs and the jump and recap
     labels. Font size stands off the row font so they stay affordances. */
  flex: none;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  color: var(--note-text, var(--text-secondary));
  opacity: 0.75;
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
.note-insert-recap:hover,
.note-generate:hover,
.note-regenerate:hover {
  color: var(--note-text, var(--text-primary));
  opacity: 1;
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
  color: var(--note-text, var(--text-secondary));
  opacity: 0.6;
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

.note-recap .note-insert-recap,
.note-recap .note-regenerate {
  margin-top: 8px;
}

/* The empty slot states what is missing and offers the one control its gate
   allows (S-018, S-019). The prose tone matches .note-empty. */
.note-recap-empty {
  margin-top: 12px;
  font-size: 13px;
  color: var(--text-secondary);
}

.note-recap-empty p {
  margin: 0;
}

/* Only the span is the pointer. The sentence around it stays plain prose. */
.note-options-link {
  color: var(--note-accent, var(--accent));
}

/* The badge states the recap drift in the label's own quiet uppercase. */
.note-recap-stale {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
</style>
