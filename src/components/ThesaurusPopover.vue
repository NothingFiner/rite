<template>
  <!-- Stub: the markup contract lives in SPEC.md; the real template is the
       implementation's to write. -->
</template>

<script setup>
// The thesaurus popover (roadmap 5.11, SPEC.md S-022 … S-030).
//
// Marking a synonym only marks it. The document changes on OK and on nothing
// else: Cancel, Escape and a click outside are always a no-op.
defineProps({
  visible: { type: Boolean, default: false },
  // The word exactly as it appears in the document ("Happy,"), so the
  // replacement can keep its leading capital and trailing punctuation.
  word: { type: String, default: '' },
  // One group per WordNet sense: { partOfSpeech, senseNumber, gloss, synonyms,
  // antonyms }.
  senses: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  // The click point, in viewport pixels.
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
})

defineEmits(['apply', 'cancel'])
</script>
