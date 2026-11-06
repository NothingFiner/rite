import { describe, it, expect } from 'vitest'
import { calculateBreaksFromHeights, assembleGlobalBreaks } from './usePagination.js'

// Blocks now carry a `kind` ('section-title' | 'paragraph'). The break rule:
// force a page break before a section-title whenever the page already has
// content (currentHeight > 0), replacing the old isHeading(paragraphStyle) rule.
function paraBlock() {
  return { kind: 'paragraph', sectionId: 's', paragraphId: 'p', paragraph: { id: 'p', elements: [] } }
}
function titleBlock(sectionType = 'section') {
  return { kind: 'section-title', sectionId: 's', sectionType, title: '', chapterIndex: null }
}

const CONTENT_HEIGHT = 768

describe('usePagination', () => {
  describe('calculateBreaksFromHeights', () => {
    it('returns empty for no blocks', () => {
      expect(calculateBreaksFromHeights([], [], CONTENT_HEIGHT)).toEqual([])
    })

    it('returns empty when all fit on one page', () => {
      const blocks = [paraBlock(), paraBlock(), paraBlock()]
      const heights = [100, 100, 100]
      expect(calculateBreaksFromHeights(heights, blocks, CONTENT_HEIGHT)).toEqual([])
    })

    it('breaks when content exceeds page height', () => {
      const blocks = Array.from({ length: 10 }, () => paraBlock())
      const heights = Array(10).fill(100)
      // 100 * 7 = 700; at index 7, 700 + 100 = 800 > 768, so break at index 7
      expect(calculateBreaksFromHeights(heights, blocks, CONTENT_HEIGHT)).toEqual([7])
    })

    it('breaks before a section-title when the page already has content', () => {
      const blocks = [paraBlock(), titleBlock(), paraBlock()]
      const heights = [100, 50, 100]
      // Section-title at index 1 forces a break because currentHeight (100) > 0
      expect(calculateBreaksFromHeights(heights, blocks, CONTENT_HEIGHT)).toEqual([1])
    })

    it('does not break before a section-title that starts the document', () => {
      const blocks = [titleBlock(), paraBlock()]
      const heights = [50, 100]
      expect(calculateBreaksFromHeights(heights, blocks, CONTENT_HEIGHT)).toEqual([])
    })

    it('breaks on both a section-title and overflow', () => {
      const blocks = [
        paraBlock(),
        titleBlock(),
        ...Array.from({ length: 10 }, () => paraBlock()),
      ]
      const heights = [100, 50, ...Array(10).fill(100)]
      // Break at the section-title (1), then break again when overflow hits
      expect(calculateBreaksFromHeights(heights, blocks, CONTENT_HEIGHT)).toEqual([1, 9])
    })

    it('treats chapter and section titles identically for breaking', () => {
      const blocks = [paraBlock(), titleBlock('chapter'), paraBlock()]
      const heights = [100, 50, 100]
      expect(calculateBreaksFromHeights(heights, blocks, CONTENT_HEIGHT)).toEqual([1])
    })

    it('still forces the break at a ZERO-HEIGHT hidden title when content precedes it (5.10)', () => {
      // A hidden section's manuscript heading is an empty `.ms-para` that
      // measures height 0 — but the break rule reads `currentHeight` (the
      // content accumulated BEFORE the title), so the hidden section still
      // starts its own page. Guard: this is why the hidden heading renders as
      // an empty element instead of being omitted (dropping it would shift
      // every later positional height measurement).
      const blocks = [paraBlock(), { ...titleBlock(), hidden: true }, paraBlock()]
      const heights = [100, 0, 100]
      expect(calculateBreaksFromHeights(heights, blocks, CONTENT_HEIGHT)).toEqual([1])
    })

    it('breaks when a single block exceeds page height', () => {
      const blocks = [paraBlock(), paraBlock()]
      const heights = [100, 900]
      expect(calculateBreaksFromHeights(heights, blocks, CONTENT_HEIGHT)).toEqual([1])
    })

    it('handles zero-height blocks gracefully', () => {
      const blocks = [paraBlock(), paraBlock(), paraBlock()]
      const heights = [0, 0, 0]
      expect(calculateBreaksFromHeights(heights, blocks, CONTENT_HEIGHT)).toEqual([])
    })

    it('computes multiple page breaks correctly', () => {
      const blocks = Array.from({ length: 24 }, () => paraBlock())
      const heights = Array(24).fill(100)
      // 700 + 100 = 800 > 768, break every 7 blocks
      expect(calculateBreaksFromHeights(heights, blocks, CONTENT_HEIGHT)).toEqual([7, 14, 21])
    })
  })

  describe('assembleGlobalBreaks (per-section equivalence)', () => {
    // Each section is [title, ...paragraphs]. Per-section pagination computes
    // local overflow breaks for each section independently; assembleGlobalBreaks
    // offsets them by each section's global start index and adds a forced break
    // at each non-first section's title. The result must equal running
    // calculateBreaksFromHeights over the whole flattened block list, as long as
    // every section carries positive height into the next (true for real DOM).
    function buildDoc(sectionSpecs, contentHeight) {
      const allBlocks = []
      const allHeights = []
      const sectionResults = []
      for (const spec of sectionSpecs) {
        const secBlocks = [titleBlock(), ...spec.paraHs.map(() => paraBlock())]
        const secHeights = [spec.titleH, ...spec.paraHs]
        allBlocks.push(...secBlocks)
        allHeights.push(...secHeights)
        sectionResults.push({
          localBreaks: calculateBreaksFromHeights(secHeights, secBlocks, contentHeight),
          blockCount: secBlocks.length,
        })
      }
      return { allBlocks, allHeights, sectionResults }
    }

    it('matches whole-doc pagination on a fixed multi-section document', () => {
      const CH = 768
      const { allBlocks, allHeights, sectionResults } = buildDoc(
        [
          { titleH: 50, paraHs: [100, 100, 100, 100, 100, 100, 100, 100] }, // overflow mid-section
          { titleH: 50, paraHs: [100, 100, 100] }, // fits on one page
          { titleH: 50, paraHs: [100, 100, 100, 100, 100, 100, 100, 100, 100] }, // overflow
        ],
        CH,
      )
      const whole = calculateBreaksFromHeights(allHeights, allBlocks, CH)
      const assembled = assembleGlobalBreaks(sectionResults)
      expect(assembled).toEqual(whole)
    })

    it('matches whole-doc pagination across many deterministic random docs', () => {
      // Deterministic LCG so the test is reproducible.
      let state = 123456789
      const rand = () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff
        return state
      }
      const CH = 768
      for (let trial = 0; trial < 200; trial++) {
        const sectionCount = 1 + (rand() % 6)
        const specs = []
        for (let s = 0; s < sectionCount; s++) {
          const paraCount = 1 + (rand() % 12)
          const paraHs = []
          for (let p = 0; p < paraCount; p++) paraHs.push(20 + (rand() % 200)) // positive heights
          specs.push({ titleH: 20 + (rand() % 80), paraHs })
        }
        const { allBlocks, allHeights, sectionResults } = buildDoc(specs, CH)
        const whole = calculateBreaksFromHeights(allHeights, allBlocks, CH)
        const assembled = assembleGlobalBreaks(sectionResults)
        expect(assembled).toEqual(whole)
      }
    })

    it('returns only forced section breaks when no section overflows', () => {
      const CH = 768
      const { allBlocks, allHeights, sectionResults } = buildDoc(
        [
          { titleH: 50, paraHs: [100] },
          { titleH: 50, paraHs: [100] },
          { titleH: 50, paraHs: [100] },
        ],
        CH,
      )
      // Three short sections; breaks only at the section titles.
      expect(assembleGlobalBreaks(sectionResults)).toEqual(
        calculateBreaksFromHeights(allHeights, allBlocks, CH),
      )
    })

    it('produces no forced break for a single-section document', () => {
      const CH = 768
      const { allBlocks, allHeights, sectionResults } = buildDoc(
        [{ titleH: 50, paraHs: [100, 100, 100] }],
        CH,
      )
      expect(assembleGlobalBreaks(sectionResults)).toEqual(
        calculateBreaksFromHeights(allHeights, allBlocks, CH),
      )
    })
  })
})