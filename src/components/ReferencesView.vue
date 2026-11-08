<template>
  <div class="references-view" :style="surfaceStyles">
    <!-- The page is the selection (SPEC.md 5.20a). The shell owns the entry
         through entryId, so this view renders one detail page for it. -->
    <NotesView
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

// The References view (SPEC.md 5.20a): one detail page for the entry the
// shell selects. Nothing navigates from here. The drawer selects rows.
const props = defineProps({
  store: { type: Object, required: true },
  theme: { type: Object, default: null },
  summaries: { type: Object, required: true },
  settings: { type: Object, default: null },
  entryId: { type: String, default: 'overview' },
  // Forwarded to the detail page's jump target. The shell seeds this on
  // entering References. See onSetMode in App.vue.
  originView: { type: String, default: 'editor' },
})

const emit = defineEmits(['jump'])

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

// Forwards NotesView's jump unchanged. The selection stays the shell's, so
// the jump reports the section and the shell handles the view switch.
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
</style>
