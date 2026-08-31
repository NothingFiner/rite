import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
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

  it('populates the count after the debounce window on setup', () => {
    // The watcher is created with `immediate: true`, so its callback runs
    // synchronously at setup and schedules the debounced recompute. Advancing
    // fake timers past DEBOUNCE_MS fires it.
    const doc = ref(makeDoc('hello world foo'))
    const { wordCount } = useWordCount(doc)
    expect(wordCount.value).toBe(0) // not yet — debounce pending
    vi.advanceTimersByTime(300)
    expect(wordCount.value).toBe(3)
  })
})