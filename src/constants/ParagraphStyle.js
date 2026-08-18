export const ParagraphStyle = Object.freeze({
  Normal: 'normal',
  Heading1: 'heading1',
  Heading2: 'heading2',
  Heading3: 'heading3',
  Heading4: 'heading4',
  Heading5: 'heading5',
  Heading6: 'heading6',
})

export function isHeading(style) {
  return typeof style === 'string' && style.startsWith('heading')
}

export function getHeadingLevel(style) {
  if (!isHeading(style)) return 0
  return parseInt(style.replace('heading', ''), 10) || 0
}

export function isEmptyParagraph(p) {
  if (!p || !p.elements) return true
  const text = p.elements.map(el => el.textRun.content).join('')
  return !text.trim()
}

export function shouldHaveFirstLineIndent(paragraphs, index) {
  if (index === 0) return false
  const prev = paragraphs[index - 1]
  if (!prev) return false
  if (isHeading(prev.paragraphStyle)) return false
  if (isEmptyParagraph(prev)) return false
  return true
}
