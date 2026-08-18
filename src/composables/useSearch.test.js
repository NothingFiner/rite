import { describe, it, expect, beforeEach } from 'vitest'
import { applySearch, findNext, findPrev, replaceCurrent, replaceAll, clearSearchHighlights } from './useSearch.js'

describe('useSearch', () => {
  let container

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  function cleanup() {
    if (container.parentNode) {
      container.parentNode.removeChild(container)
    }
  }

  afterEach(() => {
    cleanup()
  })

  describe('applySearch', () => {
    it('finds matches in text', () => {
      container.innerHTML = '<p>Hello world, hello universe</p>'
      const result = applySearch(container, 'hello')
      expect(result.matches.length).toBe(2)
      expect(result.currentIndex).toBe(0)
    })

    it('wraps matches in highlight spans', () => {
      container.innerHTML = '<p>Hello world</p>'
      applySearch(container, 'Hello')
      const highlights = container.querySelectorAll('.search-highlight, .search-current')
      expect(highlights.length).toBe(1)
      expect(highlights[0].textContent).toBe('Hello')
      expect(highlights[0].classList.contains('search-current')).toBe(true)
    })

    it('returns empty for no match', () => {
      container.innerHTML = '<p>Hello world</p>'
      const result = applySearch(container, 'xyz')
      expect(result.matches.length).toBe(0)
      expect(result.currentIndex).toBe(-1)
    })

    it('skips contenteditable=false elements', () => {
      container.innerHTML = '<p>Hello world</p><div contenteditable="false">Hello</div>'
      const result = applySearch(container, 'Hello')
      expect(result.matches.length).toBe(1)
    })

    it('skips page-number-label elements', () => {
      container.innerHTML = '<p>Hello world</p><div class="page-number-label">Hello</div>'
      const result = applySearch(container, 'Hello')
      expect(result.matches.length).toBe(1)
    })

    it('is case insensitive', () => {
      container.innerHTML = '<p>HELLO hello HeLLo</p>'
      const result = applySearch(container, 'hello')
      expect(result.matches.length).toBe(3)
    })
  })

  describe('findNext / findPrev', () => {
    it('advances to next match', () => {
      container.innerHTML = '<p>foo foo foo</p>'
      applySearch(container, 'foo')
      const result = findNext(container, 'foo', 0)
      expect(result.currentIndex).toBe(1)
    })

    it('goes back to previous match', () => {
      container.innerHTML = '<p>foo foo foo</p>'
      applySearch(container, 'foo')
      const result = findPrev(container, 'foo', 2)
      expect(result.currentIndex).toBe(1)
    })
  })

  describe('replaceCurrent', () => {
    it('replaces current match text', () => {
      container.innerHTML = '<p>foo bar foo</p>'
      applySearch(container, 'foo', 0)
      replaceCurrent(container, 'foo', 'baz', 0)
      expect(container.textContent).toContain('baz bar foo')
    })

    it('returns new search results after replace', () => {
      container.innerHTML = '<p>foo foo</p>'
      applySearch(container, 'foo', 0)
      const result = replaceCurrent(container, 'foo', 'baz', 0)
      expect(result.matches.length).toBe(1)
    })
  })

  describe('replaceAll', () => {
    it('replaces all occurrences', () => {
      container.innerHTML = '<p>foo bar foo</p>'
      const { count } = replaceAll(container, 'foo', 'baz')
      expect(count).toBeGreaterThanOrEqual(1)
      expect(container.textContent).toBe('baz bar baz')
    })

    it('is case insensitive', () => {
      container.innerHTML = '<p>FOO foo Foo</p>'
      const { count } = replaceAll(container, 'foo', 'bar')
      expect(count).toBeGreaterThanOrEqual(1)
      expect(container.textContent).toBe('bar bar bar')
    })

    it('returns 0 when nothing matched', () => {
      container.innerHTML = '<p>hello world</p>'
      const { count } = replaceAll(container, 'xyz', 'abc')
      expect(count).toBe(0)
    })
  })

  describe('clearSearchHighlights', () => {
    it('removes all highlight spans and restores text', () => {
      container.innerHTML = '<p>Hello world</p>'
      applySearch(container, 'Hello')
      expect(container.querySelectorAll('.search-highlight, .search-current').length).toBe(1)
      clearSearchHighlights(container)
      expect(container.querySelectorAll('.search-highlight, .search-current').length).toBe(0)
      expect(container.textContent).toBe('Hello world')
    })
  })
})
