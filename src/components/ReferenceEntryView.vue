<template>
  <div class="reference-entry-view">
    <!-- The naming block spans both grid columns: the heading and the name
         field head the page instead of owning the definition column. -->
    <div class="reference-naming">
      <h2 class="reference-entry-heading">{{ entryDisplayName(entry) }}</h2>
      <input
        v-model="nameDraft"
        class="reference-name"
        aria-label="Entry name"
        @blur="commitName"
        @keydown.enter="commitName"
      >
      <p v-if="hasCurrentNameError" class="reference-name-error">{{ nameError }}</p>
    </div>
    <div class="reference-definition-column">
      <!-- Only term and place switch on this page: a character cannot move to
           another surface (SPEC.md 5.20), so a character entry offers no toggle. -->
      <div v-if="canSwitchKind" class="reference-kind-switch">
        <button
          v-for="switchable in switchableKinds"
          :key="switchable.kind"
          type="button"
          class="reference-kind-toggle"
          :data-kind="switchable.kind"
          :aria-pressed="switchable.kind === entry.kind"
          @click="chooseKind(switchable.kind)"
        >{{ switchable.label }}</button>
      </div>
      <!-- An empty definition edits in place (S-008). A committed one edits
           through .reference-definition-edit, which replaces the prose with the
           source field (S-030). -->
      <template v-if="hasDefinition && !editingDefinition">
        <div class="reference-definition" v-html="renderedDefinition"></div>
        <button type="button" class="reference-definition-edit" @click="openDefinitionEdit">Edit definition</button>
      </template>
      <template v-else-if="hasDefinition && editingDefinition">
        <textarea
          v-model="definitionDraft"
          class="reference-definition-source"
          aria-label="Definition source"
        ></textarea>
        <button type="button" class="reference-save" @click="saveDefinition">Save definition</button>
        <button type="button" class="reference-edit-cancel" @click="cancelDefinitionEdit">Cancel</button>
      </template>
      <template v-else>
        <p class="reference-definition-empty">No definition yet.</p>
        <!-- The draft is a local ref, so editing never mutates the entry prop.
             The edit seeds from the committed text and cancel resets it, so a
             discarded draft cannot leak back. -->
        <textarea
          v-model="definitionDraft"
          class="reference-definition-source"
          aria-label="Definition source"
        ></textarea>
        <button type="button" class="reference-save" @click="saveDefinition">Save definition</button>
      </template>
    </div>
    <!-- The rail exists only while it has content: chips, derived mentions,
         a merge offer or the appears-in picker. One grid cell keeps the
         groups from wandering. -->
    <aside v-if="hasRail" class="reference-meta">
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
      <!-- Where the entry shows up in the manuscript, scanned at read time. The
           parent owns the record, so the rows and the picker only report a
           section id and never edit the list themselves. -->
      <div v-if="mentions.length || addableSections.length" class="reference-mentions">
        <div class="reference-rail-label">{{ mentionHeading }}</div>
        <div
          v-for="mention in mentions"
          :key="mention.sectionId"
          class="reference-mention"
          :data-section-id="mention.sectionId"
        >
          <span class="reference-mention-title">{{ mention.title }}</span>
          <button
            type="button"
            class="reference-mention-go"
            title="Go to section"
            aria-label="Go to section"
            @click="emit('jump', mention.sectionId)"
          >Go to section</button>
          <button
            type="button"
            class="reference-mention-remove"
            title="Remove from section"
            aria-label="Remove from section"
            @click="emit('remove-mention', mention.sectionId)"
          >Remove</button>
        </div>
        <!-- The placeholder keeps the first real section from reading as a
             live pick when nothing has been chosen yet. -->
        <select
          v-if="addableSections.length"
          class="reference-mention-add"
          aria-label="Add section"
          @change="chooseInclude"
        >
          <option value="" disabled>Add section…</option>
          <option
            v-for="section in addableSections"
            :key="section.id"
            class="reference-section-option"
            :data-section-id="section.id"
            :value="section.id"
          >{{ section.title }}</option>
        </select>
      </div>
      <!-- A merge rewrites the record, so the survivor is named behind an
           explicit offer: the writer starts it, then picks the entry to keep. -->
      <div v-if="mergeTargets.length" class="reference-merge-block">
        <button
          v-if="!mergeOpen"
          type="button"
          class="reference-merge"
          @click="mergeOpen = true"
        >Merge…</button>
        <template v-else>
          <button
            v-for="target in mergeTargets"
            :key="target.id"
            type="button"
            class="reference-merge-target"
            :data-entry-id="target.id"
            @click="chooseMerge(target.id)"
          >{{ entryDisplayName(target) }}</button>
          <button
            type="button"
            class="reference-merge-cancel"
            @click="mergeOpen = false"
          >Cancel</button>
        </template>
      </div>
    </aside>
  </div>
</template>

<script setup>
// The detail page for one reference entry (SPEC.md 5.19a). The naming block,
// the definition surface and the chip rail are pinned. The appears-in rows and the merge
// offer are the derived parts. Props and emits are the tests' contract, and
// the markup is the implementation's job.
import { computed, ref, watch } from 'vue'
import { renderMarkdown } from '../composables/useMarkdown.js'
import { entryDisplayName } from '../composables/useReferences.js'

const props = defineProps({
  entry: { type: Object, required: true },
  // This entry's appears-in rows (5.19a): the parent derives them from the
  // manuscript. Each row reports remove-mention beside its jump (S-033).
  mentions: { type: Array, default: () => [] },
  // Every other entry in the record, as merge candidates. A record with one
  // entry sends none, and the rail then holds no merge offer.
  mergeTargets: { type: Array, default: () => [] },
  // The manuscript sections, so the appears-in picker can offer the ones this
  // entry is not already shown in (S-034).
  sections: { type: Array, default: () => [] },
  // The shell's refusal for the last name commit: empty when the name is free,
  // otherwise it names the entry that owns it (S-028).
  nameError: { type: String, default: '' },
  // The active paper palette. The page publishes it as custom properties
  // because the shell's chrome tokens stay dark inside this view.
  theme: { type: Object, default: null },
})

const emit = defineEmits([
  'save-definition',
  'cancel-definition',
  'rename',
  'remove-mention',
  'include-section',
  'merge',
  'jump',
  'kind-change',
  'add-alias',
  'remove-alias',
  'add-tag',
  'remove-tag',
  'add-fact',
  'remove-fact',
])

const hasDefinition = computed(() => (props.entry.definition || '').trim().length > 0)

// The fields default to empty arrays, so an entry record that lacks them
// renders no chips instead of a broken list.
const aliases = computed(() => props.entry.aliases || [])
const tags = computed(() => props.entry.tags || [])
const facts = computed(() => props.entry.facts || [])

const hasMeta = computed(
  () => aliases.value.length > 0 || tags.value.length > 0 || facts.value.length > 0,
)

// The picker's choices (S-034): sections the derived mentions do not show,
// in the order the sections prop lists them.
const addableSections = computed(() => {
  const shownSectionIds = new Set(props.mentions.map((mention) => mention.sectionId))
  return props.sections.filter((section) => !shownSectionIds.has(section.id))
})

// The picker alone counts as rail content, so an entry with no scanned row
// can still be corrected by hand (S-035).
const hasRail = computed(
  () =>
    hasMeta.value ||
    props.mentions.length > 0 ||
    props.mergeTargets.length > 0 ||
    addableSections.value.length > 0,
)

// A character appears in a section. A term or a place is used in one.
const mentionHeading = computed(() => (props.entry.kind === 'character' ? 'Appears in' : 'Used in'))

// One shared renderer, so the definition matches the note preview's markdown.
const renderedDefinition = computed(() => renderMarkdown(props.entry.definition))

// Only term and place swap kinds (SPEC.md 5.20). The entry's own kind renders
// as the pressed toggle of the two.
const switchableKinds = [
  { kind: 'term', label: 'Term' },
  { kind: 'place', label: 'Place' },
]
const canSwitchKind = computed(() => switchableKinds.some((item) => item.kind === props.entry.kind))

const mergeOpen = ref(false)
const editingDefinition = ref(false)
const definitionDraft = ref(props.entry.definition)
const nameDraft = ref(props.entry.name)
const lastCommittedName = ref(props.entry.name)

// A refusal belongs to the name the last commit was issued for. The page
// hides it once the field moves off that name, so a stale refusal never
// lingers over a fresh edit. A commit refreshes lastCommittedName before it
// emits, so a new refusal shows even when its text repeats the old one.
const hasCurrentNameError = computed(
  () => props.nameError.length > 0 && nameDraft.value === lastCommittedName.value,
)

// The drafts follow the shown entry, so one entry's text never opens in
// another entry's fields. Merge mode closes with it: the survivor's
// target list drops the absorbed entry, so the old list cannot be offered.
// The definition edit closes with it too: an open edit belongs to the entry
// it was opened on.
watch(
  () => props.entry,
  (entry) => {
    definitionDraft.value = entry.definition
    nameDraft.value = entry.name
    lastCommittedName.value = entry.name
    mergeOpen.value = false
    editingDefinition.value = false
  },
)

function openDefinitionEdit() {
  definitionDraft.value = props.entry.definition
  editingDefinition.value = true
}

function saveDefinition() {
  // A commit closes the edit, so the surface returns to the committed prose.
  emit('save-definition', definitionDraft.value)
  editingDefinition.value = false
}

function cancelDefinitionEdit() {
  editingDefinition.value = false
  definitionDraft.value = props.entry.definition
}

function commitName() {
  // Blur without an edit would recommit the shown name on every focus walk,
  // so only a changed value reports rename.
  if (nameDraft.value === lastCommittedName.value) return
  // The scope updates first, so a fresh refusal survives an identical text.
  lastCommittedName.value = nameDraft.value
  emit('rename', nameDraft.value)
}

// The picker is one-shot: report include-section (S-035) even when no
// scanned row exists, then clear the pick.
function chooseInclude(event) {
  const sectionId = event.target.value
  if (!sectionId) return
  emit('include-section', sectionId)
  event.target.value = ''
}

// App.vue swaps the record and moves the selection to the survivor. This
// view only reports the choice.
function chooseMerge(targetId) {
  emit('merge', targetId)
}

// The current kind's toggle is the pressed one, so only a different kind
// reports the change.
function chooseKind(kind) {
  if (kind === props.entry.kind) return
  emit('kind-change', kind)
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

.reference-naming {
  /* Spans both grid columns, so the heading heads the whole page. */
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reference-entry-heading {
  margin: 0;
  font-size: 18px;
  line-height: 1.35;
  color: var(--text-primary);
}

.reference-name {
  /* Single-line counterpart of .reference-definition-source, same glass chrome. */
  font: inherit;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
}

.reference-name:focus {
  outline: none;
  border-color: var(--accent);
}

.reference-name-error {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  /* The theme has no danger token, so the accent carries the refusal. */
  color: var(--accent);
}

.reference-definition-column {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.reference-kind-switch {
  display: flex;
  gap: 6px;
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

/* The flex column stretches buttons across the column, so the edit and
     cancel controls pin to the start. */
.reference-definition-edit,
.reference-edit-cancel {
  align-self: flex-start;
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

.reference-rail-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.reference-mentions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.reference-mention {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.reference-mention-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-primary);
}

/* Definition-page controls reuse the save button's ghost chrome. The
     select keeps its native dropdown arrow. */
.reference-kind-toggle,
.reference-mention-add,
.reference-mention-go,
.reference-mention-remove,
.reference-merge,
.reference-merge-target,
.reference-merge-cancel,
.reference-definition-edit,
.reference-edit-cancel {
  font: inherit;
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.75;
  background: none;
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm);
  padding: 3px 8px;
  cursor: pointer;
  white-space: nowrap;
}

.reference-kind-toggle:hover,
.reference-mention-add:hover,
.reference-mention-go:hover,
.reference-mention-remove:hover,
.reference-merge:hover,
.reference-merge-target:hover,
.reference-merge-cancel:hover,
.reference-definition-edit:hover,
.reference-edit-cancel:hover {
  opacity: 1;
  color: var(--text-primary);
  background: var(--hover-bg);
}

/* The current kind stays visibly pressed, using the hover's active look. */
.reference-kind-toggle[aria-pressed='true'] {
  opacity: 1;
  color: var(--text-primary);
  background: var(--hover-bg);
}

.reference-merge-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.reference-merge-target {
  text-align: left;
}
</style>
