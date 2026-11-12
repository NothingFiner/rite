<template>
  <div class="references-view" :style="surfaceStyles">
    <!-- A reference surface shows the selected entry's page (5.19a). The
         shell owns record, selection and derived mentions. The page renders
         them and reports naming, definition and mention edits back up. -->
    <ReferenceEntryView
      v-if="shownEntry"
      :entry="shownEntry"
      :mentions="entryMentions"
      :merge-targets="mergeTargets"
      :sections="sections"
      @save-definition="emit('save-definition', $event)"
      @merge="emit('merge', $event)"
      @rename="emit('rename', $event)"
      @remove-mention="emit('remove-mention', $event)"
      @include-section="emit('include-section', $event)"
      @jump="forwardJump"
    />
    <!-- A reference surface with no selection waits for a row click, which
         the drawer reports. It never falls back to the notes page, so the
         two surfaces cannot be mistaken for one another. -->
    <p v-else-if="isReferenceSurface" class="reference-page-empty">Choose an entry in the drawer.</p>
    <!-- The outline surface keeps the shipped notes page (SPEC.md 5.20a). -->
    <NotesView
      v-else
      :store="store"
      :theme="theme"
      :entry-id="entryId"
      :origin-view="originView"
      :recaps="recaps"
      :summaries="summaries"
      :settings="settings"
      @jump="forwardJump"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import NotesView from './NotesView.vue'
import ReferenceEntryView from './ReferenceEntryView.vue'

// The References view (SPEC.md 5.20a and 5.19a). The selection lives in the
// shell, so every interaction here is a prop or an emitted event and nothing
// navigates from this view. The rendered branch depends on the surface.
const props = defineProps({
  store: { type: Object, required: true },
  theme: { type: Object, default: null },
  summaries: { type: Object, required: true },
  settings: { type: Object, default: null },
  entryId: { type: String, default: 'overview' },
  // Forwarded to the detail page's jump target. The shell seeds this on
  // entering References. See onSetMode in App.vue.
  originView: { type: String, default: 'editor' },
  // The drawer surface the shell holds (5.19a): outline, characters or
  // glossary. Only a non-outline surface shows the references record.
  surface: { type: String, default: 'outline' },
  // The references record (5.19a). Entries are authored source beside the
  // notes. Where an entry appears is derived and never stored on it.
  references: { type: Object, default: () => ({ entries: [] }) },
  // The selected reference entry, owned by the shell the way entryId is.
  selectedEntryId: { type: String, default: '' },
  // The manuscript sections, forwarded so the entry page's appears-in
  // picker keeps the whole list. The shell derives them from the doc.
  sections: { type: Array, default: () => [] },
  // Where each entry appears, scanned by the shell and keyed by entry id.
  mentions: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['jump', 'save-definition', 'merge', 'rename', 'remove-mention', 'include-section'])

// Binds the same two theme fields NotesView.vue's surface binds, so the
// shell and the notes page read as one surface without a colour seam.
const surfaceStyles = computed(() => {
  if (!props.theme || typeof props.theme !== 'object') return {}
  return {
    backgroundColor: props.theme.bg,
    color: props.theme.text,
  }
})

// NotesView.vue owns the recaps shape. The summaries store holds an entry
// list, so this computed bridges the two into a map of sectionId to text.
// The trim drops unsummarized sections from the map.
const recaps = computed(() => {
  const recapMap = {}
  for (const entry of props.summaries?.summaryEntries ?? []) {
    const recapText = (entry.summary ?? '').trim()
    if (!recapText) continue
    recapMap[entry.sectionId] = recapText
  }
  return recapMap
})

// Only Characters and Glossary list the references record (5.19a).
const isReferenceSurface = computed(
  () => props.surface === 'characters' || props.surface === 'glossary',
)

// The page follows the shell's selection, not a local state. A dropped
// selection falls back to the pending-entry placeholder, never to the notes
// page.
const shownEntry = computed(() => {
  if (!isReferenceSurface.value || !props.selectedEntryId) return null
  const entries = Array.isArray(props.references?.entries) ? props.references.entries : []
  return entries.find((entry) => entry.id === props.selectedEntryId) ?? null
})

// The shown entry's appears-in rows, from the shell's derived map.
const entryMentions = computed(() => props.mentions?.[props.selectedEntryId] ?? [])

// A merge keeps whichever entry absorbs the rest, so the writer names the
// survivor. The candidates are the rest of the record.
const mergeTargets = computed(() => {
  if (!shownEntry.value) return []
  const entries = Array.isArray(props.references?.entries) ? props.references.entries : []
  return entries.filter((entry) => entry.id !== shownEntry.value.id)
})

// A jump is always a section id. The notes page and the entry page both
// report one, and the shell handles the view switch.
function forwardJump(sectionId) {
  emit('jump', sectionId)
}
</script>

<style scoped>
/* `min-height: 100%` alone leaves the view one content-height tall: the wrapper
 * it sits in has no definite height, so the percentage resolves to auto and the
 * theme surface stops where the note text stops — a paper strip at the top and
 * the canvas colour underneath. As a flex item it can grow into the wrapper
 * instead, which is what makes the page fill the pane. */
.references-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.reference-page-empty {
  margin: 0;
  padding: 20px 12px;
  font-size: 13px;
  color: var(--text-secondary);
  opacity: 0.6;
  text-align: center;
}
</style>
