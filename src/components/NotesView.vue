<template>
  <div class="notes-view">
    <div class="notes-list"></div>
    <div class="note-pane"></div>
  </div>
</template>

<script setup>
defineProps({
  // The document store. NotesView reads `store.doc` and `store.notes` and
  // commits through `store.commitNote(entryId, text)`.
  store: { type: Object, required: true },
  // The active theme (`{ bg, text, accent }`), the same object the editor
  // surface is painted with.
  theme: { type: Object, default: null },
  // Generated per-section recaps, keyed by section id: `{ [sectionId]: text }`.
  recaps: { type: Object, default: () => ({}) },
  // The entry selected when the view opens.
  initialEntryId: { type: String, default: 'overview' },
  // The text view the writer came from. The section jump returns to it.
  originView: { type: String, default: 'editor' },
})

defineEmits(['select', 'jump'])
</script>
