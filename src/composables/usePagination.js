import { ref, computed, watch, onUnmounted } from 'vue'
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

/// Assemble global page-break indices from per-section results. Each section
/// contributes a forced break at its title (unless it opens the document) plus
/// its local overflow breaks offset by the section's global start index. This
/// is exactly equivalent to running `calculateBreaksFromHeights` over the whole
/// flattened block list, PROVIDED every section carries positive height into
/// the next — true for real DOM measurements, where a title or paragraph always
/// leaves residual height on the page. That carry-is-positive fact is precisely
/// what lets sections be paginated and cached independently (a change in one
/// section cannot move page breaks in later sections, because each later
/// section starts on a fresh page regardless of the prior residual).
export function assembleGlobalBreaks(sectionResults) {
  const globalBreaks = []
  let globalStart = 0
  for (let s = 0; s < sectionResults.length; s++) {
    if (s > 0) globalBreaks.push(globalStart)
    for (const localBreak of sectionResults[s].localBreaks) {
      globalBreaks.push(globalStart + localBreak)
    }
    globalStart += sectionResults[s].blockCount
  }
  return globalBreaks
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

  // --- Per-section incremental pagination -----------------------------------
  // The break rule forces a page break before every section-title that isn't
  // the first block of the document, so each section starts on a fresh page and
  // its internal page breaks depend only on its OWN paragraphs' heights. That
  // makes sections independent pagination units: editing one section can only
  // move page breaks within that section. So instead of re-measuring the whole
  // manuscript on every change, we measure one section at a time and cache the
  // result keyed by the section's stable id. On a recalc we only re-measure the
  // section(s) whose content signature changed; the rest reuse cached heights.
  // The global pageBreaks contract is preserved — each section's local overflow
  // breaks are offset by the section's global start index, plus a forced break
  // at each non-first section's title — so editor/manuscript consumers are
  // unaffected.
  const sectionCache = new Map() // sectionId -> { signature, heights, localBreaks, blockCount }

  function calculateBreaks() {
    const sections = docRef.value?.sections
    if (!sections || sections.length === 0) {
      sectionCache.clear()
      pageBreaks.value = []
      return
    }
    const flat = flattenSections(sections)
    if (flat.length === 0) {
      sectionCache.clear()
      pageBreaks.value = []
      return
    }

    // Group the flat block sequence back into per-section block lists, in order.
    // Each group is [section-title, ...paragraphs] for one section.
    const groups = []
    let current = null
    for (const block of flat) {
      if (!current || current.sectionId !== block.sectionId) {
        current = { sectionId: block.sectionId, blocks: [] }
        groups.push(current)
      }
      current.blocks.push(block)
    }

    const seen = new Set()
    const sectionResults = []

    for (const group of groups) {
      seen.add(group.sectionId)
      const signature = JSON.stringify(group.blocks)
      let entry = sectionCache.get(group.sectionId)
      if (!entry || entry.signature !== signature) {
        // Content changed (or first time seen): measure just this section.
        const heights = measureBlocks(group.blocks)
        entry = {
          signature,
          heights,
          localBreaks: calculateBreaksFromHeights(heights, group.blocks, CONTENT_HEIGHT),
          blockCount: group.blocks.length,
        }
        sectionCache.set(group.sectionId, entry)
      }
      sectionResults.push({ localBreaks: entry.localBreaks, blockCount: entry.blockCount })
    }

    // Drop cache entries for sections that no longer exist.
    for (const id of sectionCache.keys()) {
      if (!seen.has(id)) sectionCache.delete(id)
    }

    pageBreaks.value = assembleGlobalBreaks(sectionResults)
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

  // Pagination is debounced because the editor rewrites `doc.sections` on every
  // keystroke via syncFromDOM, and page breaks shifting mid-keystroke isn't
  // useful. The per-section cache above already limits a recalc to re-measuring
  // only the changed section, but the debounce still coalesces a burst of
  // keystrokes into a single recalc (and there are two usePagination instances
  // — editor + manuscript — watching the same store doc, so coalescing matters).
  // `calculateBreaks` stays synchronous and exposed for any caller that needs an
  // immediate recalculation.
  let pendingBreaksTimer = null
  const PAGINATION_DEBOUNCE_MS = 300

  function scheduleBreaks() {
    if (pendingBreaksTimer) clearTimeout(pendingBreaksTimer)
    pendingBreaksTimer = setTimeout(() => {
      pendingBreaksTimer = null
      calculateBreaks()
    }, PAGINATION_DEBOUNCE_MS)
  }

  onUnmounted(() => {
    if (pendingBreaksTimer) {
      clearTimeout(pendingBreaksTimer)
      pendingBreaksTimer = null
    }
  })

  watch(
    () => docRef.value?.sections,
    () => {
      scheduleBreaks()
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