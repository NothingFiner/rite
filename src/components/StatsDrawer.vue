<!--
  STUB. Props and emits are the contract fixed by `StatsDrawer.spec.js`; the
  template is empty until it is filled in. See SPEC.md ("Component contract").

  The daily word target, the input that sets it, and a bar of today's progress.
-->
<template>
  <div class="stats-drawer" />
</template>

<script setup>
defineProps({
  written: { type: Number, default: 0 },
  target: { type: Number, default: null },
})

const emit = defineEmits(['set-target'])
</script>

<style scoped>
.stats-drawer {
  padding: 12px;
}
</style>
