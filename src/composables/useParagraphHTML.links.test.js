import { describe, it, expect } from 'vitest'
import { paragraphToHTML } from './useParagraphHTML.js'
import { renderReferenceMarkdown } from './useMarkdown.js'

// The manuscript is not a markdown surface (SPEC.md revision 5, S-107).
//
// Brackets typed into a paragraph are ordinary characters: they are counted,
// searched, exported and diffed as text, and nothing turns them into a link.
// The note renderer is asserted beside it, because "no link here" only means
// something when the same name does link there.

const references = {
  entries: [
    {
      id: 'e-izildar',
      kind: 'character',
      name: 'Izildar',
      definition: '',
      aliases: ['Izi'],
      tags: [],
      facts: [],
      includedSections: [],
      excludedSections: [],
    },
  ],
}

const paragraph = (text) => ({
  id: 'p-1',
  elements: [
    {
      textRun: {
        content: text,
        textStyle: { bold: false, italic: false, underline: false, fontSize: null },
      },
    },
  ],
  leftIndent: null,
  rightIndent: null,
  firstLineIndent: null,
})

const anchors = (html) => html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) || []

describe('brackets in the manuscript', () => {
  it('S-107: keeps [[Name]] as ordinary paragraph text, while a note links it', () => {
    const html = paragraphToHTML(paragraph('[[Izi]] waited by the door.'), {
      manuscript: false,
      sectionId: 's1',
    })

    expect(anchors(html)).toHaveLength(0)
    expect(html).toContain('[[Izi]]')

    expect(anchors(renderReferenceMarkdown('[[Izi]] waited by the door.', references))).toHaveLength(1)
  })
})
