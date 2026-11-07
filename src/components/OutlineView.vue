<template>
  <div class="outline-view">
    <button
      v-for="row in rows"
      :key="row.sectionId"
      type="button"
      class="outline-row"
      :data-section-id="row.sectionId"
      @click="$emit('jump', row.sectionId)"
    >
      <div class="outline-title">{{ row.title }}</div>
      <div class="outline-summary">{{ row.summary }}</div>
      <div v-if="!row.hasSummary" class="outline-no-summary">No summary yet</div>
    </button>
  </div>
</template>

<script setup>
// The Outline tab (5.20): every section's title with its summary beside it, in
// document order. A row click only asks the app to open that section, because
// the view is read-only. Generation goes through the existing useSummaries
// triggers on the `summaries` prop. This component never invokes Tauri itself.
import { computed } from 'vue'
import { outlineRows } from '../composables/useOutlineRows.js'

const props = defineProps({
  store: { type: Object, required: true },
  summaries: { type: Object, required: true },
  settings: { type: Object, default: null },
})

defineEmits(['jump'])

// `outlineRows` owns the join: the document is the source of rows, the
// summaries attach to them by section id (SPEC.md 5.20 wiring decision 4).
const rows = computed(() => outlineRows(props.store.doc, props.summaries?.summaryEntries ?? []))
</script>
