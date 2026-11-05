import { ref, computed, watch, onUnmounted } from 'vue'
import { useWordCount } from './useWordCount.js'

/// A daily word target and today's progress against it.
///
/// "Session" means CALENDAR DAY, not launch->quit and not an idle-delimited
/// stretch: this is a macOS app, so launch->quit sessions never end (the
/// number would grow unbounded, and a crash or force-quit would wipe it), and
/// an idle-delimited session is farmable — stop for lunch, target met twice.
/// A calendar day is how a writer already thinks about a daily word goal.
///
/// The target is app-global (localStorage, like every other preference
/// rite-*); the day-start baseline is per document, because localStorage is
/// shared by every manuscript — without per-document keys, switching from a
/// novel to a story would zero or inflate today's progress.

export const TARGET_KEY = 'rite-word-target'
export const BASELINE_KEY = 'rite-word-baseline'

// Poll 30s so an app left open overnight re-baselines at midnight without a
// reload; 15–60s is a cheap enough tick and the worst case is one number that
// flips a few minutes into the new day.
const DAY_CHECK_INTERVAL_MS = 30_000

/// Drop any state cached at module scope. Tests call this between cases.
/// There is nothing to drop — localStorage is the store and every ref lives in
/// the composable's invocation — but the export stays because the tests call
/// it between cases as part of the contract.
export function resetWritingStatsForTests() {}

// Local calendar day as YYYY-MM-DD. toISOString would apply UTC's shift, so
// late-evening or just-after-midnight writing would land on the wrong day for
// half the world's timezones; a writing day is the writer's own wall clock.
function dayKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const dayOfMonth = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${dayOfMonth}`
}

// The baseline's key carries the docKey as a suffix (the BASELINE_KEY prefix
// is the contract) so each manuscript owns its own day-start count.
function baselineStorageKey(docKey) {
  return `${BASELINE_KEY}:${docKey ?? ''}`
}

// Stored as JSON so the day and the count travel in one value; anything that
// does not parse back to {date, finite count} is treated as "no baseline yet".
function readBaseline(docKey) {
  let raw = null
  try {
    raw = window.localStorage.getItem(baselineStorageKey(docKey))
  } catch (error) {
    console.warn(`useWritingStats: reading the day-start baseline (${baselineStorageKey(docKey)}) from localStorage failed, treating it as none`, error)
    return null
  }
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.date === 'string' && typeof parsed.count === 'number' && Number.isFinite(parsed.count)) {
      return parsed
    }
  } catch (error) {
    console.warn(`useWritingStats: the stored baseline for "${docKey}" is not parseable JSON, re-baselining the day`, error)
  }
  return null
}

// App-global target, like every other preference. No value, 0, and anything
// non-numeric all mean "no target set" — an unset preference is a state, not
// an error.
function readTarget() {
  let raw = null
  try {
    raw = window.localStorage.getItem(TARGET_KEY)
  } catch (error) {
    console.warn(`useWritingStats: reading ${TARGET_KEY} from localStorage failed, treating it as no target`, error)
    return null
  }
  const parsed = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function useWritingStats(options = {}) {
  const { docRef, docKey, now = () => new Date() } = options

  // The word count comes from useWordCount — the same source the status bar
  // uses — so the two can never disagree, and the O(document) tally is not
  // run a second time per keystroke here.
  const { wordCount } = useWordCount(docRef)

  const target = ref(readTarget())
  const baseline = ref(0)

  // The baseline is the count as THIS calendar day began. The first
  // observation of this document today (no stored baseline, or one from an
  // earlier day) records the count the document has right now — useWordCount
  // counted synchronously at setup, so it is real, not 0 — and stores it
  // once. Any baseline already stored for today always wins, which is what
  // keeps later typing and a same-day remount from moving it.
  function ensureBaseline() {
    const day = dayKey(now())
    const stored = readBaseline(docKey)
    if (stored && stored.date === day) {
      baseline.value = stored.count
      return
    }
    baseline.value = wordCount.value
    try {
      window.localStorage.setItem(baselineStorageKey(docKey), JSON.stringify({ date: day, count: baseline.value }))
    } catch (error) {
      // Today's progress still tracks in memory after a failed write, so log
      // with context and carry on rather than throwing out of setup.
      console.warn(`useWritingStats: storing the day-start baseline (${baselineStorageKey(docKey)}) failed`, error)
    }
  }

  ensureBaseline()

  // The clock must tick toward a new day without a reload even while the
  // writer reads (no keystrokes, so no wordCount changes to react to), hence
  // the interval beside the watch below.
  const dayCheckTimer = setInterval(ensureBaseline, DAY_CHECK_INTERVAL_MS)
  onUnmounted(() => {
    clearInterval(dayCheckTimer)
  })

  // A keystroke that lands just after midnight should re-baseline on the
  // spot instead of waiting for the next interval tick.
  watch(wordCount, ensureBaseline)

  // Only a real, finite, whole number >= 1 is a target; anything else leaves
  // both the stored value and the exposed target untouched. Never throws —
  // a garbage input in a text field must not break the drawer.
  function setTarget(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) return
    try {
      window.localStorage.setItem(TARGET_KEY, String(value))
    } catch (error) {
      // The in-memory target below still drives this session's bar, so log
      // with context instead of failing the commit.
      console.warn(`useWritingStats: persisting the daily target (${TARGET_KEY}) failed`, error)
    }
    target.value = value
  }

  const hasTarget = computed(() => target.value !== null && Number.isFinite(target.value) && target.value > 0)
  // Deleting more than was written today clamps at zero, never goes negative.
  const writtenToday = computed(() => Math.max(0, wordCount.value - baseline.value))
  // The ratio drives the bar: capped at 1 so overshooting the target saturates
  // the fill rather than overflowing it.
  const ratio = computed(() => (hasTarget.value ? Math.min(1, writtenToday.value / target.value) : 0))

  return { target, setTarget, baseline, writtenToday, hasTarget, ratio }
}
