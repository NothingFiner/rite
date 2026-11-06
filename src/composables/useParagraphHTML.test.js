import { describe, it, expect } from 'vitest'
import { escapeHtml, isSceneBreak, paragraphToHTML, paragraphsToHTML, sectionTitleToHTML } from './useParagraphHTML.js'
import { isEmptyParagraph, shouldHaveFirstLineIndent } from '../constants/ParagraphStyle.js'

describe('useParagraphHTML', () => {
  describe('escapeHtml', () => {
    it('escapes HTML special characters', () => {
      const result = escapeHtml('<div>Hello & goodbye"friend"\'s</div>')
      expect(result).toContain('&lt;div&gt;')
      expect(result).toContain('&amp;')
      expect(result).not.toContain('<div>')
      expect(result).not.toContain('</div>')
    })

    it('returns plain text unchanged', () => {
      expect(escapeHtml('Just plain text')).toBe('Just plain text')
    })
  })

  describe('isSceneBreak', () => {
    it('detects scene break markers', () => {
      expect(isSceneBreak(makePara('#'))).toBe(true)
      expect(isSceneBreak(makePara('*'))).toBe(true)
      expect(isSceneBreak(makePara('***'))).toBe(true)
      expect(isSceneBreak(makePara('###'))).toBe(true)
    })

    it('returns false for regular text', () => {
      expect(isSceneBreak(makePara('Hello world'))).toBe(false)
      expect(isSceneBreak(makePara('  '))).toBe(false)
    })
  })

  describe('isEmptyParagraph', () => {
    it('detects empty paragraphs', () => {
      expect(isEmptyParagraph(makePara(''))).toBe(true)
      expect(isEmptyParagraph(makePara('   '))).toBe(true)
      expect(isEmptyParagraph(makePara('\n\t'))).toBe(true)
    })

    it('returns false for non-empty paragraphs', () => {
      expect(isEmptyParagraph(makePara('Hello'))).toBe(false)
    })

    it('handles missing elements', () => {
      expect(isEmptyParagraph(null)).toBe(true)
      expect(isEmptyParagraph({})).toBe(true)
    })
  })

  describe('shouldHaveFirstLineIndent', () => {
    it('returns false for the first paragraph', () => {
      const paragraphs = [makePara('First'), makePara('Second')]
      expect(shouldHaveFirstLineIndent(paragraphs, 0)).toBe(false)
    })

    it('returns false right after an empty paragraph (scene break)', () => {
      const paragraphs = [makePara('Before'), makePara(''), makePara('After scene break')]
      expect(shouldHaveFirstLineIndent(paragraphs, 2)).toBe(false)
    })

    it('returns true for normal middle paragraphs', () => {
      const paragraphs = [makePara('First'), makePara('Second'), makePara('Third')]
      expect(shouldHaveFirstLineIndent(paragraphs, 1)).toBe(true)
      expect(shouldHaveFirstLineIndent(paragraphs, 2)).toBe(true)
    })
  })

  describe('paragraphToHTML', () => {
    it('renders a body paragraph with data-section-id and data-para-id', () => {
      const p = makePara('Hello world')
      const html = paragraphToHTML(p, { sectionId: 's1' })
      expect(html).toContain('class="paragraph"')
      expect(html).toContain('Hello world')
      expect(html).toContain('data-para-id="')
      expect(html).toContain('data-section-id="s1"')
    })

    it('does not emit heading classes (headings are sections now)', () => {
      const html = paragraphToHTML(makePara('anything'))
      expect(html).not.toMatch(/heading-[1-6]/)
      expect(html).not.toContain('data-para-style')
    })

    it('applies manuscript classes', () => {
      const html = paragraphToHTML(makePara('Hello world'), { manuscript: true })
      expect(html).toContain('class="ms-para"')
    })

    it('applies no-indent class when firstLineIndent is 0 (manuscript)', () => {
      const p = { ...makePara('Hello world'), firstLineIndent: 0 }
      const html = paragraphToHTML(p, { manuscript: true })
      expect(html).toContain('no-indent')
    })

    it('applies inline styles for indent values', () => {
      const p = { ...makePara('test'), leftIndent: 0.5, rightIndent: 0.3, firstLineIndent: 1.0 }
      const html = paragraphToHTML(p)
      expect(html).toContain('margin-left:48px')
      expect(html).toContain('margin-right:29px')
      expect(html).toContain('text-indent:96px')
    })

    it('renders text runs with styles', () => {
      const p = {
        ...makePara(''),
        elements: [
          { textRun: { content: 'bold ', textStyle: { bold: true } } },
          { textRun: { content: 'italic', textStyle: { italic: true } } },
        ],
      }
      const html = paragraphToHTML(p)
      expect(html).toContain('font-weight:700')
      expect(html).toContain('font-style:italic')
    })
  })

  describe('paragraphsToHTML', () => {
    it('joins multiple paragraphs', () => {
      const html = paragraphsToHTML([makePara('First'), makePara('Second')])
      expect(html).toContain('First')
      expect(html).toContain('Second')
      const matches = html.match(/<div class="paragraph/g)
      expect(matches).toHaveLength(2)
    })
  })

  describe('sectionTitleToHTML', () => {
    it('renders a chapter with a locked prefix span + editable subtitle span', () => {
      const section = { id: 's1', title: 'The Arrival', sectionType: 'chapter' }
      const html = sectionTitleToHTML(section, 1, 'Chapter 1: ', { fresh: false })
      expect(html).toContain('class="section-title chapter"')
      expect(html).toContain('data-section-id="s1"')
      expect(html).toContain('data-section-type="chapter"')
      expect(html).toContain('class="chapter-prefix"')
      expect(html).toContain('contenteditable="false"')
      expect(html).toContain('Chapter 1: ')
      expect(html).toContain('class="section-subtitle"')
      expect(html).toContain('The Arrival')
    })

    it('renders a subtitle-less chapter as just the prefix — no colon, no subtitle span (5.9)', () => {
      const section = { id: 's1', title: '', sectionType: 'chapter' }
      const html = sectionTitleToHTML(section, 3, 'Chapter 3: ', { fresh: false })
      // "Chapter 3" clean: the ': ' separator joins prefix+subtitle — with
      // no subtitle there is nothing to join, so nothing else renders.
      expect(html).toContain('Chapter 3')
      expect(html).not.toContain(':')
      expect(html).not.toContain('section-subtitle')
      expect(html).toContain('contenteditable="false"')
    })

    it('keeps the colon + editable empty subtitle span for a FRESH chapter (inline typing)', () => {
      const section = { id: 's1', title: '', sectionType: 'chapter' }
      const html = sectionTitleToHTML(section, 3, 'Chapter 3: ', { fresh: true })
      expect(html).toContain('Chapter 3: ')
      expect(html).toContain('<span class="section-subtitle"><br></span>')
    })

    it('renders a chapter WITH a subtitle exactly as before (colon + span regression guard)', () => {
      const section = { id: 's1', title: 'The Arrival', sectionType: 'chapter' }
      const html = sectionTitleToHTML(section, 1, 'Chapter 1: ', { fresh: false })
      expect(html).toContain('Chapter 1: ')
      expect(html).toContain('<span class="section-subtitle">The Arrival</span>')
    })

    it('renders a freeform section with one editable title span', () => {
      const section = { id: 's2', title: 'Prologue', sectionType: 'section' }
      const html = sectionTitleToHTML(section, null, '', { fresh: false })
      expect(html).toContain('class="section-title"')
      expect(html).not.toContain('chapter')
      expect(html).toContain('data-section-type="section"')
      expect(html).toContain('class="section-title-text"')
      expect(html).toContain('Prologue')
    })

    it('marks a fresh section-title contenteditable so the user can type inline', () => {
      const section = { id: 's3', title: '', sectionType: 'chapter' }
      const html = sectionTitleToHTML(section, 1, 'Chapter 1: ', { fresh: true })
      // The outer div is editable (fresh); the prefix span stays locked.
      expect(html).toMatch(/contenteditable="true"[^>]*><span class="chapter-prefix" contenteditable="false"/)
    })

    it('renders a manuscript-mode chapter as one styled ms-para line', () => {
      const section = { id: 's1', title: 'The Arrival', sectionType: 'chapter' }
      const html = sectionTitleToHTML(section, 1, 'Chapter 1: ', { manuscript: true })
      expect(html).toContain('class="ms-para chapter"')
      expect(html).toContain('Chapter 1: The Arrival')
    })

    it('renders a manuscript-mode subtitle-less chapter as just "Chapter N"', () => {
      const section = { id: 's1', title: '', sectionType: 'chapter' }
      const html = sectionTitleToHTML(section, 1, 'Chapter 1: ', { manuscript: true })
      expect(html).toContain('class="ms-para chapter"')
      expect(html).toContain('Chapter 1')
      expect(html).not.toContain(':')
      expect(html).not.toContain('<br>')
    })

    it('renders a manuscript-mode section as one styled ms-para line', () => {
      const section = { id: 's2', title: 'Prologue', sectionType: 'section' }
      const html = sectionTitleToHTML(section, null, '', { manuscript: true })
      expect(html).toContain('class="ms-para section"')
      expect(html).toContain('Prologue')
    })
  })

  describe('sectionTitleToHTML hidden (5.10)', () => {
    it('marks a hidden editor chapter with section-hidden class + data attr, keeping its text', () => {
      const section = { id: 's1', title: 'The Arrival', sectionType: 'chapter', hidden: true }
      const html = sectionTitleToHTML(section, 1, 'Chapter 1: ', { fresh: false })
      expect(html).toContain('class="section-title chapter section-hidden"')
      expect(html).toContain('data-section-hidden="true"')
      // The marker still renders the text so it can be read/renamed.
      expect(html).toContain('The Arrival')
    })

    it('marks a hidden freeform editor section too', () => {
      const section = { id: 's2', title: 'Epigram', sectionType: 'section', hidden: true }
      const html = sectionTitleToHTML(section, null, '', { fresh: false })
      expect(html).toContain('class="section-title section-hidden"')
      expect(html).toContain('data-section-hidden="true"')
      expect(html).toContain('Epigram')
    })

    it('is byte-identical for a non-hidden section with and without the hidden field', () => {
      // hidden:false and NO hidden key at all must render the same string —
      // the reconciler decides keep-vs-replace by one string compare, so a
      // falsey flag can never perturb the output.
      const withFalse = { id: 's1', title: 'X', sectionType: 'chapter', hidden: false }
      const without = { id: 's1', title: 'X', sectionType: 'chapter' }
      expect(sectionTitleToHTML(withFalse, 1, 'Chapter 1: ', { fresh: false }))
        .toBe(sectionTitleToHTML(without, 1, 'Chapter 1: ', { fresh: false }))
      expect(sectionTitleToHTML(withFalse, 1, 'Chapter 1: ', { manuscript: true }))
        .toBe(sectionTitleToHTML(without, 1, 'Chapter 1: ', { manuscript: true }))
    })

    it('renders a hidden manuscript heading as an EMPTY ms-para (never omitted)', () => {
      // The pagination measurer collects `.ms-para` elements positionally and
      // indexes against the block list — an omitted element would shift every
      // later height. The empty element keeps the indices aligned (and the
      // page render display:none's it).
      const section = { id: 's1', title: 'Epigram', sectionType: 'section', hidden: true }
      const html = sectionTitleToHTML(section, null, '', { manuscript: true })
      expect(html).toBe('<p class="ms-para section-hidden" data-section-id="s1"></p>')
    })

    it('renders a hidden manuscript chapter heading the same empty way', () => {
      const section = { id: 's9', title: 'Cut Scene', sectionType: 'chapter', hidden: true }
      const html = sectionTitleToHTML(section, 2, 'Chapter 2: ', { manuscript: true })
      expect(html).toBe('<p class="ms-para section-hidden" data-section-id="s9"></p>')
    })
  })
})

function makePara(content) {
  return {
    id: 'p-' + Math.random().toString(36).slice(2),
    elements: [{ textRun: { content, textStyle: {} } }],
  }
}