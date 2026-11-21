import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ReferenceEntryView from './ReferenceEntryView.vue'

// A definition can point at another entry (S-093 of SPEC.md revision 5).
//
// Definitions and notes share one renderer, so a story bible gains a graph
// without new storage. Clicking such a link is S-094, which needs the shell and
// therefore lives in the e2e suite.

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))

const entry = (id, kind, name, definition, aliases = []) => ({
  id,
  kind,
  name,
  definition,
  aliases,
  tags: [],
  facts: [],
  includedSections: [],
  excludedSections: [],
})

const references = {
  entries: [
    entry('e-square', 'place', 'Qualen Square', 'Named for [[Izildar Queln]], though the statue is gone.'),
    entry('e-queln', 'character', 'Izildar Queln', 'The historical figure.'),
    entry('e-izildar', 'character', 'Izildar', 'The side character.', ['Izi']),
  ],
}

const anchors = (html) => html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) || []

describe('reference links in a definition', () => {
  it('S-093: links a bracketed name in the definition to the matching entry', () => {
    const wrapper = mount(ReferenceEntryView, {
      props: { entry: references.entries[0], mentions: [], references },
    })

    const tags = anchors(wrapper.find('.reference-definition').html())
    expect(tags).toHaveLength(1)
    expect(tags[0]).toContain('data-entry-id="e-queln"')
    expect(tags[0].replace(/<[^>]+>/g, '')).toBe('Izildar Queln')
  })
})
