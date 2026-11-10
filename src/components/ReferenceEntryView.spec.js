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

function mountEntry(overrides = {}, props = {}) {
  return mount(ReferenceEntryView, {
    props: { entry: { ...baseEntry, ...overrides }, mentions: [], ...props },
  })
}

// The two sections the appears-in picker offers: c1 is free, s1 already has a
// row. The picker must list c1 alone.
const sections = [
  { id: 'c1', title: 'Chapter One', sectionType: 'chapter' },
  { id: 's1', title: 'The Square', sectionType: 'section' },
]

const mention = (sectionId, title) => ({ sectionId, chapterIndex: 0, title })

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

// Revision 2: the page has to be usable, not only readable. Naming, editing a
// committed definition, correcting a mention and the kind switch all live here.
describe('ReferenceEntryView editing', () => {
  it('S-026: shows the display name as the heading, untitled while the name is blank', () => {
    const named = mountEntry()
    expect(named.find('.reference-entry-heading').text()).toBe('Izildar Qualen')

    expect(mountEntry({ name: '', kind: 'term' }).find('.reference-entry-heading').text())
      .toBe('Untitled term')
    expect(mountEntry({ name: '', kind: 'place' }).find('.reference-entry-heading').text())
      .toBe('Untitled place')
    expect(mountEntry({ name: '   ', kind: 'character' }).find('.reference-entry-heading').text())
      .toBe('Untitled character')
  })

  it('S-027: commits a new name', async () => {
    const wrapper = mountEntry()
    const field = wrapper.find('.reference-name')
    expect(field.exists()).toBe(true)

    await field.setValue('Essidor Agjadoff')
    await field.trigger('blur')

    expect(wrapper.emitted('rename')).toBeTruthy()
    expect(wrapper.emitted('rename')[0]).toEqual(['Essidor Agjadoff'])
  })

  it('S-028: shows the refusal naming the entry that owns the name', () => {
    const wrapper = mountEntry({ name: 'Izildar' }, {
      nameError: 'That name belongs to “Izildar Qualen”.',
    })

    const error = wrapper.find('.reference-name-error')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('Izildar Qualen')
  })

  it('S-029: clears the name error when the writer changes the field', async () => {
    const wrapper = mountEntry({}, { nameError: 'That name belongs to “Izildar Qualen”.' })
    expect(wrapper.find('.reference-name-error').exists()).toBe(true)

    await wrapper.find('.reference-name').setValue('Essidor Agjadoff')

    expect(wrapper.find('.reference-name-error').exists()).toBe(false)
  })

  it('S-030: reopens the source field from a rendered definition', async () => {
    const wrapper = mountEntry({ definition: 'The **seasonal** fall of grey ash.' })

    const edit = wrapper.find('.reference-definition-edit')
    expect(edit.exists()).toBe(true)
    await edit.trigger('click')

    const source = wrapper.find('.reference-definition-source')
    expect(source.exists()).toBe(true)
    expect(source.element.value).toBe('The **seasonal** fall of grey ash.')
  })

  it('S-031: saves an edit over the committed definition', async () => {
    const wrapper = mountEntry({ definition: 'Grey ash falls.' })

    await wrapper.find('.reference-definition-edit').trigger('click')
    await wrapper.find('.reference-definition-source').setValue('The **seasonal** fall of grey ash.')
    await wrapper.find('.reference-save').trigger('click')

    expect(wrapper.emitted('save-definition').at(-1))
      .toEqual(['The **seasonal** fall of grey ash.'])
  })

  it('S-032: cancels an edit and keeps the committed definition', async () => {
    const wrapper = mountEntry({ definition: 'Grey ash falls.' })

    await wrapper.find('.reference-definition-edit').trigger('click')
    await wrapper.find('.reference-definition-source').setValue('A draft nobody keeps.')
    await wrapper.find('.reference-edit-cancel').trigger('click')

    expect(wrapper.find('.reference-definition').text()).toContain('Grey ash falls.')
    expect(wrapper.emitted('save-definition')).toBeFalsy()
  })

  it('S-033: removes a mention from its own row', async () => {
    const wrapper = mountEntry({}, { mentions: [mention('s1', 'The Square')] })

    const remove = wrapper.find('.reference-mention[data-section-id="s1"] .reference-mention-remove')
    expect(remove.exists()).toBe(true)
    await remove.trigger('click')

    expect(wrapper.emitted('remove-mention')[0]).toEqual(['s1'])
  })

  it('S-034: offers only the sections the entry is not already shown in', () => {
    const wrapper = mountEntry({}, { mentions: [mention('s1', 'The Square')], sections })

    const picker = wrapper.find('.reference-mention-add')
    expect(picker.exists()).toBe(true)

    const offered = wrapper.findAll('.reference-section-option').map((option) => option.attributes('data-section-id'))
    expect(offered).toEqual(['c1'])
  })

  it('S-035: adds the chosen section by hand', async () => {
    const wrapper = mountEntry({}, { mentions: [], sections })

    await wrapper.find('.reference-mention-add').setValue('s1')

    expect(wrapper.emitted('include-section')[0]).toEqual(['s1'])
  })

  it('S-047: offers term and place as the only kind switch', async () => {
    const wrapper = mountEntry({ kind: 'term', name: 'Qualen Square' })

    const toggles = wrapper.findAll('.reference-kind-toggle')
    expect(toggles.map((toggle) => toggle.attributes('data-kind')).sort()).toEqual(['place', 'term'])

    const place = toggles.find((toggle) => toggle.attributes('data-kind') === 'place')
    await place.trigger('click')

    expect(wrapper.emitted('kind-change')[0]).toEqual(['place'])
  })
})
