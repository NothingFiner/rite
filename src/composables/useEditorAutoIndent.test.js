import { describe, it, expect } from 'vitest'
import { buildEditorHTML } from './useEditorRender.js'

// SPEC.md follow-up to 5.18, S-032. `buildEditorHTML` is pure, so the render
// classification (automatic vs explicit first-line indent) is pinned here
// without a DOM. `parseParagraphElement` reads the marker back as `null`, so
// without it the first sync would freeze the indent into an explicit number.

const paragraph = (id, text, firstLineIndent = null) => ({
  id,
  elements: [{ textRun: { content: text, textStyle: {} } }],
  leftIndent: null,
  rightIndent: null,
  firstLineIndent,
})

const section = (id, title, paragraphs) => ({
  id,
  sectionType: 'section',
  title,
  hidden: false,
  paragraphs,
})

/// The opening `<div …>` tag of the paragraph with `data-para-id="id"`.
function tagFor(html, id) {
  const match = html.match(new RegExp(`<div[^>]*data-para-id="${id}"[^>]*>`))
  expect(match, `no paragraph tag for ${id} in ${html}`).not.toBeNull()
  return match[0]
}

describe('buildEditorHTML — automatic indent marker', () => {
  it('S-032: marks automatic paragraphs and renders explicit ones exactly as before', () => {
    const sections = [
      section('s1', 'A', [
        paragraph('p1', 'auto first', null),
        paragraph('p2', 'auto second', null),
        paragraph('p3', 'explicit half', 0.5),
        paragraph('p4', 'explicit flush', 0),
      ]),
    ]

    const { html } = buildEditorHTML(sections, { formatChapter: (i) => `Ch${i}: ` })

    // Automatic and first in its section, so it computes to 0 and renders
    // without an inline indent. The marker keeps that 0 automatic on readback.
    const p1 = tagFor(html, 'p1')
    expect(p1).toContain('data-auto-indent="true"')
    expect(p1).toContain('no-indent')
    expect(p1).not.toContain('text-indent')

    // Automatic after a non-empty paragraph, so it computes to 0.5 in (48 px).
    const p2 = tagFor(html, 'p2')
    expect(p2).toContain('data-auto-indent="true"')
    expect(p2).toContain('text-indent:48px')

    // An explicit value renders without the marker. Otherwise the readback
    // would turn the writer's number back into an automatic indent.
    expect(tagFor(html, 'p3')).toBe(
      '<div class="paragraph" data-para-id="p3" data-section-id="s1" style="text-indent:48px">',
    )
    expect(tagFor(html, 'p4')).toBe(
      '<div class="paragraph no-indent" data-para-id="p4" data-section-id="s1">',
    )
  })
})
