import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { clearSearchHighlights, applySearchHighlights } from './useSearchHighlights.js'

describe('useSearchHighlights', () => {
  let root

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  afterEach(() => {
    if (root.parentNode) {
      root.parentNode.removeChild(root)
    }
  })

  describe('clearSearchHighlights', () => {
    it('does nothing when root is null', () => {
      expect(() => clearSearchHighlights(null)).not.toThrow()
    })

    it('removes highlight spans and restores original text', () => {
      root.innerHTML = '<p>Hello <span class="search-highlight">world</span></p>'
      clearSearchHighlights(root)
      expect(root.querySelectorAll('.search-highlight').length).toBe(0)
      expect(root.textContent).toBe('Hello world')
    })

    it('removes current class spans too', () => {
      root.innerHTML = '<p><span class="search-current">foo</span> bar</p>'
      clearSearchHighlights(root)
      expect(root.querySelectorAll('.search-current').length).toBe(0)
      expect(root.textContent).toBe('foo bar')
    })

    it('handles nested spans', () => {
      root.innerHTML = '<p><span class="search-highlight">a<span class="search-current">b</span>c</span></p>'
      clearSearchHighlights(root)
      expect(root.querySelectorAll('.search-highlight, .search-current').length).toBe(0)
      expect(root.textContent).toBe('abc')
    })

    it('is a no-op when no highlights exist', () => {
      root.innerHTML = '<p>Plain text</p>'
      clearSearchHighlights(root)
      expect(root.textContent).toBe('Plain text')
    })
  })

  describe('applySearchHighlights', () => {
    it('does nothing when root is null', () => {
      expect(() => applySearchHighlights(null, [], 0)).not.toThrow()
    })

    it('does nothing for empty matches', () => {
      root.innerHTML = '<p data-para-id="p1">Hello world</p>'
      applySearchHighlights(root, [], 0)
      expect(root.querySelectorAll('.search-highlight, .search-current').length).toBe(0)
    })

    it('wraps a single match in highlight span', () => {
      root.innerHTML = '<p data-para-id="p1">Hello world</p>'
      applySearchHighlights(root, [{ paragraph_id: 'p1', start_offset: 0, end_offset: 5 }], 0)
      const spans = root.querySelectorAll('.search-highlight, .search-current')
      expect(spans.length).toBe(1)
      expect(spans[0].textContent).toBe('Hello')
      expect(spans[0].classList.contains('search-current')).toBe(true)
    })

    it('marks non-current matches as search-highlight', () => {
      root.innerHTML = '<p data-para-id="p1">foo foo foo</p>'
      applySearchHighlights(root, [
        { paragraph_id: 'p1', start_offset: 0, end_offset: 3 },
        { paragraph_id: 'p1', start_offset: 4, end_offset: 7 },
      ], 1)
      const current = root.querySelector('.search-current')
      const highlights = root.querySelectorAll('.search-highlight')
      expect(current.textContent).toBe('foo')
      expect(highlights.length).toBe(1)
      expect(highlights[0].textContent).toBe('foo')
    })

    it('handles multiple paragraphs', () => {
      root.innerHTML = `
        <p data-para-id="p1">First para</p>
        <p data-para-id="p2">Second para</p>
      `
      applySearchHighlights(root, [
        { paragraph_id: 'p1', start_offset: 0, end_offset: 5 },
        { paragraph_id: 'p2', start_offset: 7, end_offset: 11 },
      ], 0)
      const currentSpans = root.querySelectorAll('.search-current')
      expect(currentSpans.length).toBe(1)
      expect(currentSpans[0].textContent).toBe('First')
    })

    it('skips paragraphs not found in root', () => {
      root.innerHTML = '<p data-para-id="p1">Hello</p>'
      applySearchHighlights(root, [
        { paragraph_id: 'p1', start_offset: 0, end_offset: 5 },
        { paragraph_id: 'p999', start_offset: 0, end_offset: 3 },
      ], 0)
      const spans = root.querySelectorAll('.search-highlight, .search-current')
      expect(spans.length).toBe(1)
    })

    it('clears previous highlights before applying new ones', () => {
      root.innerHTML = '<p data-para-id="p1">Hello world</p>'
      applySearchHighlights(root, [{ paragraph_id: 'p1', start_offset: 0, end_offset: 5 }], 0)
      applySearchHighlights(root, [{ paragraph_id: 'p1', start_offset: 6, end_offset: 11 }], 0)
      const spans = root.querySelectorAll('.search-highlight, .search-current')
      expect(spans.length).toBe(1)
      expect(spans[0].textContent).toBe('world')
    })

    it('handles match in middle of text node', () => {
      root.innerHTML = '<p data-para-id="p1">abcdef</p>'
      applySearchHighlights(root, [{ paragraph_id: 'p1', start_offset: 2, end_offset: 4 }], 0)
      expect(root.textContent).toBe('abcdef')
      const span = root.querySelector('.search-current')
      expect(span.textContent).toBe('cd')
    })

    it('handles multiple matches in same paragraph', () => {
      root.innerHTML = '<p data-para-id="p1">ab cd ef</p>'
      applySearchHighlights(root, [
        { paragraph_id: 'p1', start_offset: 0, end_offset: 2 },
        { paragraph_id: 'p1', start_offset: 6, end_offset: 8 },
      ], 0)
      const spans = root.querySelectorAll('.search-current, .search-highlight')
      expect(spans.length).toBe(2)
      expect(spans[0].textContent).toBe('ab')
      expect(spans[1].textContent).toBe('ef')
    })
  })
})
