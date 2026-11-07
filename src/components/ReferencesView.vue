<template>
  <div class="references-view"></div>
</template>

<script setup>
// The References view (5.20): a tab strip over the Outline and the notes.
// Controlled by `tab` so App.vue owns the selection and it survives a view
// switch.
defineProps({
  store: { type: Object, required: true },
  theme: { type: Object, default: null },
  tab: { type: String, default: 'outline' },
  notesEntryId: { type: String, default: null },
  notesOriginView: { type: String, default: null },
})

defineEmits(['update:tab', 'jump'])
</script>
