import { ref, computed, watch } from 'vue'
import { paragraphToHTML, sectionTitleToHTML } from './useParagraphHTML.js'
import { flattenSections } from './useSectionBlocks.js'
import { useSectionFormat } from './useSectionFormat.js'
import { CONTENT_WIDTH, CONTENT_HEIGHT } from '../constants/page.js'

/// Compute the block indices that start a new page from the per-block heights.
/// A page break is forced before a section-title block (so a chapter/section
/// starts on a fresh page) whenever there is already content on the current
/// page, and otherwise when the next block would overflow the page. This
/// replaces the old `isHeading(paragraphStyle)` rule — section-titles are the
/// structural break points now.
export function calculateBreaksFromHeights(heights, blocks, contentHeight) {
  const breaks = []
  let currentHeight = 0

  for (let i = 0; i < blocks.length; i++) {
    const h = heights[i]
    const isSectionTitle = blocks[i].kind === 'section-title'

    if (isSectionTitle && currentHeight > 0) {
      breaks.push(i)
      currentHeight = h
    } else if (currentHeight + h > contentHeight && currentHeight > 0) {
      breaks.push(i)
      currentHeight = h
    } else {
      currentHeight += h
    }
  }

  return breaks
}

export function usePagination(docRef) {
  const pageBreaks = ref([]) // Array of block indices that start a new page
  const sectionFormat = useSectionFormat()

  /// Build the manuscript HTML for every block in order, returning the HTML
  /// string (whose `.ms-para` elements appear in the same order as `blocks`).
  function blocksToManuscriptHTML(blocks) {
    return blocks
      .map((block) => {
        if (block.kind === 'section-title') {
          const chapterPrefix =
            block.sectionType === 'chapter'
              ? sectionFormat.formatChapter(block.chapterIndex)
              : ''
          return sectionTitleToHTML(block, block.chapterIndex, chapterPrefix, { manuscript: true })
        }
        return paragraphToHTML(block.paragraph, { manuscript: true })
      })
      .join('')
  }

  function measureBlocks(blocks) {
    const measure = document.createElement('div')
    measure.className = 'ms-measure'
    measure.style.cssText = `
      position: absolute;
      visibility: hidden;
      width: ${CONTENT_WIDTH}px;
      left: -9999px;
      top: 0;
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      line-height: 24px;
    `

    const style = document.createElement('style')
    style.textContent = `
      .ms-measure .ms-para {
        margin: 0;
        text-align: left;
        text-indent: 48px;
        color: #1a1a1a;
      }
      .ms-measure .ms-para.scene-break {
        text-indent: 0;
        text-align: center;
      }
      .ms-measure .ms-para.section {
        text-indent: 0;
        text-align: center;
        text-transform: uppercase;
        font-weight: 700;
        font-size: 14px;
        margin-top: 24px;
      }
      .ms-measure .ms-para.chapter {
        text-indent: 0;
        text-align: center;
        text-transform: uppercase;
        font-weight: 600;
        font-size: 12px;
        margin-top: 24px;
      }
      .ms-measure .ms-para.no-indent {
        text-indent: 0;
      }
    `
    measure.appendChild(style)

    const container = document.createElement('div')
    container.innerHTML = blocksToManuscriptHTML(blocks)
    measure.appendChild(container)

    // The measurement div must be in the live DOM for offsetHeight to be computed.
    document.body.appendChild(measure)

    const paraEls = container.querySelectorAll('.ms-para')
    const heights = Array.from(paraEls).map((el) => el.offsetHeight)

    document.body.removeChild(measure)
    return heights
  }

  function calculateBreaks() {
    const sections = docRef.value?.sections
    if (!sections || sections.length === 0) {
      pageBreaks.value = []
      return
    }
    const blocks = flattenSections(sections)
    if (blocks.length === 0) {
      pageBreaks.value = []
      return
    }
    const heights = measureBlocks(blocks)
    pageBreaks.value = calculateBreaksFromHeights(heights, blocks, CONTENT_HEIGHT)
  }

  const pageCount = computed(() => pageBreaks.value.length + 1)

  function getPageForBlock(blockIndex) {
    let page = 1
    for (const breakIdx of pageBreaks.value) {
      if (blockIndex >= breakIdx) page++
      else break
    }
    return page
  }

  function getBlocksForPage(pageNum, blocks) {
    const startIdx = pageNum === 1 ? 0 : pageBreaks.value[pageNum - 2]
    const endIdx =
      pageNum <= pageBreaks.value.length ? pageBreaks.value[pageNum - 1] : blocks.length
    return blocks.slice(startIdx, endIdx)
  }

  watch(
    () => docRef.value?.sections,
    () => {
      calculateBreaks()
    },
    { deep: true, immediate: true }
  )

  return {
    pageBreaks,
    pageCount,
    getPageForBlock,
    getBlocksForPage,
    calculateBreaks,
  }
}