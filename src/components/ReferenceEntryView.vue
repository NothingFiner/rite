<template>
  <div class="reference-entry-view"></div>
</template>

<script setup>
// The detail page for one reference entry (SPEC.md 5.19a): the definition, the
// aliases/tags/facts, and the derived appears-in list. Props and emits are the
// tests' contract; the markup is the implementation's job.

defineProps({
  entry: { type: Object, required: true },
  mentions: { type: Array, default: () => [] },
})

defineEmits([
  'save-definition',
  'remove-mention',
  'include-section',
  'merge',
  'jump',
])
</script>
