import { describe, it, expect } from 'vitest'
import { buildEditorHTML } from './useEditorRender.js'
import { renderBlockHTML } from './useEditorReconcile.js'

// buildEditorHTML is pure (no Vue, no DOM) so it's fully unit-testable. The
// render-derived chapter prefix is injected via `formatChapter` so the tests
// don't depend on the shared useSectionFormat prefs; a tiny deterministic one
// encodes the index verbatim.

const formatChapter = (i) => `Ch${i}: `

const section = (id, title, paragraphIds, sectionType = 'section') => ({
  id,
  sectionType,
  title,
  paragraphs: paragraphIds.map((pid) => ({
    id: pid,
    elements: [{ textRun: { content: pid + '-text', textStyle: {} } }],
    leftIndent: null,
    rightIndent: null,
    firstLineIndent: null,
  })),
})

describe('buildEditorHTML', () => {
  it('builds an empty sheet for no sections', () => {
    const r = buildEditorHTML([], { formatChapter })
    expect(r.html).toBe('')
    expect(r.blocks).toEqual([])
    expect(r.sectionCount).toBe(0)
  })

  it('builds an empty sheet for a null sections list', () => {
    const r = buildEditorHTML(null, { formatChapter })
    expect(r.html).toBe('')
    expect(r.blocks).toEqual([])
    expect(r.sectionCount).toBe(0)
  })

  it('renders a chapter (with derived prefix) then a section then paragraphs', () => {
    const sections = [
      section('s1', 'The Reveal', ['p1', 'p2'], 'chapter'),
      section('s2', 'Opening', ['p3']),
    ]
    const { html, blocks, sectionCount } = buildEditorHTML(sections, { formatChapter })

    // Chapter title: locked prefix span + editable subtitle span, contenteditable
    // false (not fresh). The derived prefix is the injected formatChapter(1).
    expect(html).toContain('<div class="section-title chapter" data-section-id="s1" data-section-type="chapter" contenteditable="false">')
    expect(html).toContain('<span class="chapter-prefix" contenteditable="false">Ch1: </span>')
    expect(html).toContain('<span class="section-subtitle">The Reveal</span>')
    // Section title: a single editable title-text span, no prefix, no chapter class.
    expect(html).toContain('<div class="section-title" data-section-id="s2" data-section-type="section" contenteditable="false"><span class="section-title-text">Opening</span></div>')
    // Paragraphs carry their para id + section id. p1 is the first paragraph of
    // its section (indent 0) so it gets the no-indent class.
    expect(html).toContain('class="paragraph no-indent" data-para-id="p1" data-section-id="s1"')
    expect(html).toContain('p1-text')

    // The baked block list matches the rendered order: title, p1, p2, title, p3.
    expect(blocks.map((b) => b.kind)).toEqual([
      'section-title', 'paragraph', 'paragraph', 'section-title', 'paragraph',
    ])
    expect(blocks[0]).toMatchObject({ kind: 'section-title', sectionId: 's1', sectionType: 'chapter', chapterIndex: 1 })
    expect(blocks[3]).toMatchObject({ kind: 'section-title', sectionId: 's2', sectionType: 'section', chapterIndex: null })
    expect(sectionCount).toBe(2)
  })

  it('numbers chapters with a 1-based running count that skips non-chapters', () => {
    const sections = [
      section('c1', 'One', ['p1'], 'chapter'),
      section('x1', 'Inter', ['p2'], 'section'),
      section('c2', 'Two', ['p3'], 'chapter'),
    ]
    const { html, blocks } = buildEditorHTML(sections, { formatChapter })
    // The prefix and subtitle live in separate spans, so "Ch2: Two" is never a
    // contiguous substring — assert them independently.
    expect(html).toContain('<span class="chapter-prefix" contenteditable="false">Ch1: </span>')
    expect(html).toContain('<span class="chapter-prefix" contenteditable="false">Ch2: </span>')
    expect(html).not.toContain('Ch2: One') // the second chapter is c2, not inter
    expect(html).toContain('<span class="section-subtitle">Two</span>')
    expect(blocks[0].chapterIndex).toBe(1)
    expect(blocks[2].chapterIndex).toBe(null) // section, not chapter
    expect(blocks[4].chapterIndex).toBe(2)
  })

  it('bakes section-aware first-line indents: 0 for a section-first paragraph, 0.5 after a body paragraph', () => {
    const sections = [section('s1', 'T', ['p1', 'p2'])]
    const { blocks } = buildEditorHTML(sections, { formatChapter })
    // p1 is the first paragraph after the section-title → indent 0.
    expect(blocks[1].paragraph.firstLineIndent).toBe(0)
    // p2 follows a non-empty body paragraph → indent 0.5.
    expect(blocks[2].paragraph.firstLineIndent).toBe(0.5)
  })

  it('reflects the baked indent in the rendered paragraph HTML', () => {
    const sections = [section('s1', 'T', ['p1', 'p2'])]
    const { html } = buildEditorHTML(sections, { formatChapter })
    // p1 (indent 0) gets the no-indent class and no text-indent style.
    expect(html).toContain('class="paragraph no-indent" data-para-id="p1"')
    // p2 (indent 0.5) gets a text-indent style (0.5 * 96 = 48px).
    expect(html).toContain('text-indent:48px')
  })

  it('renders a fresh section title editable so the user can type its subtitle inline', () => {
    const sections = [section('s1', '', ['p1'], 'chapter')]
    const { html } = buildEditorHTML(sections, { freshSectionId: 's1', formatChapter })
    // fresh → contenteditable="true" on the title div.
    expect(html).toContain('data-section-id="s1" data-section-type="chapter" contenteditable="true">')
    // A non-fresh title stays locked.
    const { html: html2 } = buildEditorHTML(sections, { freshSectionId: null, formatChapter })
    expect(html2).toContain('data-section-id="s1" data-section-type="chapter" contenteditable="false">')
  })

  it('omits the chapter prefix entirely when formatChapter is not supplied', () => {
    // A chapter still renders, but with an empty prefix span (the index is
    // baked but no formatter was injected).
    const sections = [section('c1', 'One', ['p1'], 'chapter')]
    const { html } = buildEditorHTML(sections, {})
    expect(html).toContain('<span class="chapter-prefix" contenteditable="false"></span>')
    expect(html).toContain('class="section-title chapter"')
  })

  it('prepends an epigram block when hasEpigram and epigramText are both truthy', () => {
    const sections = [section('s1', 'T', ['p1'])]
    const { html } = buildEditorHTML(sections, {
      formatChapter,
      hasEpigram: true,
      epigramText: 'A quote\non two lines',
    })
    expect(html.indexOf('<div class="epigram-block">')).toBe(0) // epigram is FIRST
    expect(html).toContain('A quote<br>on two lines') // newlines → <br>
  })

  it('does not prepend an epigram block when hasEpigram is false or text is empty', () => {
    const sections = [section('s1', 'T', ['p1'])]
    const noFlag = buildEditorHTML(sections, { formatChapter, hasEpigram: false, epigramText: 'x' })
    expect(noFlag.html).not.toContain('epigram-block')
    const noText = buildEditorHTML(sections, { formatChapter, hasEpigram: true, epigramText: '' })
    expect(noText.html).not.toContain('epigram-block')
  })

  it('escapes HTML in the epigram text', () => {
    const sections = [section('s1', 'T', ['p1'])]
    const { html } = buildEditorHTML(sections, {
      formatChapter,
      hasEpigram: true,
      epigramText: '<script>',
    })
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('shallow-copies paragraph blocks so baking indents does not mutate the input paragraphs', () => {
    const sections = [section('s1', 'T', ['p1', 'p2'])]
    const originalIndent = sections[0].paragraphs[1].firstLineIndent
    buildEditorHTML(sections, { formatChapter })
    // The store's reactive paragraph object is untouched.
    expect(sections[0].paragraphs[1].firstLineIndent).toBe(originalIndent)
  })

  it('renders a hidden section title as a dimmed marker with data-section-hidden (5.10)', () => {
    const sections = [{ ...section('s1', 'Epigram', ['p1']), hidden: true }]
    const { html, blocks } = buildEditorHTML(sections, { formatChapter })
    expect(blocks[0].hidden).toBe(true)
    expect(html).toContain('class="section-title section-hidden"')
    expect(html).toContain('data-section-hidden="true"')
    // The title text still renders — the marker is how the writer finds it.
    expect(html).toContain('Epigram')
    // The section's body paragraphs render normally.
    expect(html).toContain('p1-text')
  })

  it('stamps hidden:false on title blocks when the sections are not hidden', () => {
    const sections = [section('s1', 'T', ['p1'])]
    const { blocks } = buildEditorHTML(sections, { formatChapter })
    expect(blocks[0].hidden).toBe(false)
  })

  // Byte-identity (5.10): buildEditorHTML and renderBlockHTML must emit the
  // same HTML for the same block — the reconciler decides keep-vs-replace by
  // one string compare, so a hidden section rendered by one but not the
  // other would falsely `replace` every title on every reconcile.
  it('is byte-identical to renderBlockHTML joined over the baked blocks (incl. a hidden section)', () => {
    const sections = [
      { ...section('s1', 'Epigram', ['p1']), hidden: true },
      section('c1', 'One', ['p2'], 'chapter'),
      section('s2', 'Opening', ['p3']),
    ]
    const opts = { freshSectionId: null, formatChapter }
    const { html, blocks } = buildEditorHTML(sections, opts)
    const perBlock = blocks.map((b) => renderBlockHTML(b, opts)).join('')
    expect(html).toBe(perBlock)
  })
})