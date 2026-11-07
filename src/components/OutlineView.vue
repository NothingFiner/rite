<template>
  <div class="outline-view">
    <!-- An empty document has nothing to summarize, so this branch offers no generation control. -->
    <div v-if="rows.length === 0" class="outline-empty">Nothing to outline</div>
    <div v-else-if="awaitingSummaries" class="outline-awaiting">
      <p>No summaries yet.</p>
      <button
        v-if="gateOpen"
        type="button"
        class="outline-generate"
        @click="summaries.generateSummaries()"
      >
        Generate summaries
      </button>
      <p v-else>Configure a model in General Options.</p>
    </div>
    <button
      v-for="row in rows"
      :key="row.sectionId"
      type="button"
      class="outline-row"
      :data-section-id="row.sectionId"
      @click="$emit('jump', row.sectionId)"
    >
      <div class="outline-title">{{ row.title }}</div>
      <!-- Hidden sections keep their row (5.10), so the row names its hidden state. -->
      <div v-if="row.hidden" class="outline-hidden">Hidden</div>
      <!-- Model output is labelled where the UI shows it (the rule lives in `VOCABULARY.md`). -->
      <div v-if="row.hasSummary" class="outline-summary-label">Summary</div>
      <div class="outline-summary">{{ row.summary }}</div>
      <div v-if="row.stale" class="outline-stale">Stale</div>
      <div v-if="!row.hasSummary" class="outline-no-summary">No summary yet</div>
    </button>
    <!-- Refreshing a stale summary is a generation call too, so the same gate applies. -->
    <button
      v-if="gateOpen && summaries?.summaryProgress?.stale > 0"
      type="button"
      class="outline-refresh-stale"
      @click="summaries.refreshStaleSummaries()"
    >
      Refresh stale
    </button>
  </div>
</template>

<script setup>
// The Outline tab (5.20): every section's title with its summary beside it, in
// document order. A row click only asks the app to open that section, because
// the view is read-only. Generation goes through the existing useSummaries
// triggers on the `summaries` prop. This component never invokes Tauri itself.
import { computed, onMounted } from 'vue'
import { outlineRows } from '../composables/useOutlineRows.js'
import { llmConfigured } from '../composables/useLlmSettings.js'

const props = defineProps({
  store: { type: Object, required: true },
  summaries: { type: Object, required: true },
  settings: { type: Object, default: null },
})

defineEmits(['jump'])

// `outlineRows` owns the join: the document is the source of rows, the
// summaries attach to them by section id (SPEC.md 5.20 wiring decision 4).
const rows = computed(() => outlineRows(props.store.doc, props.summaries?.summaryEntries ?? []))

// The generation gate (5.20): a configured model, never the API key. The rule
// lives in `llmConfigured` (useLlmSettings.js). The settings prop is the
// composable object, so the predicate reads its `settings` member.
const gateOpen = computed(() => llmConfigured(props.settings?.settings))

// One status read on mount answers "is anything generated?" (SPEC.md 5.20 wiring
// decision 3).
onMounted(() => {
  props.summaries?.refreshSummaryStatus?.()
})

// An empty summary store is "nothing generated yet" (5.20 trap 2), the normal
// first-run state, not an error.
const awaitingSummaries = computed(() => (props.summaries?.summaryEntries ?? []).length === 0)
</script>
