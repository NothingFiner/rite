import { describe, it, expect } from 'vitest'
import { escapeHtml, isSceneBreak, paragraphToHTML, paragraphsToHTML } from './useParagraphHTML.js'
import { ParagraphStyle, shouldHaveFirstLineIndent, isEmptyParagraph } from '../constants/ParagraphStyle.js'

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
    it('returns false for first paragraph', () => {
      const paragraphs = [makePara('First'), makePara('Second')]
      expect(shouldHaveFirstLineIndent(paragraphs, 0)).toBe(false)
    })

    it('returns false after heading', () => {
      const paragraphs = [makePara('CHAPTER 1', ParagraphStyle.Heading1), makePara('After heading')]
      expect(shouldHaveFirstLineIndent(paragraphs, 1)).toBe(false)
    })

    it('returns false after two empty paragraphs', () => {
      const paragraphs = [
        makePara('Before'),
        makePara(''),
        makePara(''),
        makePara('After scene break'),
      ]
      expect(shouldHaveFirstLineIndent(paragraphs, 3)).toBe(false)
    })

    it('returns true for normal middle paragraphs', () => {
      const paragraphs = [makePara('First'), makePara('Second'), makePara('Third')]
      expect(shouldHaveFirstLineIndent(paragraphs, 1)).toBe(true)
      expect(shouldHaveFirstLineIndent(paragraphs, 2)).toBe(true)
    })
  })

  describe('paragraphToHTML', () => {
    it('renders normal paragraph', () => {
      const p = makePara('Hello world')
      const html = paragraphToHTML(p)
      expect(html).toContain('class="paragraph"')
      expect(html).toContain('Hello world')
      expect(html).toContain('data-para-id="')
    })

    it('renders heading paragraph', () => {
      const p = makePara('CHAPTER 1', ParagraphStyle.Heading1)
      const html = paragraphToHTML(p)
      expect(html).toContain('class="paragraph heading-1"')
    })

    it('applies manuscript classes', () => {
      const p = makePara('Hello world')
      const html = paragraphToHTML(p, { manuscript: true })
      expect(html).toContain('class="ms-para"')
    })

    it('applies no-indent class when firstLineIndent is 0', () => {
      const p = { ...makePara('Hello world'), firstLineIndent: 0 }
      const html = paragraphToHTML(p, { manuscript: true })
      expect(html).toContain('no-indent')
    })

    it('applies inline styles for indent values', () => {
      const p = { id: 'test', paragraphStyle: ParagraphStyle.Normal, leftIndent: 0.5, rightIndent: 0.3, firstLineIndent: 1.0, elements: [{ textRun: { content: 'test', textStyle: {} } }] }
      const html = paragraphToHTML(p)
      expect(html).toContain('margin-left:48px')
      expect(html).toContain('margin-right:29px')
      expect(html).toContain('text-indent:96px')
    })

    it('renders text runs with styles', () => {
      const p = {
        id: 'test',
        paragraphStyle: ParagraphStyle.Normal,
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
      const paragraphs = [makePara('First'), makePara('Second')]
      const html = paragraphsToHTML(paragraphs)
      expect(html).toContain('First')
      expect(html).toContain('Second')
      const matches = html.match(/<div class="paragraph/g)
      expect(matches).toHaveLength(2)
    })
  })
})

function makePara(content, style = ParagraphStyle.Normal) {
  return {
    id: 'p-' + Math.random().toString(36).slice(2),
    paragraphStyle: style,
    elements: [{ textRun: { content, textStyle: {} } }],
  }
}
