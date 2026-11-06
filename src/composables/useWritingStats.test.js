import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import {
  useWritingStats,
  resetWritingStatsForTests,
  TARGET_KEY,
  BASELINE_KEY,
} from './useWritingStats.js'
import { useWordCount } from './useWordCount.js'

// Same shape as useSectionFormat.test.js: a real store behind the spy, so getItem
// returns what setItem wrote and a test can assert both the call and the readback.
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => { store[key] = String(value) }),
    removeItem: vi.fn((key) => { delete store[key] }),
    clear: () => { store = {} },
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// A document the real `useWordCount` can tally: it walks
// sections → paragraphs → elements → textRun.content.
function docWith(words) {
  if (!words) return { sections: [] }
  const content = Array.from({ length: words }, (_, i) => `word${i}`).join(' ')
  return { sections: [{ paragraphs: [{ elements: [{ textRun: { content } }] }] }] }
}

// Composables that call onUnmounted (useWordCount does) need a component instance,
// so mount a host and hand back what its setup returned.
function host(fn) {
  let out
  const wrapper = mount({
    setup() {
      out = fn()
      return () => null
    },
  })
  return { value: out, wrapper }
}

function statsFor(docRef, docKey = 'draft.rite') {
  return host(() => useWritingStats({ docRef, docKey })).value
}

// useWordCount debounces by 300 ms; fake timers make that deterministic.
async function typing(docRef, words, ms = 400) {
  docRef.value = docWith(words)
  await nextTick()
  vi.advanceTimersByTime(ms)
  await nextTick()
}

async function later(ms) {
  vi.advanceTimersByTime(ms)
  await nextTick()
}

beforeEach(() => {
  localStorageMock.clear()
  vi.clearAllMocks()
  resetWritingStatsForTests()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-04T12:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useWritingStats — the target', () => {
  it('S-002: should persist the daily target under rite-word-target', () => {
    const docRef = ref(docWith(0))
    const stats = statsFor(docRef)

    stats.setTarget(500)

    expect(stats.target.value).toBe(500)
    expect(TARGET_KEY).toBe('rite-word-target')
    const [key, stored] = localStorageMock.setItem.mock.calls.at(-1)
    expect(key).toBe('rite-word-target')
    expect(Number(stored)).toBe(500)
  })

  it('S-003: should load the saved target on startup', () => {
    localStorageMock.setItem(TARGET_KEY, '750')

    const stats = statsFor(ref(docWith(0)))

    expect(stats.target.value).toBe(750)
    expect(stats.hasTarget.value).toBe(true)
  })

  // Each case below pairs the rejection with a working target, so "never has a
  // target" cannot pass for "correctly ignores an unusable one".
  it('S-004: should treat a missing target as no target set', () => {
    const stats = statsFor(ref(docWith(0)))

    expect(stats.target.value).toBeNull()
    expect(stats.hasTarget.value).toBe(false)

    stats.setTarget(400)
    expect(stats.hasTarget.value).toBe(true)
  })

  it('S-004: should treat a zero target as no target set', () => {
    localStorageMock.setItem(TARGET_KEY, '0')

    const stats = statsFor(ref(docWith(0)))
    expect(stats.hasTarget.value).toBe(false)

    stats.setTarget(400)
    expect(stats.hasTarget.value).toBe(true)
  })

  it('S-004: should treat a non-numeric stored target as no target set', () => {
    localStorageMock.setItem(TARGET_KEY, 'a thousand')

    const stats = statsFor(ref(docWith(0)))
    expect(stats.hasTarget.value).toBe(false)

    stats.setTarget(400)
    expect(stats.hasTarget.value).toBe(true)
  })

  it('S-005: should refuse a negative target and leave the stored value unchanged', () => {
    localStorageMock.setItem(TARGET_KEY, '800')
    const stats = statsFor(ref(docWith(0)))

    expect(() => stats.setTarget(-5)).not.toThrow()
    expect(stats.target.value).toBe(800)
    const [key, stored] = localStorageMock.setItem.mock.calls.at(-1) ?? [null, null]
    if (key === TARGET_KEY) expect(Number(stored)).toBe(800)
  })

  it('S-005: should refuse a fractional or non-numeric target and leave the stored value unchanged', () => {
    localStorageMock.setItem(TARGET_KEY, '800')
    const stats = statsFor(ref(docWith(0)))

    stats.setTarget(2.5)
    expect(stats.target.value).toBe(800)

    stats.setTarget('lots')
    expect(stats.target.value).toBe(800)
  })
})

describe('useWritingStats — today\'s progress', () => {
  it('S-006: should count today\'s words as the document count minus the day-start count', async () => {
    // An existing manuscript: the baseline is its count at first observation, so
    // progress starts at zero rather than at the whole document.
    const docRef = ref(docWith(3))
    const stats = statsFor(docRef)
    expect(stats.baseline.value).toBe(3)
    expect(stats.writtenToday.value).toBe(0)

    await typing(docRef, 8)

    expect(stats.writtenToday.value).toBe(5)
  })

  it('S-011: should take the word count from useWordCount rather than recounting', async () => {
    const docRef = ref(docWith(0))
    const stats = statsFor(docRef)
    stats.setTarget(1000)

    await typing(docRef, 12)

    // The same source the status bar uses, asked independently.
    const authoritative = host(() => useWordCount(docRef)).value.wordCount.value
    expect(stats.baseline.value + stats.writtenToday.value).toBe(authoritative)
  })

  it('S-007: should record the day-start count once per day and not overwrite it later the same day', async () => {
    const docRef = ref(docWith(3))
    const stats = statsFor(docRef)
    expect(stats.baseline.value).toBe(3)

    await typing(docRef, 8)
    expect(stats.writtenToday.value).toBe(5)

    // A second mount is what a drawer remount looks like: same day, same document,
    // and the baseline must still be the morning's count, not the current one.
    const remounted = statsFor(docRef)
    expect(remounted.baseline.value).toBe(3)
    expect(remounted.writtenToday.value).toBe(5)
  })

  it('S-008: should keep the day-start count per document', async () => {
    const novelRef = ref(docWith(100))
    const storyRef = ref(docWith(3))

    const novel = statsFor(novelRef, 'novel.rite')
    const story = statsFor(storyRef, 'story.rite')

    expect(novel.baseline.value).toBe(100)
    expect(story.baseline.value).toBe(3)

    await typing(storyRef, 7)

    expect(story.writtenToday.value).toBe(4)
    expect(novel.writtenToday.value).toBe(0)   // untouched, not inflated by the story
  })

  it('S-009: should start a new day at zero progress when the calendar day changes', async () => {
    const docRef = ref(docWith(3))
    const stats = statsFor(docRef)
    expect(stats.writtenToday.value).toBe(0)

    await typing(docRef, 9)
    expect(stats.writtenToday.value).toBe(6)

    // Midnight passes with the app open. No reload, no new mount.
    vi.setSystemTime(new Date('2026-11-05T00:00:05'))
    await later(60 * 1000)

    expect(stats.baseline.value).toBe(9)
    expect(stats.writtenToday.value).toBe(0)

    await typing(docRef, 12)
    expect(stats.writtenToday.value).toBe(3)
  })

  it('S-010: should clamp progress at zero when the writer deletes more than they wrote today', async () => {
    const docRef = ref(docWith(3))
    const stats = statsFor(docRef)

    await typing(docRef, 8)
    expect(stats.writtenToday.value).toBe(5)

    await typing(docRef, 1)          // deleted 7, wrote 5 today

    expect(stats.writtenToday.value).toBe(0)
  })

  it('S-012: should cap the progress ratio at 1 when progress exceeds the target', async () => {
    const docRef = ref(docWith(0))
    const stats = statsFor(docRef)
    stats.setTarget(10)

    await typing(docRef, 25)

    expect(stats.writtenToday.value).toBe(25)
    expect(stats.ratio.value).toBe(1)
  })
})

describe('useWritingStats — storage shape', () => {
  it('S-007: should persist the day-start count so a reload keeps it', () => {
    const docRef = ref(docWith(4))
    statsFor(docRef)

    // Prefixed per document, so a suffix is expected; the prefix is the contract.
    const keys = localStorageMock.setItem.mock.calls.map(([key]) => key)
    expect(keys.some((key) => key.startsWith(BASELINE_KEY))).toBe(true)
  })
})
