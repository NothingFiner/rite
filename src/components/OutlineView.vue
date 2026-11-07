<template>
  <div class="outline-view"></div>
</template>

<script setup>
// The Outline tab (5.20): every section's title with its summary beside it, in
// document order. A row click only asks the app to open that section, because
// the view is read-only. Generation goes through the existing useSummaries
// triggers on the `summaries` prop. This component never invokes Tauri itself.
defineProps({
  store: { type: Object, required: true },
  summaries: { type: Object, required: true },
  settings: { type: Object, default: null },
})

defineEmits(['jump'])
</script>
