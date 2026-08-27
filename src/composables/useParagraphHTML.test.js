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

    it('renders a chapter subtitle as <br> when empty', () => {
      const section = { id: 's1', title: '', sectionType: 'chapter' }
      const html = sectionTitleToHTML(section, 3, 'Chapter 3: ', { fresh: false })
      expect(html).toContain('Chapter 3: ')
      expect(html).toContain('<span class="section-subtitle"><br></span>')
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

    it('renders a manuscript-mode section as one styled ms-para line', () => {
      const section = { id: 's2', title: 'Prologue', sectionType: 'section' }
      const html = sectionTitleToHTML(section, null, '', { manuscript: true })
      expect(html).toContain('class="ms-para section"')
      expect(html).toContain('Prologue')
    })
  })
})

function makePara(content) {
  return {
    id: 'p-' + Math.random().toString(36).slice(2),
    elements: [{ textRun: { content, textStyle: {} } }],
  }
}