import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import ReferencesNavDrawer from './ReferencesNavDrawer.vue'
import { doc, section } from '../composables/outlineFixtures.js'

// SPEC.md 5.19a's drawer sentences: S-004 through S-007 and S-018. The 5.20a
// outline sentences stay in ReferencesNavDrawer.spec.js; this file covers the
// two surfaces 5.19a adds.

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))

const outlineDoc = doc([
  section('c1', 'Chapter One', 'chapter'),
  section('s1', 'The Door', 'section'),
])

const entry = (id, kind, name) => ({
  id,
  kind,
  name,
  definition: '',
  aliases: [],
  tags: [],
  facts: [],
  includedSections: [],
  excludedSections: [],
})

const references = {
  entries: [
    entry('r-term', 'term', 'Ashfall'),
    entry('r-character', 'character', 'Maren'),
    entry('r-place', 'place', 'Qualen Square'),
  ],
}

function makeStore(overrides = {}) {
  return reactive({ doc: reactive(outlineDoc), notes: { overview: '', sections: {}, orphaned: '' }, ...overrides })
}

function mountDrawer(props = {}) {
  return mount(ReferencesNavDrawer, {
    props: { store: makeStore(), selectedId: 'overview', references, ...props },
  })
}

const surfaceTab = (wrapper, surface) => wrapper.find(`.surface-tab[data-surface="${surface}"]`)
const entryRows = (wrapper) => wrapper.findAll('.reference-entry')

describe('ReferencesNavDrawer surfaces', () => {
  it('S-004: offers Outline, Characters and Glossary with all three enabled', () => {
    const wrapper = mountDrawer()

    expect(surfaceTab(wrapper, 'outline').exists()).toBe(true)
    expect(surfaceTab(wrapper, 'characters').exists()).toBe(true)
    expect(surfaceTab(wrapper, 'glossary').exists()).toBe(true)
    expect(surfaceTab(wrapper, 'characters').attributes('disabled')).toBeUndefined()
    expect(surfaceTab(wrapper, 'glossary').attributes('disabled')).toBeUndefined()
  })

  it('S-005: lists characters on the Characters surface', () => {
    const wrapper = mountDrawer({ surface: 'characters' })

    const ids = entryRows(wrapper).map((row) => row.attributes('data-entry-id'))
    expect(ids).toEqual(['r-character'])
  })

  it('S-005: lists terms and places on the Glossary surface', () => {
    const wrapper = mountDrawer({ surface: 'glossary' })

    const ids = entryRows(wrapper).map((row) => row.attributes('data-entry-id'))
    expect(ids.sort()).toEqual(['r-place', 'r-term'])
  })

  it('S-006: offers one add control per reference surface and none on Outline', () => {
    const characters = mountDrawer({ surface: 'characters' })
    const characterAdds = characters.findAll('[data-add-kind]')
    expect(characterAdds).toHaveLength(1)
    expect(characterAdds[0].attributes('data-add-kind')).toBe('character')

    // Glossary adds a term. The page switches it to a place.
    const glossary = mountDrawer({ surface: 'glossary' })
    const glossaryAdds = glossary.findAll('[data-add-kind]')
    expect(glossaryAdds).toHaveLength(1)
    expect(glossaryAdds[0].attributes('data-add-kind')).toBe('term')

    const outline = mountDrawer({ surface: 'outline' })
    expect(outline.find('.reference-add').exists()).toBe(false)
  })

  it('S-044: renders the three surfaces as one tab group with exactly one selected', () => {
    const wrapper = mountDrawer({ surface: 'characters' })

    expect(wrapper.find('.surface-tabs').attributes('role')).toBe('tablist')

    const tabs = wrapper.findAll('.surface-tab')
    expect(tabs).toHaveLength(3)
    expect(tabs.every((tab) => tab.attributes('role') === 'tab')).toBe(true)

    const selected = tabs.filter((tab) => tab.attributes('aria-selected') === 'true')
    expect(selected).toHaveLength(1)
    expect(selected[0].attributes('data-surface')).toBe('characters')
  })

  it('S-045: shows no Regenerate all control in the References drawer', () => {
    // Mount with a configured model: the removed control only rendered then.
    const wrapper = mountDrawer({
      surface: 'characters',
      settings: { settings: { model: 'llama3' } },
    })

    expect(wrapper.text()).not.toContain('Regenerate all')
  })

  it('S-007: reports the chosen kind when an entry is added', async () => {
    const wrapper = mountDrawer({ surface: 'characters' })

    const addCharacter = wrapper.find('[data-add-kind="character"]')
    expect(addCharacter.exists()).toBe(true)
    await addCharacter.trigger('click')

    expect(wrapper.emitted('add-entry')).toBeTruthy()
    expect(wrapper.emitted('add-entry')[0]).toEqual(['character'])
  })

  it('S-018: shows an empty state on both reference surfaces', () => {
    const empty = { entries: [] }

    const characters = mountDrawer({ surface: 'characters', references: empty })
    expect(characters.find('.reference-empty').exists()).toBe(true)

    const glossary = mountDrawer({ surface: 'glossary', references: empty })
    expect(glossary.find('.reference-empty').exists()).toBe(true)
  })
})
