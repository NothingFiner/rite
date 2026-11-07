<template>
  <div class="references-view" :style="surfaceStyles">
    <!-- 5.20a: the drawer is the outline and the page is the selection. The
         drawer reports the writer's clicks. This view renders whatever entry
         the shell hands down, so a click only reports upward. -->
    <ReferencesNavDrawer
      :store="store"
      :selected-id="entryId"
      :anchor-id="anchorId"
      @select="forwardSelect"
    />
    <NotesView
      :store="store"
      :theme="theme"
      :entry-id="entryId"
      :origin-view="originView"
      :recaps="recapBySection"
      @jump="forwardJump"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import ReferencesNavDrawer from './ReferencesNavDrawer.vue'
import NotesView from './NotesView.vue'

// The References view (5.20a): the outline drawer beside the selected
// entry's note. The shell owns the selection, so the page follows the
// entryId prop and both child events relay upward unchanged.
const props = defineProps({
  store: { type: Object, required: true },
  theme: { type: Object, default: null },
  // App.vue binds summaries and settings to this view already. summaryEntries
  // feeds the recap block; the generation slot stays deferred work (SPEC.md
  // 5.20a).
  summaries: { type: Object, default: null },
  settings: { type: Object, default: null },
  entryId: { type: String, default: 'overview' },
  anchorId: { type: String, default: null },
  originView: { type: String, default: 'editor' },
})

const emit = defineEmits(['select', 'jump'])

// Binds the same theme fields as NotesView's surface style, so the shell
// and the note page do not disagree about the palette.
const surfaceStyles = computed(() => {
  if (!props.theme || typeof props.theme !== 'object') return {}
  return {
    backgroundColor: props.theme.bg,
    color: props.theme.text,
  }
})

// retrieve_summaries rows key by sectionId for NotesView's recaps prop. A row
// without a sectionId, or with a summary that is whitespace only, shows no
// recap.
const recapBySection = computed(() => {
  const summaryRows = Array.isArray(props.summaries?.summaryEntries)
    ? props.summaries.summaryEntries
    : []
  const recaps = {}
  for (const summaryRow of summaryRows) {
    const sectionId = summaryRow?.sectionId
    const summary = summaryRow?.summary
    if (!sectionId || typeof summary !== 'string' || !summary.trim()) continue
    recaps[sectionId] = summary
  }
  return recaps
})

// Both relays forward their payload unchanged. The shell owns the selection
// and the view switch.
function forwardSelect(entryId) {
  emit('select', entryId)
}

function forwardJump(sectionId) {
  emit('jump', sectionId)
}
</script>

<style scoped>
.references-view {
  min-height: 100%;
  display: flex;
  align-items: stretch;
}

/* The drawer manages its own width. The page takes the rest of the row,
   and min-width keeps long lines inside the pane's own overflow. */
.references-view > .notes-view {
  flex: 1;
  min-width: 0;
}
</style>
