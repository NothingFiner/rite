import { ParagraphStyle, isHeading, getHeadingLevel } from '../constants/ParagraphStyle.js'

export function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

export function isSceneBreak(p) {
  const text = p.elements.map(el => el.textRun.content).join('').trim()
  return text === '#' || text === '*' || text === '***' || text === '###'
}

export function paragraphToHTML(p, options = {}) {
  const { manuscript = false } = options
  const runs = p.elements.map((el) => {
    const s = el.textRun.textStyle || {}
    const styles = []
    if (s.bold) styles.push('font-weight:700')
    if (s.italic) styles.push('font-style:italic')
    if (s.underline) styles.push('text-decoration:underline')
    if (!manuscript && s.fontSize) styles.push(`font-size:${s.fontSize}px`)
    const styleAttr = styles.length ? ` style="${styles.join(';')}"` : ''
    const text = escapeHtml(el.textRun.content || '')
    if (!styleAttr && !text) return ''
    if (!styleAttr) return text
    return `<span${styleAttr}>${text}</span>`
  }).join('')

  const content = runs || '<br>'

  const idAttr = p.id ? ` data-para-id="${p.id}"` : ''

  // Determine first-line indent: stored value takes precedence.
  // For backward compat with old docs that lack the field, default to 0.5
  // for normal paragraphs and 0 for headings.
  const effectiveIndent = (() => {
    if (typeof p.firstLineIndent === 'number') return p.firstLineIndent
    if (isHeading(p.paragraphStyle)) return 0
    return 0.5
  })()

  if (manuscript) {
    const breakClass = isSceneBreak(p) ? ' scene-break' : ''
    const indentClass = effectiveIndent === 0 ? ' no-indent' : ''
    const level = getHeadingLevel(p.paragraphStyle)
    if (level > 0) {
      return `<p class="ms-para heading-${level}${breakClass}${indentClass}"${idAttr}>${content}</p>`
    }
    return `<p class="ms-para${breakClass}${indentClass}"${idAttr}>${content}</p>`
  }

  const paraStyles = []
  if (p.leftIndent) paraStyles.push(`margin-left:${Math.round(p.leftIndent * 96)}px`)
  if (p.rightIndent) paraStyles.push(`margin-right:${Math.round(p.rightIndent * 96)}px`)
  if (typeof p.firstLineIndent === 'number' && p.firstLineIndent > 0) {
    paraStyles.push(`text-indent:${Math.round(p.firstLineIndent * 96)}px`)
  }
  const paraStyleAttr = paraStyles.length ? ` style="${paraStyles.join(';')}"` : ''
  const styleAttr = p.paragraphStyle ? ` data-para-style="${p.paragraphStyle}"` : ''

  let className = 'paragraph'
  const level = getHeadingLevel(p.paragraphStyle)
  if (level > 0) className += ` heading-${level}`
  if (typeof p.firstLineIndent === 'number' && p.firstLineIndent === 0) {
    className += ' no-indent'
  }

  return `<div class="${className}"${idAttr}${styleAttr}${paraStyleAttr}>${content}</div>`
}

export function paragraphsToHTML(paragraphs, options = {}) {
  return paragraphs.map((p, i) => {
    return paragraphToHTML(p, options)
  }).join('')
}
