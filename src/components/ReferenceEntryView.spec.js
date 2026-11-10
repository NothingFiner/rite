import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ReferenceEntryView from './ReferenceEntryView.vue'

// SPEC.md 5.19a's detail-page sentences: S-008 and S-009.

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))

const baseEntry = {
  id: 'r1',
  kind: 'character',
  name: 'Izildar Qualen',
  definition: '',
  aliases: [],
  tags: [],
  facts: [],
  includedSections: [],
  excludedSections: [],
}

function mountEntry(overrides = {}) {
  return mount(ReferenceEntryView, {
    props: { entry: { ...baseEntry, ...overrides }, mentions: [] },
  })
}

describe('ReferenceEntryView', () => {
  it('S-008: renders the definition as markdown', () => {
    const wrapper = mountEntry({ definition: 'The **seasonal** fall of grey ash.' })

    const definition = wrapper.find('.reference-definition')
    expect(definition.exists()).toBe(true)
    expect(definition.html()).toContain('<strong>seasonal</strong>')
    expect(wrapper.find('.reference-definition-empty').exists()).toBe(false)
  })

  it('S-008: shows an empty definition as an editable empty state', () => {
    const wrapper = mountEntry({ definition: '' })

    expect(wrapper.find('.reference-definition').exists()).toBe(false)
    expect(wrapper.find('.reference-definition-empty').exists()).toBe(true)
    expect(wrapper.find('.reference-definition-source').exists()).toBe(true)
  })

  it('S-009: shows aliases, tags and facts beside the definition', () => {
    const wrapper = mountEntry({
      aliases: ['Essidor Agjadoff', 'Qualen'],
      tags: ['history', 'exile'],
      facts: [{ label: 'Wants', value: 'the record back' }],
    })

    expect(wrapper.findAll('.reference-alias').map((el) => el.text())).toEqual([
      'Essidor Agjadoff',
      'Qualen',
    ])
    expect(wrapper.findAll('.reference-tag').map((el) => el.text())).toEqual(['history', 'exile'])
    const fact = wrapper.find('.reference-fact')
    expect(fact.exists()).toBe(true)
    expect(fact.text()).toContain('Wants')
    expect(fact.text()).toContain('the record back')
  })
})
