import { ref, computed, nextTick } from 'vue'
import { usePagination } from './usePagination.js'
import { useDocumentStore } from '../stores/document.js'
import { flattenSections } from './useSectionBlocks.js'
import { useSectionFormat } from './useSectionFormat.js'

// Builds the flat navigation outline. With headings retired, the outline is
// one row per Section — no Part/Chapter grouping, no levels. Each row carries
// its stable section id, section type, the render-derived chapter index (for
// Chapter-type sections only), a display title, and its starting page. Chapter
// numbers are derived (position among Chapter-type sections), never stored.
export function useNavigation(docRef, editorRef) {
  const store = useDocumentStore()
  const selectedNavId = ref(null)
  const { getPageForBlock } = usePagination(docRef)
  const sectionFormat = useSectionFormat()

  const tocItems = computed(() => {
    const sections = docRef.value?.sections || []
    if (sections.length === 0) return []
    const blocks = flattenSections(sections)
    const items = []
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].kind !== 'section-title') continue
      items.push({
        id: blocks[i].sectionId,
        title: blocks[i].title,
        sectionType: blocks[i].sectionType,
        chapterIndex: blocks[i].chapterIndex,
        displayTitle: displayTitleFor(blocks[i]),
        page: getPageForBlock(i),
      })
    }
    return items
  })

  // Rendered title for the nav row. A Chapter shows its derived prefix
  // ("Chapter 3: ") plus the subtitle, or just "Chapter 3" when the subtitle is
  // empty. A Section shows its literal title, or "Untitled Section" when blank.
  function displayTitleFor(block) {
    if (block.sectionType === 'chapter') {
      const prefix = sectionFormat.formatChapter(block.chapterIndex) // "Chapter 3: "
      return block.title ? prefix + block.title : prefix.replace(/: $/, '')
    }
    return block.title || 'Untitled Section'
  }

  function scrollToSection(id, switchToEditor) {
    if (switchToEditor) switchToEditor()
    nextTick(() => {
      editorRef.value?.scrollToSection?.(id)
    })
  }

  async function renameSection(id, newTitle) {
    await store.renameSection(id, newTitle)
    // Editor re-renders automatically via its watcher when store.doc changes.
  }

  async function deleteSection(id) {
    await store.deleteSection(id)
    selectedNavId.value = null
    // Editor re-renders automatically via its watcher when store.doc changes.
  }

  async function changeSectionType(id, newType) {
    await store.changeSectionType(id, newType)
  }

  return {
    selectedNavId,
    tocItems,
    scrollToSection,
    renameSection,
    deleteSection,
    changeSectionType,
  }
}