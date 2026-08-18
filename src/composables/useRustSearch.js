import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/tauri'

export function useRustSearch() {
  const matches = ref([])
  const currentIndex = ref(-1)
  const query = ref('')

  async function findText(q) {
    query.value = q
    if (!q.trim()) {
      matches.value = []
      currentIndex.value = -1
      return { matches: [], currentIndex: -1 }
    }
    try {
      const result = await invoke('search_document', { query: q })
      matches.value = result || []
      currentIndex.value = matches.value.length > 0 ? 0 : -1
      return { matches: matches.value, currentIndex: currentIndex.value }
    } catch (e) {
      console.error('Search failed:', e)
      matches.value = []
      currentIndex.value = -1
      return { matches: [], currentIndex: -1 }
    }
  }

  function findNext() {
    if (matches.value.length === 0) return
    currentIndex.value = (currentIndex.value + 1) % matches.value.length
  }

  function findPrev() {
    if (matches.value.length === 0) return
    currentIndex.value = (currentIndex.value - 1 + matches.value.length) % matches.value.length
  }

  async function replaceCurrent(replacement) {
    if (!query.value.trim() || currentIndex.value < 0) {
      return { matches: [], currentIndex: -1 }
    }
    try {
      const result = await invoke('replace_current', {
        query: query.value,
        replacement,
        matchIndex: currentIndex.value,
      })
      matches.value = result.matches || []
      currentIndex.value = result.current_index
      return result
    } catch (e) {
      console.error('Replace current failed:', e)
      return { matches: [], currentIndex: -1 }
    }
  }

  async function replaceAll(replacement) {
    if (!query.value.trim()) return { count: 0 }
    try {
      const count = await invoke('replace_all', { query: query.value, replacement })
      matches.value = []
      currentIndex.value = -1
      return { count }
    } catch (e) {
      console.error('Replace all failed:', e)
      return { count: 0 }
    }
  }

  function clear() {
    matches.value = []
    currentIndex.value = -1
    query.value = ''
  }

  const matchCount = computed(() => matches.value.length)

  return {
    matches,
    currentIndex,
    query,
    matchCount,
    findText,
    findNext,
    findPrev,
    replaceCurrent,
    replaceAll,
    clear,
  }
}
