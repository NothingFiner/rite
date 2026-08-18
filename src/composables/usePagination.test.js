import { describe, it, expect } from 'vitest'
import { calculateBreaksFromHeights } from './usePagination.js'
import { ParagraphStyle } from '../constants/ParagraphStyle.js'

function makePara(style = ParagraphStyle.Normal) {
  return { paragraphStyle: style, elements: [{ textRun: { content: 'x', textStyle: {} } }] }
}

const CONTENT_HEIGHT = 768

describe('usePagination', () => {
  describe('calculateBreaksFromHeights', () => {
    it('returns empty for no paragraphs', () => {
      expect(calculateBreaksFromHeights([], [], CONTENT_HEIGHT)).toEqual([])
    })

    it('returns empty when all fit on one page', () => {
      const paras = [makePara(), makePara(), makePara()]
      const heights = [100, 100, 100]
      expect(calculateBreaksFromHeights(heights, paras, CONTENT_HEIGHT)).toEqual([])
    })

    it('breaks when content exceeds page height', () => {
      const paras = Array.from({ length: 10 }, () => makePara())
      const heights = Array(10).fill(100)
      // 100 * 7 = 700; at index 7, 700 + 100 = 800 > 768, so break at index 7
      expect(calculateBreaksFromHeights(heights, paras, CONTENT_HEIGHT)).toEqual([7])
    })

    it('breaks at heading when not first paragraph', () => {
      const paras = [
        makePara(),
        makePara(ParagraphStyle.Heading1),
        makePara(),
      ]
      const heights = [100, 50, 100]
      // Heading at index 1 forces a break because currentHeight > 0
      expect(calculateBreaksFromHeights(heights, paras, CONTENT_HEIGHT)).toEqual([1])
    })

    it('does not break at first paragraph even if it is a heading', () => {
      const paras = [
        makePara(ParagraphStyle.Heading1),
        makePara(),
      ]
      const heights = [50, 100]
      expect(calculateBreaksFromHeights(heights, paras, CONTENT_HEIGHT)).toEqual([])
    })

    it('breaks on both heading and overflow', () => {
      const paras = [
        makePara(),
        makePara(ParagraphStyle.Heading1),
        ...Array.from({ length: 10 }, () => makePara()),
      ]
      const heights = [100, 50, ...Array(10).fill(100)]
      // Break at heading (1), then break again when overflow hits
      expect(calculateBreaksFromHeights(heights, paras, CONTENT_HEIGHT)).toEqual([1, 9])
    })

    it('breaks when a single paragraph exceeds page height', () => {
      const paras = [makePara(), makePara()]
      const heights = [100, 900]
      // Second paragraph alone exceeds page height and triggers a break
      expect(calculateBreaksFromHeights(heights, paras, CONTENT_HEIGHT)).toEqual([1])
    })

    it('handles zero-height paragraphs gracefully', () => {
      const paras = [makePara(), makePara(), makePara()]
      const heights = [0, 0, 0]
      expect(calculateBreaksFromHeights(heights, paras, CONTENT_HEIGHT)).toEqual([])
    })

    it('computes multiple page breaks correctly', () => {
      // 3+ pages worth of content
      const paras = Array.from({ length: 24 }, () => makePara())
      const heights = Array(24).fill(100)
      // 700 + 100 = 800 > 768, break every 7 paragraphs
      expect(calculateBreaksFromHeights(heights, paras, CONTENT_HEIGHT)).toEqual([7, 14, 21])
    })
  })
})
