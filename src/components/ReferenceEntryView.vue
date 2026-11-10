<template>
  <div class="reference-entry-view">
    <div class="reference-definition-column">
      <h2 class="reference-entry-heading">{{ entryDisplayName(entry) }}</h2>
      <!-- renameEntry in useReferences.js validates the name on commit. The
           field reports it as entered (S-027). -->
      <input
        v-model="nameDraft"
        class="reference-name"
        aria-label="Entry name"
        @blur="commitName"
        @keydown.enter.prevent="commitName"
        @input="isNameTouched = true"
      />
      <p v-if="nameError && !isNameTouched" class="reference-name-error">{{ nameError }}</p>
      <!-- The switch reports the pick. The shell applies it, like the merge
           offer does. -->
      <div v-if="isKindSwitchable" class="reference-kind-row" role="group" aria-label="Entry kind">
        <button
          v-for="kind in switchableKinds"
          :key="kind"
          type="button"
          class="reference-kind-toggle"
          :class="{ selected: entry.kind === kind }"
          :data-kind="kind"
          :aria-pressed="entry.kind === kind"
          @click="emit('kind-change', kind)"
        >{{ kind }}</button>
      </div>
      <!-- A defined entry reads as prose until the writer edits it. The
           rendered surface and the source field swap in place, so the two
           never show together (SPEC.md 5.19a, S-008, S-030). -->
      <div
        v-if="hasDefinition && !isDefinitionEditing"
        class="reference-definition"
        v-html="renderedDefinition"
      ></div>
      <button
        v-if="hasDefinition && !isDefinitionEditing"
        type="button"
        class="reference-definition-edit"
        @click="openDefinitionEdit"
      >Edit definition</button>
      <template v-if="!hasDefinition || isDefinitionEditing">
        <p v-if="!hasDefinition" class="reference-definition-empty">No definition yet.</p>
        <!-- The draft is a local ref, so editing never mutates the entry prop.
             The writer commits it through save-definition. -->
        <textarea
          v-model="definitionDraft"
          class="reference-definition-source"
          aria-label="Definition source"
        ></textarea>
        <button type="button" class="reference-save" @click="saveDefinition">Save definition</button>
        <button
          v-if="isDefinitionEditing"
          type="button"
          class="reference-edit-cancel"
          @click="cancelDefinitionEdit"
        >Cancel edit</button>
      </template>
    </div>
    <!-- The rail mounts while it has content, and pickable sections qualify
         as content. One grid cell keeps the groups from wandering. -->
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
      <!-- Where the entry shows up in the manuscript, scanned at read time:
           the rows are derived, so each action reports to the shell. -->
      <div v-if="mentions.length" class="reference-mentions">
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
            title="Remove mention"
            aria-label="Remove mention"
            @click="emit('remove-mention', mention.sectionId)"
          >Remove</button>
        </div>
      </div>
      <select
        v-if="pickableSections.length"
        class="reference-mention-add"
        aria-label="Add section"
        @change="includePickedSection"
      >
        <option value="" disabled>Pick a section…</option>
        <option
          v-for="section in pickableSections"
          :key="section.id"
          class="reference-section-option"
          :value="section.id"
          :data-section-id="section.id"
        >{{ section.title }}</option>
      </select>
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
// The detail page for one reference entry (SPEC.md 5.19a). The definition
// surface and the chip rail are pinned. The appears-in rows and the merge
// offer are the derived parts. Props and emits are the tests' contract, and
// the markup is the implementation's job.
import { computed, ref, watch } from 'vue'
import { renderMarkdown } from '../composables/useMarkdown.js'
import { entryDisplayName } from '../composables/useReferences.js'

const props = defineProps({
  entry: { type: Object, required: true },
  // This entry's appears-in rows (5.19a): the parent derives them from the
  // manuscript. A row's remove button reports remove-mention to the parent.
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

// Shown means this entry has an appears-in row in the section. Excluded
// sections carry no row, so they stay offered and the shell clears the
// exclusion on include-section.
const pickableSections = computed(() => {
  const shownSectionIds = new Set(props.mentions.map((mention) => mention.sectionId))
  return props.sections.filter((section) => !shownSectionIds.has(section.id))
})

const hasRail = computed(
  () =>
    hasMeta.value ||
    props.mentions.length > 0 ||
    props.mergeTargets.length > 0 ||
    pickableSections.value.length > 0,
)

// A character appears in a section. A term or a place is used in one.
const mentionHeading = computed(() => (props.entry.kind === 'character' ? 'Appears in' : 'Used in'))

// One shared renderer, so the definition matches the note preview's markdown.
const renderedDefinition = computed(() => renderMarkdown(props.entry.definition))

// Only a term and a place switch kind. A character would move to another
// surface if its kind changed, so it gets no switch (S-047). setEntryKind in
// useReferences.js owns the refusal and the record change.
const switchableKinds = ['term', 'place']
const isKindSwitchable = computed(() => switchableKinds.includes(props.entry.kind))

const mergeOpen = ref(false)
const isDefinitionEditing = ref(false)
const definitionDraft = ref(props.entry.definition)
const nameDraft = ref(props.entry.name)
// Editing the field hides a stale refusal (SPEC.md DOM contract). The resets
// in commitName and the entry watcher keep a fresh refusal showing after a
// commit or an entry swap.
const isNameTouched = ref(false)

// The draft follows the shown entry, so one entry's text never opens in
// another entry's empty state. Merge mode closes with it: the survivor's
// target list drops the absorbed entry, so the old list cannot be offered.
// The open edit closes and the touched flag resets with it.
watch(
  () => props.entry,
  (entry) => {
    definitionDraft.value = entry.definition
    nameDraft.value = entry.name
    mergeOpen.value = false
    isDefinitionEditing.value = false
    isNameTouched.value = false
  },
)

// The draft tracks the entry, so the source opens holding the committed text.
function openDefinitionEdit() {
  isDefinitionEditing.value = true
}

// A cancelled edit restores the draft, so reopening shows the committed text.
function cancelDefinitionEdit() {
  isDefinitionEditing.value = false
  definitionDraft.value = props.entry.definition
}

function saveDefinition() {
  emit('save-definition', definitionDraft.value)
}

function commitName() {
  isNameTouched.value = false
  emit('rename', nameDraft.value)
}

// App.vue swaps the record and moves the selection to the survivor. This
// view only reports the choice.
function chooseMerge(targetId) {
  emit('merge', targetId)
}

// The picker returns to the placeholder, so the next pick fires a fresh change.
function includePickedSection(event) {
  const sectionId = event.target.value
  if (!sectionId) return
  emit('include-section', sectionId)
  event.target.value = ''
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

.reference-entry-heading {
  margin: 0;
  font-size: 18px;
  line-height: 1.3;
  color: var(--text-primary);
}

.reference-name {
  font: inherit;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  width: 100%;
}

.reference-name:focus {
  outline: none;
  border-color: var(--accent);
}

.reference-name-error {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  /* Same red as .ai-error in GeneralOptionsDrawer.vue. */
  color: #e88;
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

.reference-save,
.reference-definition-edit,
.reference-edit-cancel {
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

.reference-save:hover,
.reference-definition-edit:hover,
.reference-edit-cancel:hover {
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

/* Rail controls reuse the definition save button's chrome. */
.reference-mention-go,
.reference-mention-remove,
.reference-merge,
.reference-merge-target,
.reference-merge-cancel,
.reference-kind-toggle {
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

.reference-mention-go:hover,
.reference-mention-remove:hover,
.reference-merge:hover,
.reference-merge-target:hover,
.reference-merge-cancel:hover,
.reference-kind-toggle:hover {
  opacity: 1;
  color: var(--text-primary);
  background: var(--hover-bg);
}

/* The select shares the name field's surface at rail scale. */
.reference-mention-add {
  font: inherit;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm);
  padding: 3px 8px;
}

.reference-mention-add:focus {
  outline: none;
  border-color: var(--accent);
}

.reference-merge-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.reference-merge-target {
  text-align: left;
}

.reference-kind-row {
  align-self: flex-start;
  display: flex;
  gap: 6px;
}

/* Kind names are lowercase values, so the label reads like a noun. */
.reference-kind-toggle {
  text-transform: capitalize;
}

/* The accent border marks the kind the entry already has. */
.reference-kind-toggle.selected {
  opacity: 1;
  color: var(--text-primary);
  border-color: var(--accent);
}
</style>
