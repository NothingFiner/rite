import { generateParagraphId, generateSectionId, defaultTextStyle } from '../constants/DocumentModel.js'

async function loadMammoth() {
  const { default: mammoth } = await import('mammoth')
  return mammoth
}

async function loadJSZip() {
  const { default: JSZip } = await import('jszip')
  return JSZip
}

// Build a body paragraph model straight from extracted inline elements — no
// `paragraphStyle` field (headings are sections now, not paragraph styles).
function makeParagraph(elements) {
  return {
    id: generateParagraphId(),
    elements,
    leftIndent: null,
    rightIndent: null,
    firstLineIndent: null,
  }
}

// Finalize a section list built by an importer: ensure there is at least one
// section, and that every section has at least one paragraph to type into
// (mirrors the editor's invariant — a section always has an editable body).
function finalizeSections(sections) {
  if (sections.length === 0) {
    sections.push({ id: generateSectionId(), title: '', sectionType: 'section', paragraphs: [] })
  }
  for (const section of sections) {
    if (!section.paragraphs || section.paragraphs.length === 0) {
      section.paragraphs.push(makeParagraph([{ textRun: { content: '', textStyle: defaultTextStyle() } }]))
    }
  }
  return sections
}

/// Read the concatenated text of a paragraph's runs (used to derive a heading
/// element's section title).
function runText(elements) {
  return (elements || []).map((el) => el.textRun.content).join('').trim()
}

/* ------------------------------------------------------------------ */
/* DOCX import                                                        */
/* ------------------------------------------------------------------ */

function inlineElementsFromHtml(el) {
  const elements = []
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent) {
        elements.push({ textRun: { content: child.textContent, textStyle: defaultTextStyle() } })
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.nodeName
      if (tag === 'BR') {
        elements.push({ textRun: { content: '\n', textStyle: defaultTextStyle() } })
      } else {
        elements.push({ textRun: { content: child.textContent || '', textStyle: extractInlineStyle(child) } })
      }
    }
  }
  if (elements.length === 0) {
    elements.push({ textRun: { content: '', textStyle: defaultTextStyle() } })
  }
  return elements
}

function extractInlineStyle(el) {
  const s = defaultTextStyle()
  const tag = el.nodeName
  if (tag === 'STRONG' || tag === 'B') s.bold = true
  if (tag === 'EM' || tag === 'I') s.italic = true
  if (tag === 'U') s.underline = true
  const styleAttr = el.getAttribute?.('style') || ''
  const fontSizeMatch = styleAttr.match(/font-size:\s*(\d+)pt/i)
  if (fontSizeMatch) s.fontSize = Math.round(parseInt(fontSizeMatch[1], 10) * 1.333)
  const fontSizePxMatch = styleAttr.match(/font-size:\s*(\d+)px/i)
  if (fontSizePxMatch) s.fontSize = parseInt(fontSizePxMatch[1], 10)
  const computedBold = el.querySelector?.('strong, b') != null
  const computedItalic = el.querySelector?.('em, i') != null
  const computedUnderline = el.querySelector?.('u') != null
  if (computedBold) s.bold = true
  if (computedItalic) s.italic = true
  if (computedUnderline) s.underline = true
  return s
}

// Walk the parsed HTML body and build sections directly: every H1–H6 starts a
// new section (H2 → Chapter, any other heading → Section), each P appends a
// body paragraph to the current section. Body before the first heading goes
// into a leading untitled section. The heading element is consumed into the
// section title and does not survive as a body paragraph.
function htmlToSections(root) {
  const sections = []
  let current = null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  let node = walker.nextNode()
  while (node) {
    if (/^H[1-6]$/.test(node.nodeName)) {
      if (current) sections.push(current)
      current = {
        id: generateSectionId(),
        title: (node.textContent || '').trim(),
        sectionType: node.nodeName === 'H2' ? 'chapter' : 'section',
        paragraphs: [],
      }
    } else if (node.nodeName === 'P') {
      if (!current) current = { id: generateSectionId(), title: '', sectionType: 'section', paragraphs: [] }
      current.paragraphs.push(makeParagraph(inlineElementsFromHtml(node)))
    }
    node = walker.nextNode()
  }
  if (current) sections.push(current)
  return finalizeSections(sections)
}

export async function importDocx(arrayBuffer) {
  const mammoth = await loadMammoth()
  const result = await mammoth.convertToHtml({ arrayBuffer }, {
    styleMap: [
      'p[style-name="Heading 1"] => h1',
      'p[style-name="Heading 2"] => h2',
      'p[style-name="Heading 3"] => h3',
      'p[style-name="Heading 4"] => h4',
      'p[style-name="Heading 5"] => h5',
      'p[style-name="Heading 6"] => h6',
    ],
  })
  const parser = new DOMParser()
  const doc = parser.parseFromString(result.value, 'text/html')
  const body = doc.querySelector('body')
  return htmlToSections(body)
}

/* ------------------------------------------------------------------ */
/* ODT import                                                         */
/* ------------------------------------------------------------------ */

function odtElementsToRuns(textP, style, styleMap) {
  const elements = []
  for (const child of textP.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent) {
        elements.push({ textRun: { content: child.textContent, textStyle: defaultTextStyle() } })
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.nodeName
      if (tag === 'text:s') {
        const count = parseInt(child.getAttribute('text:c') || '1', 10)
        elements.push({ textRun: { content: ' '.repeat(count), textStyle: defaultTextStyle() } })
      } else if (tag === 'text:tab') {
        elements.push({ textRun: { content: '\t', textStyle: defaultTextStyle() } })
      } else if (tag === 'text:line-break') {
        elements.push({ textRun: { content: '\n', textStyle: defaultTextStyle() } })
      } else if (tag === 'text:span') {
        const spanStyleName = child.getAttribute('text:style-name')
        const spanStyle = styleMap.get(spanStyleName) || {}
        const s = defaultTextStyle()
        if (style.bold || spanStyle.bold) s.bold = true
        if (style.italic || spanStyle.italic) s.italic = true
        if (style.underline || spanStyle.underline) s.underline = true
        const fs = spanStyle.fontSize || style.fontSize
        if (fs) {
          const match = fs.match(/(\d+(?:\.\d+)?)pt/)
          if (match) s.fontSize = Math.round(parseFloat(match[1]) * 1.333)
        }
        elements.push({ textRun: { content: child.textContent || '', textStyle: s } })
      } else {
        elements.push({ textRun: { content: child.textContent || '', textStyle: defaultTextStyle() } })
      }
    }
  }
  if (elements.length === 0) {
    elements.push({ textRun: { content: '', textStyle: defaultTextStyle() } })
  }
  return elements
}

export async function importOdt(arrayBuffer) {
  const JSZip = await loadJSZip()
  const zip = await JSZip.loadAsync(arrayBuffer)
  const contentXml = await zip.file('content.xml')?.async('string')
  if (!contentXml) throw new Error('Invalid ODT: content.xml not found')

  const parser = new DOMParser()
  const doc = parser.parseFromString(contentXml, 'application/xml')

  // Build style map (for inline bold/italic/underline/font-size + heading level).
  const styleMap = new Map()
  const styles = doc.querySelectorAll('style\\:style, style\\:style')
  for (const style of styles) {
    const name = style.getAttribute('style:name')
    const family = style.getAttribute('style:family')
    if (!name) continue
    const props = style.querySelector('style\\:text-properties, text-properties')
    const paraProps = style.querySelector('style\\:paragraph-properties, paragraph-properties')
    styleMap.set(name, {
      family,
      bold: props?.getAttribute?.('fo:font-weight') === 'bold',
      italic: props?.getAttribute?.('fo:font-style') === 'italic',
      underline: props?.getAttribute?.('style:text-underline-style') != null,
      fontSize: props?.getAttribute?.('fo:font-size'),
      headingLevel: family === 'paragraph' ? detectHeadingLevel(paraProps, name) : 0,
    })
  }

  const sections = []
  let current = null
  const textPs = doc.querySelectorAll('text\\:p, text\\:h')
  for (const textP of textPs) {
    const styleName = textP.getAttribute('text:style-name')
    const style = styleMap.get(styleName) || {}
    const isHeading = textP.nodeName === 'text:h' || style.headingLevel > 0
    const level = textP.nodeName === 'text:h'
      ? parseInt(textP.getAttribute('text:outline-level') || '1', 10)
      : style.headingLevel || 0
    const elements = odtElementsToRuns(textP, style, styleMap)

    if (isHeading) {
      if (current) sections.push(current)
      current = {
        id: generateSectionId(),
        title: runText(elements),
        sectionType: level === 2 ? 'chapter' : 'section',
        paragraphs: [],
      }
    } else {
      if (!current) current = { id: generateSectionId(), title: '', sectionType: 'section', paragraphs: [] }
      current.paragraphs.push(makeParagraph(elements))
    }
  }
  if (current) sections.push(current)
  return finalizeSections(sections)
}

function detectHeadingLevel(paraProps, styleName) {
  if (!styleName) return 0
  const lower = styleName.toLowerCase()
  if (lower.includes('heading') || lower.includes('title')) {
    const match = lower.match(/(\d)/)
    return match ? parseInt(match[1], 10) : 1
  }
  if (paraProps) {
    const level = paraProps.getAttribute('text:outline-level')
    if (level) return parseInt(level, 10)
  }
  return 0
}