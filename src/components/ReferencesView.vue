<template>
  <div class="references-view" :style="surfaceStyles">
    <!-- Controlled tabs: the selection is App.vue's, so a click only reports
         the choice and this view renders the `tab` it is given (SPEC.md 5.20). -->
    <div class="references-tabs" role="tablist">
      <button
        type="button"
        class="references-tab"
        role="tab"
        data-tab="outline"
        :aria-selected="tab === 'outline'"
        @click="selectTab('outline')"
      >
        Outline
      </button>
      <button
        type="button"
        class="references-tab"
        role="tab"
        data-tab="notes"
        :aria-selected="tab === 'notes'"
        @click="selectTab('notes')"
      >
        Notes
      </button>
    </div>
    <OutlineView
      v-if="tab === 'outline'"
      :store="store"
      :summaries="summaries"
      :settings="settings"
      @jump="forwardJump"
    />
    <!-- An explicit null skips NotesView's prop default in Vue 3, so the two
         pass-throughs fall back to undefined and keep its 'overview'/'editor'. -->
    <NotesView
      v-else
      :store="store"
      :theme="theme"
      :initial-entry-id="notesEntryId ?? undefined"
      :origin-view="notesOriginView ?? undefined"
      @jump="forwardJump"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import OutlineView from './OutlineView.vue'
import NotesView from './NotesView.vue'

// The References view (5.20): a tab strip over the Outline and the notes.
// Controlled by `tab` so App.vue owns the selection and it survives a view
// switch.
const props = defineProps({
  store: { type: Object, required: true },
  theme: { type: Object, default: null },
  tab: { type: String, default: 'outline' },
  summaries: { type: Object, required: true },
  settings: { type: Object, default: null },
  notesEntryId: { type: String, default: null },
  notesOriginView: { type: String, default: null },
})

const emit = defineEmits(['update:tab', 'jump'])

// Binds the same two theme fields as NotesView.vue's surface style, so the
// shell and the notes tab do not flip when the writer switches tabs.
const surfaceStyles = computed(() => {
  if (!props.theme || typeof props.theme !== 'object') return {}
  return {
    backgroundColor: props.theme.bg,
    color: props.theme.text,
  }
})

function selectTab(name) {
  emit('update:tab', name)
}

// Forwards the child's jump unchanged. The tab selection is App.vue's, so the
// jump leaves it alone (SPEC.md 5.20, wiring decision 2).
function forwardJump(sectionId) {
  emit('jump', sectionId)
}
</script>

<style scoped>
.references-view {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.references-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--bg-glass-border);
}

.references-tab {
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  cursor: pointer;
  user-select: none;
  transition: color 0.15s, background 0.15s;
}

.references-tab:hover {
  color: var(--text-primary);
  background: var(--hover-bg);
}

/* Selected keeps chrome tokens: the shell binds only the theme's bg and
   text, not its accent. */
.references-tab[aria-selected='true'] {
  color: var(--text-primary);
  background: var(--glass-bg);
}
</style>
