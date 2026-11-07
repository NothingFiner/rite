<template>
  <!-- 5.20a: the References drawer. Stub: the implementer renders the rows. -->
  <div class="references-drawer"></div>
</template>

<script setup>
// The drawer lists the document (Story overview, then the manuscript under a
// chapter heading, then the Retired group) and reports a selection upward.
// The shell owns the selection and the anchor; this component only draws them.
defineProps({
  store: { type: Object, required: true },
  selectedId: { type: String, default: 'overview' },
  anchorId: { type: String, default: null },
})

defineEmits(['select'])
</script>
