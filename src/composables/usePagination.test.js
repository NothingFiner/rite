import { describe, it, expect } from 'vitest'
import { calculateBreaksFromHeights } from './usePagination.js'

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
})