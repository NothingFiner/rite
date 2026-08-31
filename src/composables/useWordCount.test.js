import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { useWordCount } from './useWordCount.js'

// Build a one-section document whose single section has one paragraph per
// given text string. Mirrors the Document model shape (sections → paragraphs →
// elements → textRun.content) without pulling in the id generators.
function makeDoc(...paragraphTexts) {
  return {
    sections: [
      {
        paragraphs: paragraphTexts.map((text) => ({
          elements: [{ textRun: { content: text } }],
        })),
      },
    ],
  }
}

describe('useWordCount', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('tallies words across all paragraphs via recompute', () => {
    const doc = ref(makeDoc('hello world', 'one two three', ''))
    const { wordCount, recompute } = useWordCount(doc)
    recompute()
    expect(wordCount.value).toBe(5)
  })

  it('handles an empty document', () => {
    const doc = ref({ sections: [] })
    const { wordCount, recompute } = useWordCount(doc)
    recompute()
    expect(wordCount.value).toBe(0)
  })

  it('handles a null document', () => {
    const doc = ref(null)
    const { wordCount, recompute } = useWordCount(doc)
    recompute()
    expect(wordCount.value).toBe(0)
  })

  it('counts words across multiple sections', () => {
    const doc = ref({
      sections: [
        { paragraphs: [{ elements: [{ textRun: { content: 'a b' } }] }] },
        { paragraphs: [{ elements: [{ textRun: { content: 'c d e' } }] }] },
      ],
    })
    const { wordCount, recompute } = useWordCount(doc)
    recompute()
    expect(wordCount.value).toBe(5)
  })

  it('populates the count synchronously on setup (no 0→count blink)', () => {
    // The initial count is computed at setup, NOT debounced — there is no
    // keystroke stream to coalesce on first run, so the first paint shows the
    // real number. This is what kills the manuscript title-page "0 words"
    // blink on view switch.
    const doc = ref(makeDoc('hello world foo'))
    const { wordCount } = useWordCount(doc)
    expect(wordCount.value).toBe(3)
  })

  it('debounces subsequent changes (coalesces a typing burst)', async () => {
    const doc = ref(makeDoc('hello world foo'))
    const { wordCount } = useWordCount(doc)
    expect(wordCount.value).toBe(3)

    // A burst of edits: change the sections several times in quick succession.
    // The count must NOT re-tally per change — it coalesces into one recompute
    // DEBOUNCE_MS after the burst stops.
    doc.value = makeDoc('hello world foo bar baz qux')
    // Vue's watcher flushes on a microtask (not a timer), so let it run and
    // schedule the debounced recompute before we advance fake timers.
    await nextTick()
    expect(wordCount.value).toBe(3) // still the old count — debounce pending

    vi.advanceTimersByTime(299)
    expect(wordCount.value).toBe(3) // not yet

    vi.advanceTimersByTime(1)
    expect(wordCount.value).toBe(6)
  })
})