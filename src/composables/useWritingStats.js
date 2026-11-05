import { computed, ref } from 'vue'

/// STUB. The contract is fixed by `useWritingStats.test.js`; this file has shape
/// only, no behaviour. Fill it in — see SPEC.md ("The composable contract").
///
/// A daily word target and today's progress against it. "Session" means calendar
/// day: see SPEC.md for why launch->quit and idle-delimited stretches were both
/// rejected.

export const TARGET_KEY = 'rite-word-target'
export const BASELINE_KEY = 'rite-word-baseline'

/// Drop any state cached at module scope. Tests call this between cases.
export function resetWritingStatsForTests() {}

export function useWritingStats(options = {}) {
  return {
    target: ref(null),
    setTarget() {},
    baseline: ref(0),
    writtenToday: computed(() => 0),
    hasTarget: computed(() => false),
    ratio: computed(() => 0),
  }
}
