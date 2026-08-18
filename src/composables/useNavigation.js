import { ref, computed, nextTick } from 'vue'
import { usePagination } from './usePagination.js'
import { useDocumentStore } from '../stores/document.js'
import { ParagraphStyle, getHeadingLevel } from '../constants/ParagraphStyle.js'

export function useNavigation(docRef, editorRef) {
  const store = useDocumentStore()
  const selectedNavId = ref(null)
  const { getPageForParagraph } = usePagination(docRef)

  const tocItems = computed(() => {
    const items = []
    const paragraphs = docRef.value?.body?.content || []
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i]
      const level = getHeadingLevel(p.paragraphStyle)
      if (level > 0) {
        items.push({ id: p.id, level, title: extractHeadingTitle(p) || `Untitled Heading ${level}`, page: getPageForParagraph(i) })
      }
    }
    return items
  })

  function extractHeadingTitle(p) {
    return p.elements.map(el => el.textRun.content).join('').trim()
  }

  function scrollToHeading(id, switchToEditor) {
    if (switchToEditor) switchToEditor()
    nextTick(() => {
      editorRef.value?.scrollToParagraph?.(id)
    })
  }

  async function renameSection(id, newTitle) {
    await store.renameSection(id, newTitle)
    // Editor re-renders automatically via its watcher when store.doc changes.
  }

  async function deleteHeading(id) {
    await store.deleteHeading(id)
    selectedNavId.value = null
    // Editor re-renders automatically via its watcher when store.doc changes.
  }

  return {
    selectedNavId,
    tocItems,
    scrollToHeading,
    renameSection,
    deleteHeading,
  }
}
