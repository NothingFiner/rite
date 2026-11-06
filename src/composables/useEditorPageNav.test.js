import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  layoutPageBreaks, currentPageAtCursor, currentPageAtTop, getCurrentPage,
  navigatePage, navigateSectionPage, scrollToPage,
} from './useEditorPageNav.js'

// layoutPageBreaks is fully testable in jsdom — it only touches the DOM
// (stamping data-page-start, appending the <hr> + sentinel), never the
// Selection API. The navigation helpers that read the caret (currentPageAtCursor
// / navigatePage / navigateSectionPage / scrollToPage / currentPageAtTop /
// getCurrentPage) depend on a live Selection and real geometry
// (getBoundingClientRect), which jsdom doesn't implement meaningfully — their
// no-root / no-selection guards are tested here, and the happy paths are
// covered end-to-end by the Playwright suite (page nav, view-switch page
// preservation), the agreed split for 5.6.

// A minimal section flattenSections can consume (it only needs the shape, not
// realistic paragraph content — layoutPageBreaks uses flattenSections solely
// to check the doc isn't empty; the actual stamps come from the live DOM).
const toySection = (id, paragraphCount = 1) => ({
  id,
  sectionType: 'section',
  title: 'T',
  paragraphs: Array.from({ length: paragraphCount }, (_, i) => ({ id: `${id}-p${i}` })),
})

const paragraphDiv = (id) => {
  const div = document.createElement('div')
  div.className = 'paragraph'
  div.dataset.paraId = id
  return div
}

describe('useEditorPageNav', () => {
  let root

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  afterEach(() => {
    if (root.parentNode) root.parentNode.removeChild(root)
  })

  describe('layoutPageBreaks', () => {
    it('is a no-op on a null root', () => {
      expect(() => layoutPageBreaks(null, [toySection('s1')], [])).not.toThrow()
    })

    it('clears no stamps when the doc is empty', () => {
      root.innerHTML = '<div class="paragraph" data-para-id="p1">x</div>'
      layoutPageBreaks(root, [], [])
      // An empty doc returns early — the existing paragraph keeps no stamp and
      // no trailing decorations are added.
      expect(root.querySelector('[data-page-start]')).toBe(null)
      expect(root.querySelector('.page-break-line')).toBe(null)
      expect(root.querySelector('.editor-sentinel')).toBe(null)
    })

    it('stamps page 1 on the first content block', () => {
      root.appendChild(paragraphDiv('p1'))
      root.appendChild(paragraphDiv('p2'))
      layoutPageBreaks(root, [toySection('s1', 2)], [])
      expect(root.children[0].getAttribute('data-page-start')).toBe('1')
      // No break at blockIndex 1 → second paragraph is unstamped.
      expect(root.children[1].hasAttribute('data-page-start')).toBe(false)
    })

    it('stamps a new page at each index in the pageBreaks array', () => {
      // Five paragraphs; breaks at blockIndex 2 and 4 start new pages.
      for (let i = 1; i <= 5; i++) root.appendChild(paragraphDiv(`p${i}`))
      layoutPageBreaks(root, [toySection('s1', 5)], [2, 4])

      const stamp = (i) => root.children[i].getAttribute('data-page-start')
      expect(stamp(0)).toBe('1')        // blockIndex 0 → page 1
      expect(stamp(1)).toBe(null)       // blockIndex 1 → mid-page
      expect(stamp(2)).toBe('2')        // blockIndex 2 → page 2
      expect(stamp(3)).toBe(null)       // blockIndex 3 → mid-page
      expect(stamp(4)).toBe('3')        // blockIndex 4 → page 3
    })

    it('can stamp a page starting on a section-title block', () => {
      const title = document.createElement('div')
      title.className = 'section-title'
      title.dataset.sectionId = 's1'
      root.appendChild(title)
      root.appendChild(paragraphDiv('p1'))
      // flattenSections yields a section-title block at index 0; the DOM matches.
      layoutPageBreaks(root, [toySection('s1', 1)], [])
      expect(root.children[0].getAttribute('data-page-start')).toBe('1')
      expect(root.children[1].hasAttribute('data-page-start')).toBe(false)
    })

    it('appends one trailing page-break <hr> and one sentinel after the last block', () => {
      root.appendChild(paragraphDiv('p1'))
      root.appendChild(paragraphDiv('p2'))
      layoutPageBreaks(root, [toySection('s1', 2)], [])

      expect(root.querySelectorAll('.page-break-line').length).toBe(1)
      expect(root.querySelectorAll('.editor-sentinel').length).toBe(1)
      // Order: last content block, then hr, then sentinel.
      const last = root.children[root.children.length - 1]
      expect(last.classList.contains('editor-sentinel')).toBe(true)
      const beforeLast = root.children[root.children.length - 2]
      expect(beforeLast.classList.contains('page-break-line')).toBe(true)
    })

    it('is idempotent — re-stamping does not accumulate decorations or stamps', () => {
      for (let i = 1; i <= 4; i++) root.appendChild(paragraphDiv(`p${i}`))
      const sections = [toySection('s1', 4)]
      layoutPageBreaks(root, sections, [2])
      layoutPageBreaks(root, sections, [2])
      layoutPageBreaks(root, sections, [2])

      expect(root.querySelectorAll('.page-break-line').length).toBe(1)
      expect(root.querySelectorAll('.editor-sentinel').length).toBe(1)
      const stamped = Array.from(root.querySelectorAll('[data-page-start]'))
        .map(el => el.getAttribute('data-page-start'))
      expect(stamped).toEqual(['1', '2'])
    })

    it('re-stamps cleanly when the page breaks change', () => {
      for (let i = 1; i <= 4; i++) root.appendChild(paragraphDiv(`p${i}`))
      const sections = [toySection('s1', 4)]
      layoutPageBreaks(root, sections, [2])
      // Now only the first block starts a page — the old page-2 stamp must clear.
      layoutPageBreaks(root, sections, [])
      const stamped = Array.from(root.querySelectorAll('[data-page-start]'))
        .map(el => el.getAttribute('data-page-start'))
      expect(stamped).toEqual(['1'])
    })
  })

  describe('navigation guards (jsdom)', () => {
    it('currentPageAtCursor returns 1 on a null root', () => {
      expect(currentPageAtCursor(null)).toBe(1)
    })

    it('currentPageAtCursor returns 1 with no selection', () => {
      const sel = window.getSelection()
      if (sel) sel.removeAllRanges()
      root.appendChild(paragraphDiv('p1'))
      // Stamps present but no caret → default page 1.
      layoutPageBreaks(root, [toySection('s1', 1)], [])
      expect(currentPageAtCursor(root)).toBe(1)
    })

    it('currentPageAtTop returns 1 on a null root', () => {
      expect(currentPageAtTop(null)).toBe(1)
    })

    it('getCurrentPage returns 1 on a null root', () => {
      expect(getCurrentPage(null)).toBe(1)
    })

    it('navigatePage does not throw on a null root', () => {
      expect(() => navigatePage(null, 1)).not.toThrow()
    })

    it('navigateSectionPage does not throw on a null root', () => {
      expect(() => navigateSectionPage(null, 1)).not.toThrow()
    })

    it('scrollToPage does not throw on a null root', () => {
      expect(() => scrollToPage(null, 1, [toySection('s1')], [])).not.toThrow()
    })
  })
})