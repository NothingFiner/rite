<!--
  The writing-stats drawer: today's progress bar against the daily word
  target (or a prompt to set one), plus the field that sets it. The finished
  numbers arrive as props from useWritingStats; the drawer stays a view and
  only emits 'set-target' back out.
-->
<template>
  <div class="stats-drawer">
    <!-- role="img": the bar is a drawing, so its meaning must be in text.
         The label carries the REAL counts even when the fill is capped — a
         writer at 1500 of 1000 reads "1500 written of 1000", not the bar's
         100%. -->
    <div
      v-if="hasTarget"
      class="stats-graph"
      role="img"
      :aria-label="graphLabel"
    >
      <div class="stats-bar">
        <div class="stats-bar-fill" :style="{ width: fillPercent + '%' }" />
      </div>
      <p class="stats-caption">{{ written }} of {{ target }} words today</p>
    </div>

    <p v-else class="stats-empty">Set a daily word target</p>

    <label class="stats-target-field">
      <span class="stats-field-label">Daily word target</span>
      <input
        class="stats-target-input"
        type="number"
        min="1"
        step="1"
        placeholder="e.g. 1000"
        :value="target ?? ''"
        @keydown.enter="commitTarget"
      />
    </label>
  </div>
</template>

<script setup>
import { computed } from 'vue'

// Props/emits are the contract fixed by StatsDrawer.spec.js — keep the
// declarations exactly as delivered.
const props = defineProps({
  written: { type: Number, default: 0 },
  target: { type: Number, default: null },
})

const emit = defineEmits(['set-target'])

// Same rule as the composable: 0 (or anything non-positive) counts as "none
// set", and the drawer must not attempt to draw a divide-by-zero bar.
const hasTarget = computed(() => typeof props.target === 'number' && Number.isFinite(props.target) && props.target > 0)

// Round to 0.1% so a ratio that lands a hair under a step (24.999999…% float
// noise) still reads as a clean width, then cap at 100% so overshooting the
// target saturates the bar instead of overflowing it.
const fillPercent = computed(() => {
  if (!hasTarget.value) return 0
  const scaled = Math.round((props.written / props.target) * 1000) / 10
  return Math.min(100, scaled)
})

const graphLabel = computed(() => `${props.written} written of ${props.target}`)

// Enter commits the draft. Only a whole number >= 1 is accepted — the same
// rule useWritingStats.setTarget enforces, so the drawer never emits a value
// the target would refuse. An empty or unparseable draft is left in the field
// (the writer fixes it) and simply not sent; nothing to throw, and the bad
// text staying visible is the feedback.
function commitTarget(event) {
  const raw = String(event.target.value ?? '').trim()
  const parsed = Number(raw)
  const valid = raw !== '' && Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 1
  if (!valid) return
  emit('set-target', parsed)
  event.target.value = ''
}
</script>

<style scoped>
.stats-drawer {
  padding: 12px;
  font-size: 13px;
  color: var(--text-primary);
}

.stats-graph {
  margin-bottom: 14px;
}

.stats-caption {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.stats-empty {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--text-secondary);
}

.stats-bar {
  height: 8px;
  overflow: hidden;
  background: var(--hover-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm);
}

.stats-bar-fill {
  height: 100%;
  background: var(--accent);
}

.stats-target-field {
  display: block;
}

.stats-field-label {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.stats-target-input {
  width: 100%;
  background: var(--input-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: 6px;
  padding: 6px 8px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}

.stats-target-input:focus {
  border-color: var(--accent);
}
</style>
