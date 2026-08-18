import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/tauri'
import { useDocumentStore } from '../stores/document.js'
import { useRustSearch } from './useRustSearch.js'

export function useSearchPanel(editorRef, viewModeRef) {
  const store = useDocumentStore()
  const rust = useRustSearch()
  const searchVisible = ref(false)
  const searchQuery = ref('')
  const searchReplace = ref('')
  const searchShowReplace = ref(false)

  async function openSearch() {
    searchVisible.value = true
    searchShowReplace.value = false
    if (searchQuery.value.trim()) {
      await performSearch()
    }
  }

  function closeSearch() {
    searchVisible.value = false
    searchQuery.value = ''
    searchReplace.value = ''
    rust.clear()
    editorRef.value?.clearSearchHighlights?.()
  }

  async function refreshDocument() {
    try {
      const updated = await invoke('get_document')
      store.setDoc(updated)
    } catch (e) {
      console.error('Failed to refresh document after replace:', e)
    }
  }

  async function performSearch() {
    if (!searchQuery.value.trim()) {
      rust.clear()
      editorRef.value?.clearSearchHighlights?.()
      return
    }
    const result = await rust.findText(searchQuery.value)
    editorRef.value?.applySearchHighlights?.(result.matches, result.currentIndex)
  }

  async function onSearchNext() {
    if (!searchQuery.value.trim()) return
    const result = await rust.findNext()
    editorRef.value?.applySearchHighlights?.(result.matches, result.currentIndex)
  }

  async function onSearchPrev() {
    if (!searchQuery.value.trim()) return
    const result = await rust.findPrev()
    editorRef.value?.applySearchHighlights?.(result.matches, result.currentIndex)
  }

  async function onSearchReplace() {
    if (!searchQuery.value.trim()) return
    const result = await rust.replaceCurrent(searchReplace.value)
    await refreshDocument()
    store.markModified()
    editorRef.value?.applySearchHighlights?.(result.matches, result.currentIndex)
  }

  async function onSearchReplaceAll() {
    if (!searchQuery.value.trim()) return
    const { count } = await rust.replaceAll(searchReplace.value)
    if (count > 0) {
      await refreshDocument()
      store.markModified()
      rust.clear()
      editorRef.value?.clearSearchHighlights?.()
    }
  }

  watch(searchQuery, () => {
    if (searchVisible.value) {
      performSearch()
    }
  })

  watch(viewModeRef, () => {
    if (searchVisible.value) {
      closeSearch()
    }
  })

  return {
    searchVisible,
    searchQuery,
    searchReplace,
    searchShowReplace,
    searchMatchCount: rust.matchCount,
    searchCurrentIndex: rust.currentIndex,
    openSearch,
    closeSearch,
    performSearch,
    onSearchNext,
    onSearchPrev,
    onSearchReplace,
    onSearchReplaceAll,
  }
}
