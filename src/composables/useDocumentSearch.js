import { ref } from 'vue'
import { applySearch, findNext, findPrev, replaceCurrent, replaceAll, clearSearchHighlights } from './useSearch.js'

export function useDocumentSearch(rootRef, options = {}) {
  const searchState = ref({ matches: [], currentIndex: -1, query: '' })

  function findText(query) {
    const root = rootRef.value
    if (!root) return { matches: [], currentIndex: -1 }
    searchState.value.query = query
    const result = applySearch(root, query, 0)
    searchState.value.matches = result.matches
    searchState.value.currentIndex = result.currentIndex
    return result
  }

  function findNextText() {
    const root = rootRef.value
    if (!root) return { matches: [], currentIndex: -1 }
    const result = findNext(root, searchState.value.query, searchState.value.currentIndex)
    searchState.value.matches = result.matches
    searchState.value.currentIndex = result.currentIndex
    return result
  }

  function findPrevText() {
    const root = rootRef.value
    if (!root) return { matches: [], currentIndex: -1 }
    const result = findPrev(root, searchState.value.query, searchState.value.currentIndex)
    searchState.value.matches = result.matches
    searchState.value.currentIndex = result.currentIndex
    return result
  }

  function replaceCurrentText(replaceText) {
    const root = rootRef.value
    if (!root) return { matches: [], currentIndex: -1 }
    const result = replaceCurrent(root, searchState.value.query, replaceText, searchState.value.currentIndex)
    searchState.value.matches = result.matches
    searchState.value.currentIndex = result.currentIndex
    if (options.onReplace) options.onReplace()
    return result
  }

  function replaceAllText(replaceText) {
    const root = rootRef.value
    if (!root) return { count: 0 }
    const { count } = replaceAll(root, searchState.value.query, replaceText)
    if (options.onReplace) options.onReplace()
    return { count }
  }

  function clearSearch() {
    const root = rootRef.value
    if (!root) return
    clearSearchHighlights(root)
    searchState.value = { matches: [], currentIndex: -1, query: '' }
  }

  return { searchState, findText, findNextText, findPrevText, replaceCurrentText, replaceAllText, clearSearch }
}
