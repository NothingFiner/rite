import { describe, it, expect, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useDocumentSearch } from './useDocumentSearch.js'

describe('useDocumentSearch', () => {
  let container
  let rootRef

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    rootRef = ref(container)
  })

  afterEach(() => {
    if (container.parentNode) {
      container.parentNode.removeChild(container)
    }
  })

  it('initializes with empty state', () => {
    const { searchState } = useDocumentSearch(rootRef)
    expect(searchState.value.matches).toEqual([])
    expect(searchState.value.currentIndex).toBe(-1)
    expect(searchState.value.query).toBe('')
  })

  it('finds text and updates state', () => {
    container.innerHTML = '<p>Hello world hello</p>'
    const { findText, searchState } = useDocumentSearch(rootRef)
    const result = findText('hello')
    expect(result.matches.length).toBe(2)
    expect(searchState.value.matches.length).toBe(2)
    expect(searchState.value.currentIndex).toBe(0)
  })

  it('navigates to next match', () => {
    container.innerHTML = '<p>foo foo foo</p>'
    const { findText, findNextText, searchState } = useDocumentSearch(rootRef)
    findText('foo')
    expect(searchState.value.currentIndex).toBe(0)
    findNextText()
    expect(searchState.value.currentIndex).toBe(1)
  })

  it('navigates to previous match', () => {
    container.innerHTML = '<p>foo foo foo</p>'
    const { findText, findNextText, findPrevText, searchState } = useDocumentSearch(rootRef)
    findText('foo')
    findNextText()
    findNextText()
    expect(searchState.value.currentIndex).toBe(2)
    findPrevText()
    expect(searchState.value.currentIndex).toBe(1)
  })

  it('calls onReplace callback after replace', () => {
    container.innerHTML = '<p>foo bar</p>'
    let called = false
    const { findText, replaceCurrentText } = useDocumentSearch(rootRef, {
      onReplace: () => { called = true },
    })
    findText('foo')
    replaceCurrentText('baz')
    expect(called).toBe(true)
  })

  it('clears highlights and resets state', () => {
    container.innerHTML = '<p>Hello world</p>'
    const { findText, clearSearch, searchState } = useDocumentSearch(rootRef)
    findText('Hello')
    expect(searchState.value.matches.length).toBeGreaterThan(0)
    clearSearch()
    expect(searchState.value.matches).toEqual([])
    expect(searchState.value.currentIndex).toBe(-1)
    expect(searchState.value.query).toBe('')
    expect(container.querySelectorAll('.search-highlight, .search-current').length).toBe(0)
  })

  it('returns empty result when root is null', () => {
    const nullRef = ref(null)
    const { findText } = useDocumentSearch(nullRef)
    const result = findText('test')
    expect(result.matches).toEqual([])
    expect(result.currentIndex).toBe(-1)
  })

  it('replaceAllText replaces all occurrences', () => {
    container.innerHTML = '<p>foo bar foo</p>'
    const { findText, replaceAllText } = useDocumentSearch(rootRef)
    findText('foo')
    const result = replaceAllText('baz')
    expect(result.count).toBe(1) // counts modified text nodes, not individual matches
    expect(container.textContent).toBe('baz bar baz')
  })

  it('replaceAllText returns 0 count when root is null', () => {
    const nullRef = ref(null)
    const { replaceAllText } = useDocumentSearch(nullRef)
    const result = replaceAllText('foo', 'baz')
    expect(result.count).toBe(0)
  })

  it('findNextText returns empty when root is null', () => {
    const nullRef = ref(null)
    const { findNextText } = useDocumentSearch(nullRef)
    const result = findNextText()
    expect(result.matches).toEqual([])
    expect(result.currentIndex).toBe(-1)
  })

  it('findPrevText returns empty when root is null', () => {
    const nullRef = ref(null)
    const { findPrevText } = useDocumentSearch(nullRef)
    const result = findPrevText()
    expect(result.matches).toEqual([])
    expect(result.currentIndex).toBe(-1)
  })

  it('replaceCurrentText returns empty when root is null', () => {
    const nullRef = ref(null)
    const { replaceCurrentText } = useDocumentSearch(nullRef)
    const result = replaceCurrentText('foo')
    expect(result.matches).toEqual([])
    expect(result.currentIndex).toBe(-1)
  })

  it('clearSearch is no-op when root is null', () => {
    const nullRef = ref(null)
    const { clearSearch, searchState } = useDocumentSearch(nullRef)
    clearSearch()
    expect(searchState.value.matches).toEqual([])
    expect(searchState.value.currentIndex).toBe(-1)
  })

  it('calls onReplace after replaceAllText', () => {
    container.innerHTML = '<p>foo</p>'
    let called = false
    const { findText, replaceAllText } = useDocumentSearch(rootRef, {
      onReplace: () => { called = true },
    })
    findText('foo')
    replaceAllText('bar')
    expect(called).toBe(true)
  })
})
