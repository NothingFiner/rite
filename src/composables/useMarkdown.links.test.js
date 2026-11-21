import { describe, it, expect } from 'vitest'
import { renderReferenceMarkdown } from './useMarkdown.js'

// Reference links in a note or a definition (SPEC.md revision 5, S-084 … S-089).
//
// The record is the same one 5.19a's own tests use: a character whose full name
// and first name collide, an alias on the shorter one, and a place that shares
// the full name's surname. Resolution is whole-text equality, so the collision
// is only about aliases here, not about matching a fragment of a name.

const entry = (id, kind, name, aliases = []) => ({
  id,
  kind,
  name,
  definition: '',
  aliases,
  tags: [],
  facts: [],
  includedSections: [],
  excludedSections: [],
})

const references = {
  entries: [
    entry('e-qualen', 'character', 'Izildar Qualen'),
    entry('e-izildar', 'character', 'Izildar', ['Izi']),
    entry('e-square', 'place', 'Qualen Square'),
  ],
}

/// The anchors in rendered output, as raw tags. Every absence assertion below
/// is paired with one of these on a link that must resolve, so a renderer that
/// produces no anchors at all cannot pass by doing nothing.
const anchors = (html) => html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) || []
const linkedIds = (html) => anchors(html).map((tag) => (tag.match(/data-entry-id="([^"]+)"/) || [])[1])
const linkText = (tag) => tag.replace(/<[^>]+>/g, '')

describe('reference links in rendered markdown', () => {
  it('S-084: links a bracketed name that equals an entry name, ignoring case', () => {
    const html = renderReferenceMarkdown('Named for [[izildar qualen]].', references)

    expect(linkedIds(html)).toEqual(['e-qualen'])
  })

  it('S-085: shows the text the writer typed, not the entry canonical name', () => {
    const html = renderReferenceMarkdown('Named for [[izildar qualen]].', references)
    const tags = anchors(html)

    expect(tags).toHaveLength(1)
    expect(linkText(tags[0])).toBe('izildar qualen')
  })

  it('S-086: resolves an alias to the entry that owns it and shows the alias', () => {
    const html = renderReferenceMarkdown('[[Izi]] waited by the door.', references)

    expect(linkedIds(html)).toEqual(['e-izildar'])
    expect(linkText(anchors(html)[0])).toBe('Izi')
  })

  it('S-087: leaves a bracketed name with no entry as literal text', () => {
    const html = renderReferenceMarkdown('The [[Ashfall]] fell, and [[Izi]] waited.', references)

    expect(html).toContain('[[Ashfall]]')
    expect(linkedIds(html)).toEqual(['e-izildar'])
  })

  it('S-088: leaves an old name literal after the entry was renamed', () => {
    const renamed = { entries: [entry('e-qualen', 'character', 'Izildar Queln')] }
    const html = renderReferenceMarkdown('[[Izildar Qualen]] became [[Izildar Queln]].', renamed)

    expect(html).toContain('[[Izildar Qualen]]')
    expect(linkedIds(html)).toEqual(['e-qualen'])
  })

  it('S-089: leaves escaped and unclosed brackets literal and does not throw', () => {
    const escaped = renderReferenceMarkdown('Escaped \\[[Izi]] here.', references)
    const unclosed = renderReferenceMarkdown('Unclosed [[Izi here.', references)
    const control = renderReferenceMarkdown('Linked [[Izi]] here.', references)

    expect(anchors(escaped)).toHaveLength(0)
    expect(anchors(unclosed)).toHaveLength(0)
    expect(linkedIds(control)).toEqual(['e-izildar'])
  })
})
