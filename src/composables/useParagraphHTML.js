// HTML rendering for the editor and manuscript. Headings are no longer
// paragraphs — a heading is a Section.title rendered by `sectionTitleToHTML`.
// Paragraphs are all body text now (no `heading-N` class, no `data-para-style`),
// but they carry `data-section-id` so the editor's flat DOM knows which section
// each paragraph belongs to (the flat block sequence interleaves section-title
// markers with paragraph divs as siblings).

export function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text == null ? '' : text
  return div.innerHTML
}

export function isSceneBreak(p) {
  const text = (p.elements || []).map((el) => el.textRun.content).join('').trim()
  return text === '#' || text === '*' || text === '***' || text === '###'
}

/// Render a body paragraph to HTML.
///   manuscript: true → <p class="ms-para [scene-break] [no-indent]">…</p>
///   manuscript: false → <div class="paragraph [no-indent]" data-para-id
///                              data-section-id style>…</div>
/// `sectionId` is required for the editor branch so the flat DOM can map a
/// paragraph back to its owning section during DOM-sync.
export function paragraphToHTML(p, options = {}) {
  const { manuscript = false, sectionId = null } = options
  const runs = (p.elements || [])
    .map((el) => {
      const s = el.textRun.textStyle || {}
      const styles = []
      if (s.bold) styles.push('font-weight:700')
      if (s.italic) styles.push('font-style:italic')
      if (s.underline) styles.push('text-decoration:underline')
      if (!manuscript && s.fontSize) styles.push(`font-size:${s.fontSize}px`)
      const styleAttr = styles.length ? ` style="${styles.join(';')}"` : ''
      const text = escapeHtml(el.textRun.content)
      if (!styleAttr && !text) return ''
      if (!styleAttr) return text
      return `<span${styleAttr}>${text}</span>`
    })
    .join('')

  const content = runs || '<br>'
  const idAttr = p.id ? ` data-para-id="${p.id}"` : ''

  // Stored firstLineIndent takes precedence; default 0.5 for body paragraphs.
  const effectiveIndent =
    typeof p.firstLineIndent === 'number' ? p.firstLineIndent : 0.5

  if (manuscript) {
    const breakClass = isSceneBreak(p) ? ' scene-break' : ''
    const indentClass = effectiveIndent === 0 ? ' no-indent' : ''
    return `<p class="ms-para${breakClass}${indentClass}"${idAttr}>${content}</p>`
  }

  const paraStyles = []
  if (p.leftIndent) paraStyles.push(`margin-left:${Math.round(p.leftIndent * 96)}px`)
  if (p.rightIndent) paraStyles.push(`margin-right:${Math.round(p.rightIndent * 96)}px`)
  if (typeof p.firstLineIndent === 'number' && p.firstLineIndent > 0) {
    paraStyles.push(`text-indent:${Math.round(p.firstLineIndent * 96)}px`)
  }
  const paraStyleAttr = paraStyles.length ? ` style="${paraStyles.join(';')}"` : ''
  const sectionAttr = sectionId ? ` data-section-id="${sectionId}"` : ''

  let className = 'paragraph'
  if (typeof p.firstLineIndent === 'number' && p.firstLineIndent === 0) {
    className += ' no-indent'
  }

  return `<div class="${className}"${idAttr}${sectionAttr}${paraStyleAttr}>${content}</div>`
}

export function paragraphsToHTML(paragraphs, options = {}) {
  return paragraphs.map((p) => paragraphToHTML(p, options)).join('')
}

/// Render a section title (the heading). A Chapter shows a locked, render-
/// derived prefix ("Chapter 3: ") followed by a subtitle span when the
/// chapter HAS a subtitle; a subtitle-less chapter renders just "Chapter 3"
/// (the ': ' separator is stripped — the subtitle is optional data and
/// emptiness IS the off state, 5.9). The one exception: a FRESH chapter
/// (editor, just inserted) keeps the colon and renders the empty subtitle
/// span so the user can type the subtitle inline. A Section shows its full
/// title as one editable span. The chapter NUMBER is never stored — it is
/// derived from `chapterIndex` (1-based position among Chapter-type
/// sections) and baked into the prefix here, so inserting/deleting a
/// chapter renumbers all chapters with zero delta churn.
///
///   chapterPrefix: pre-formatted "Chapter 3: " string for a Chapter (the
///     caller computes it via useSectionFormat so this module stays Vue-free).
///   manuscript: true → a styled <p class="ms-para chapter|section"> heading
///     for the manuscript view and the pagination measurer.
///   fresh: editor only — render the title div editable so the user can type
///     the subtitle/title inline right after inserting the section.
export function sectionTitleToHTML(section, chapterIndex, chapterPrefix, options = {}) {
  const { manuscript = false, fresh = false } = options
  const idAttr = ` data-section-id="${section.id}"`
  const typeAttr = ` data-section-type="${section.sectionType}"`

  if (manuscript) {
    if (section.sectionType === 'chapter') {
      // The ': ' trailing on chapterPrefix exists to join prefix and
      // subtitle; a subtitle-less chapter has nothing to join, so it
      // renders as just "Chapter 2" (the subtitle is optional data —
      // emptiness IS the off state). Same strip idiom as the nav rows'
      // displayTitleFor.
      const prefixText = section.title ? chapterPrefix : (chapterPrefix || '').replace(/: $/, '')
      const text = escapeHtml(prefixText || '') + escapeHtml(section.title || '')
      return `<p class="ms-para chapter"${idAttr}>${text || '<br>'}</p>`
    }
    return `<p class="ms-para section"${idAttr}>${escapeHtml(section.title || '') || '<br>'}</p>`
  }

  const editable = fresh ? 'true' : 'false'

  if (section.sectionType === 'chapter') {
    const subtitle = section.title || ''
    // Show the subtitle span when there is one, or while the section is
    // fresh (the empty span is the inline type-a-subtitle affordance —
    // on blur it renders clean). Otherwise render ONLY the prefix.
    const showSubtitle = Boolean(subtitle) || fresh
    if (!showSubtitle) {
      const prefixText = (chapterPrefix || '').replace(/: $/, '')
      return `<div class="section-title chapter"${idAttr}${typeAttr} contenteditable="${editable}"><span class="chapter-prefix" contenteditable="false">${escapeHtml(prefixText)}</span></div>`
    }
    const subtitleHtml = subtitle ? escapeHtml(subtitle) : '<br>'
    // The prefix span is always contenteditable=false — the derived number is
    // never user-editable. The subtitle span inherits editability from the
    // (fresh) parent div.
    return `<div class="section-title chapter"${idAttr}${typeAttr} contenteditable="${editable}"><span class="chapter-prefix" contenteditable="false">${escapeHtml(chapterPrefix || '')}</span><span class="section-subtitle">${subtitleHtml}</span></div>`
  }

  const title = section.title || ''
  const titleHtml = title ? escapeHtml(title) : '<br>'
  return `<div class="section-title"${idAttr}${typeAttr} contenteditable="${editable}"><span class="section-title-text">${titleHtml}</span></div>`
}