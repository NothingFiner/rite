<template>
  <div class="reference-entry-view" :style="entryStyles">
    <!-- Display first (SPEC.md revision 3, S-057). The heading stays up
         even under an open field: an untitled entry keeps its Untitled
         reading (S-026). -->
    <div class="reference-naming">
      <h2 class="reference-entry-heading">{{ entryDisplayName(entry) }}</h2>
      <button
        v-if="!editingName"
        type="button"
        class="reference-name-edit"
        @click="openNameEdit"
      >Edit name</button>
      <template v-else>
        <input
          ref="nameInput"
          v-model="nameDraft"
          class="reference-name"
          aria-label="Entry name"
          @keydown.enter="saveName"
        >
        <button type="button" class="reference-name-save" @click="saveName">Save name</button>
        <button type="button" class="reference-name-cancel" @click="cancelNameEdit">Cancel</button>
        <p v-if="hasCurrentNameError" class="reference-name-error">{{ nameError }}</p>
      </template>
    </div>
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
    <!-- One editing branch serves a committed and an empty definition
         (SPEC.md revision 3, S-063). The source field renders only while an
         edit is open, and the same .reference-definition-edit opens it
         either way. -->
    <template v-if="editingDefinition">
      <!-- The draft is a local ref, so editing never mutates the entry prop.
           openDefinitionEdit seeds it from the committed text and
           cancelDefinitionEdit resets it, so a discarded draft cannot leak back. -->
      <textarea
        v-model="definitionDraft"
        class="reference-definition-source"
        aria-label="Definition source"
      ></textarea>
      <button type="button" class="reference-save" @click="saveDefinition">Save definition</button>
      <button type="button" class="reference-edit-cancel" @click="cancelDefinitionEdit">Cancel</button>
    </template>
    <template v-else-if="hasDefinition">
      <div
        class="reference-definition"
        @click="openClickedReference"
        v-html="renderedDefinition"
      ></div>
      <button type="button" class="reference-definition-edit" @click="openDefinitionEdit">Edit definition</button>
    </template>
    <template v-else>
      <p class="reference-definition-empty">No definition yet.</p>
      <button type="button" class="reference-definition-edit" @click="openDefinitionEdit">Edit definition</button>
    </template>
    <!-- The rail always renders: each record group holds its empty state
         and its add row (S-064). -->
    <aside class="reference-meta">
      <div class="reference-group" data-group="aliases">
        <div class="reference-rail-label">Aliases</div>
        <div v-if="aliases.length" class="reference-alias-row">
          <!-- The remove control sits beside the chip span, never inside
               it: S-009 reads the span's text as the value alone. -->
          <span
            v-for="(alias, aliasIndex) in aliases"
            :key="aliasIndex"
            class="reference-chip"
          >
            <span class="reference-alias">{{ alias }}</span>
            <button
              type="button"
              class="reference-alias-remove"
              :data-alias="alias"
              aria-label="Remove alias"
              @click="emit('remove-alias', alias)"
            >×</button>
          </span>
        </div>
        <p v-else class="reference-group-empty">No aliases yet.</p>
        <input
          v-model="aliasDraft"
          class="reference-alias-input"
          aria-label="New alias"
          @keydown.enter="submitAlias"
        >
        <button type="button" class="reference-alias-add" @click="submitAlias">Add alias</button>
      </div>
      <div class="reference-group" data-group="tags">
        <div class="reference-rail-label">Tags</div>
        <div v-if="tags.length" class="reference-tag-row">
          <span
            v-for="(tag, tagIndex) in tags"
            :key="tagIndex"
            class="reference-chip"
          >
            <span class="reference-tag">{{ tag }}</span>
            <button
              type="button"
              class="reference-tag-remove"
              :data-tag="tag"
              aria-label="Remove tag"
              @click="emit('remove-tag', tag)"
            >×</button>
          </span>
        </div>
        <p v-else class="reference-group-empty">No tags yet.</p>
        <input
          v-model="tagDraft"
          class="reference-tag-input"
          aria-label="New tag"
          @keydown.enter="submitTag"
        >
        <button type="button" class="reference-tag-add" @click="submitTag">Add tag</button>
      </div>
      <div class="reference-group" data-group="facts">
        <div class="reference-rail-label">Facts</div>
        <div v-if="facts.length" class="reference-fact-list">
          <div v-for="(fact, factIndex) in facts" :key="factIndex" class="reference-fact">
            <span class="reference-fact-label">{{ fact.label }}</span><span class="reference-fact-value">{{ fact.value }}</span>
            <button
              type="button"
              class="reference-fact-remove"
              :data-index="factIndex"
              aria-label="Remove fact"
              @click="emit('remove-fact', factIndex)"
            >Remove</button>
          </div>
        </div>
        <p v-else class="reference-group-empty">No facts yet.</p>
        <input
          v-model="factLabelDraft"
          class="reference-fact-label-input"
          aria-label="Fact label"
          @keydown.enter="submitFact"
        >
        <input
          v-model="factValueDraft"
          class="reference-fact-value-input"
          aria-label="Fact value"
          @keydown.enter="submitFact"
        >
        <button type="button" class="reference-fact-add" @click="submitFact">Add fact</button>
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
// the definition surface and the chip rail stack in one column. The appears-in
// rows and the merge offer are the derived parts. Props and emits are the
// tests' contract, and the markup is the implementation's job.
import { computed, ref, watch, nextTick } from 'vue'
import { renderReferenceMarkdown } from '../composables/useMarkdown.js'
import { entryDisplayName } from '../composables/useReferences.js'
import { paperPalette } from '../composables/paperPalette.js'

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
  // Whether an untitled selection opens the name field on arrival. The shell
  // turns the flag off for an entry it selected rather than added, so an
  // existing untitled record still offers Edit name (S-062, S-037).
  autoNameEdit: { type: Boolean, default: true },
  // The same record NotesView resolves against, so one entry can point at
  // another (S-093).
  references: { type: Object, default: () => ({ entries: [] }) },
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
  'open-reference',
])

const hasDefinition = computed(() => (props.entry.definition || '').trim().length > 0)

// The fields default to empty arrays, so an entry record that lacks them
// renders no chips instead of a broken list.
const aliases = computed(() => props.entry.aliases || [])
const tags = computed(() => props.entry.tags || [])
const facts = computed(() => props.entry.facts || [])

// entryDisplayName in useReferences.js owns the untitled rule. This check
// mirrors it, so the field opens exactly when the heading reads Untitled.
const isUntitled = (name) => !(name || '').trim()

// The picker's choices (S-034): sections the derived mentions do not show,
// in the order the sections prop lists them.
const addableSections = computed(() => {
  const shownSectionIds = new Set(props.mentions.map((mention) => mention.sectionId))
  return props.sections.filter((section) => !shownSectionIds.has(section.id))
})

// A character appears in a section. A term or a place is used in one.
const mentionHeading = computed(() => (props.entry.kind === 'character' ? 'Appears in' : 'Used in'))

// One shared renderer, so the definition matches the note preview's markdown.
const renderedDefinition = computed(() =>
  renderReferenceMarkdown(props.entry.definition, props.references),
)

// v-html carries the anchor, so the container delegates its clicks. The
// delegation mirrors openClickedReference in NotesView.vue and reports the
// payload id to the shell.
function openClickedReference(event) {
  const link = event.target.closest('.reference-link')
  if (link) emit('open-reference', link.dataset.entryId)
}

// The page reads only the palette its root publishes (SPEC.md revision 7).
// No rule here can reach a chrome token the theme does not own.
const entryStyles = computed(() => paperPalette(props.theme))

// Only term and place swap kinds (SPEC.md 5.20). The entry's own kind renders
// as the pressed toggle of the two.
const switchableKinds = [
  { kind: 'term', label: 'Term' },
  { kind: 'place', label: 'Place' },
]
const canSwitchKind = computed(() => switchableKinds.some((item) => item.kind === props.entry.kind))

const mergeOpen = ref(false)
const editingDefinition = ref(false)
const editingName = ref(false)
const nameInput = ref(null)
const definitionDraft = ref(props.entry.definition)
const nameDraft = ref(props.entry.name)
const lastCommittedName = ref(props.entry.name)
const aliasDraft = ref('')
const tagDraft = ref('')
const factLabelDraft = ref('')
const factValueDraft = ref('')

// A refusal belongs to the name the last commit was issued for, and it
// shows only beside an open field. The page hides it once the draft moves
// off that name, so a stale refusal never lingers over a fresh edit. A
// commit refreshes lastCommittedName before it emits, so a new refusal
// shows even when its text repeats the old one.
const hasCurrentNameError = computed(
  () =>
    editingName.value &&
    props.nameError.length > 0 &&
    nameDraft.value === lastCommittedName.value,
)

// The drafts follow the shown entry, so one entry's text never opens in
// another entry's fields. The definition edit closes with every record
// update, because an open edit belongs to the entry it was opened on.
// Merge mode closes too: the survivor's target list drops the absorbed
// entry, so the old list cannot be offered.
//
// The name edit is the exception. An accepted rename echoes the saved name
// through this prop, and that echo returns the page to the heading (S-059).
// The echo closes the field only when the name changed: an unrelated record
// update must not close a field the writer did not touch.
// A refusal instead arrives as a nameError prop with the record unchanged,
// so an open edit keeps its draft beside the field.
watch(
  () => props.entry,
  (entry, previous) => {
    if (
      editingName.value &&
      previous &&
      entry.name !== previous.name &&
      entry.name === lastCommittedName.value
    ) {
      editingName.value = false
    }
    const hasEntryChanged = !previous || entry.id !== previous.id
    if (hasEntryChanged) {
      editingName.value = false
      aliasDraft.value = ''
      tagDraft.value = ''
      factLabelDraft.value = ''
      factValueDraft.value = ''
    }
    if (!editingName.value) {
      nameDraft.value = entry.name
      lastCommittedName.value = entry.name
    }
    // An untitled arrival opens naming unless the shell opted out. The
    // autoNameEdit prop comment holds the rule.
    if (hasEntryChanged && props.autoNameEdit && isUntitled(entry.name)) openNameEdit()
    definitionDraft.value = entry.definition
    editingDefinition.value = false
    mergeOpen.value = false
  },
  { immediate: true },
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

// Display-first naming (SPEC.md revision 3, S-057): the field stays closed
// until the writer asks, or the record arrives untitled (S-062). The field
// reseeds from the committed name, so a discarded draft never leaks back.
function openNameEdit() {
  nameDraft.value = props.entry.name
  editingName.value = true
  nextTick(() => nameInput.value?.focus())
}

function saveName() {
  // Saving the committed name reports nothing and just closes the edit.
  if (nameDraft.value === props.entry.name) {
    editingName.value = false
    return
  }
  // The edit stays open: the accepted rename returns through the entry prop
  // and the refusal arrives as nameError with the record unchanged. The
  // scope updates first, so a fresh refusal survives an identical text.
  lastCommittedName.value = nameDraft.value
  emit('rename', nameDraft.value)
}

function cancelNameEdit() {
  editingName.value = false
}

function submitAlias() {
  const alias = aliasDraft.value.trim()
  if (!alias) return
  emit('add-alias', alias)
  aliasDraft.value = ''
}

function submitTag() {
  const tag = tagDraft.value.trim()
  if (!tag) return
  emit('add-tag', tag)
  tagDraft.value = ''
}

function submitFact() {
  const label = factLabelDraft.value.trim()
  const value = factValueDraft.value.trim()
  if (!label && !value) return
  emit('add-fact', { label, value })
  factLabelDraft.value = ''
  factValueDraft.value = ''
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
  /* S-055 pins the reading order: naming above the definition surface, the
     metadata rail last. */
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 100%;
}

.reference-naming {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reference-entry-heading {
  margin: 0;
  font-size: 18px;
  line-height: 1.35;
  /* The heading sits on the paper surface, so it wears the theme ink that
     entryStyles publishes (S-053). */
  color: var(--note-text);
}

.reference-name,
.reference-alias-input,
.reference-tag-input,
.reference-fact-label-input,
.reference-fact-value-input {
  /* The page's field chrome: the name line and the small record rows share
     the definition source's glass. */
  font: inherit;
  font-size: 14px;
  color: var(--note-text);
  background: var(--note-field-bg, transparent);
  border: 1px solid var(--note-border, currentColor);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
}

.reference-name:focus,
.reference-alias-input:focus,
.reference-tag-input:focus,
.reference-fact-label-input:focus,
.reference-fact-value-input:focus {
  outline: none;
  border-color: var(--note-accent, currentColor);
}

.reference-name-error {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  /* The theme has no danger token, so the accent carries the refusal. */
  color: var(--note-accent, currentColor);
}

.reference-kind-switch {
  display: flex;
  gap: 6px;
}

.reference-definition {
  /* Rendered markdown prose from useMarkdown.js, same tone as the note. */
  font-size: 14px;
  line-height: 1.55;
  color: var(--note-text);
}

.reference-definition-empty {
  margin: 0;
  font-size: 13px;
  color: var(--note-text-muted, var(--note-text));
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
  color: var(--note-text);
  background: var(--note-field-bg, transparent);
  border: 1px solid var(--note-border, currentColor);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}

.reference-definition-source:focus {
  outline: none;
  border-color: var(--note-accent, currentColor);
}

.reference-save {
  align-self: flex-start;
  font: inherit;
  font-size: 12px;
  color: var(--note-text-muted, var(--note-text));
  opacity: 0.75;
  background: none;
  border: 1px solid var(--note-border, currentColor);
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  cursor: pointer;
}

.reference-save:hover {
  opacity: 1;
  color: var(--note-text);
}

/* The flex column stretches buttons across the column, so the edit and
     cancel controls pin to the start. */
.reference-definition-edit,
.reference-edit-cancel,
.reference-name-edit,
.reference-name-save,
.reference-name-cancel {
  align-self: flex-start;
}

.reference-meta {
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
  color: var(--note-text-muted, var(--note-text));
  background: var(--note-field-bg, transparent);
  border: 1px solid var(--note-border, currentColor);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
}

.reference-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.reference-group {
  /* One labelled record group. The start alignment keeps the rows
     compact beneath their label. */
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.reference-group-empty {
  margin: 0;
  font-size: 12px;
  color: var(--note-text-muted, var(--note-text));
  opacity: 0.6;
}

.reference-fact-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reference-fact {
  /* The accent bar marks one fact record, so its label and value read as a pair. */
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--note-text-muted, var(--note-text));
  border-left: 2px solid var(--note-accent, currentColor);
  padding-left: 8px;
}

.reference-fact-value {
  color: var(--note-text);
}

.reference-rail-label {
  font-size: 12px;
  color: var(--note-text-muted, var(--note-text));
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
  color: var(--note-text);
}

/* Kind toggles, name controls, rail buttons, record controls and the
     definition edit share one ghost chrome. The select keeps its native
     dropdown arrow. */
.reference-kind-toggle,
.reference-name-edit,
.reference-name-save,
.reference-name-cancel,
.reference-alias-add,
.reference-alias-remove,
.reference-tag-add,
.reference-tag-remove,
.reference-fact-add,
.reference-fact-remove,
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
  color: var(--note-text-muted, var(--note-text));
  opacity: 0.75;
  background: none;
  border: 1px solid var(--note-border, currentColor);
  border-radius: var(--radius-sm);
  padding: 3px 8px;
  cursor: pointer;
  white-space: nowrap;
}

.reference-kind-toggle:hover,
.reference-name-edit:hover,
.reference-name-save:hover,
.reference-name-cancel:hover,
.reference-alias-add:hover,
.reference-alias-remove:hover,
.reference-tag-add:hover,
.reference-tag-remove:hover,
.reference-fact-add:hover,
.reference-fact-remove:hover,
.reference-mention-add:hover,
.reference-mention-go:hover,
.reference-mention-remove:hover,
.reference-merge:hover,
.reference-merge-target:hover,
.reference-merge-cancel:hover,
.reference-definition-edit:hover,
.reference-edit-cancel:hover {
  opacity: 1;
  color: var(--note-text);
  background: var(--note-hover-bg, transparent);
}

/* The current kind stays visibly pressed, using the hover's active look. */
.reference-kind-toggle[aria-pressed='true'] {
  opacity: 1;
  color: var(--note-text);
  background: var(--note-hover-bg, transparent);
}

/* The select is a field, not a ghost control: it wears the paper chrome the
   name and definition sources use. */
.reference-mention-add {
  color: var(--note-text);
  background: var(--note-field-bg, transparent);
  border-color: var(--note-border, currentColor);
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
