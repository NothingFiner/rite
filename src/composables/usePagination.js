import { ref, computed, watch } from 'vue'
import { paragraphToHTML } from './useParagraphHTML.js'
import { isHeading } from '../constants/ParagraphStyle.js'

const CONTENT_WIDTH = 720 - 96 * 2  // PAGE_WIDTH - MARGIN * 2
const CONTENT_HEIGHT = 960 - 96 * 2 // PAGE_HEIGHT - MARGIN * 2

export function calculateBreaksFromHeights(heights, paragraphs, contentHeight) {
  const breaks = []
  let currentHeight = 0

  for (let i = 0; i < paragraphs.length; i++) {
    const h = heights[i]

    if (isHeading(paragraphs[i].paragraphStyle) && currentHeight > 0) {
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
  const pageBreaks = ref([]) // Array of paragraph indices that start a new page

  function measureManuscriptParagraphs(paragraphs) {
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
    container.innerHTML = paragraphs.map((p) =>
      paragraphToHTML(p, { manuscript: true })
    ).join('')
    measure.appendChild(container)

    // The measurement div must be in the live DOM for offsetHeight to be computed.
    document.body.appendChild(measure)

    const paraEls = container.querySelectorAll('.ms-para')
    const heights = Array.from(paraEls).map(el => el.offsetHeight)

    document.body.removeChild(measure)
    return heights
  }

  function calculateBreaks() {
    const paragraphs = docRef.value?.body?.content || []
    if (paragraphs.length === 0) {
      pageBreaks.value = []
      return
    }

    const heights = measureManuscriptParagraphs(paragraphs)
    pageBreaks.value = calculateBreaksFromHeights(heights, paragraphs, CONTENT_HEIGHT)
  }

  const pageCount = computed(() => pageBreaks.value.length + 1)

  function getPageForParagraph(paraIndex) {
    let page = 1
    for (const breakIdx of pageBreaks.value) {
      if (paraIndex >= breakIdx) page++
      else break
    }
    return page
  }

  function getParagraphsForPage(pageNum, paragraphs) {
    const startIdx = pageNum === 1 ? 0 : pageBreaks.value[pageNum - 2]
    const endIdx = pageNum <= pageBreaks.value.length ? pageBreaks.value[pageNum - 1] : paragraphs.length
    return paragraphs.slice(startIdx, endIdx)
  }

  watch(() => docRef.value?.body?.content, () => {
    calculateBreaks()
  }, { deep: true, immediate: true })

  return {
    pageBreaks,
    pageCount,
    getPageForParagraph,
    getParagraphsForPage,
    calculateBreaks,
  }
}
