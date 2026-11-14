import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ReferenceEntryView from './ReferenceEntryView.vue'

// SPEC.md 5.19a detail-page sentences, revisions 2 and 3.

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

function mountEntry(overrides = {}, props = {}, options = {}) {
  return mount(ReferenceEntryView, {
    props: { entry: { ...baseEntry, ...overrides }, mentions: [], ...props },
    ...options,
  })
}

// The two sections the appears-in picker offers: c1 is free, s1 already has a
// row. The picker must list c1 alone.
const sections = [
  { id: 'c1', title: 'Chapter One', sectionType: 'chapter' },
  { id: 's1', title: 'The Square', sectionType: 'section' },
]

const mention = (sectionId, title) => ({ sectionId, chapterIndex: 0, title })

afterEach(() => {
  // Focus assertions attach to the document, so each mount leaves a node behind.
  document.body.innerHTML = ''
})

describe('ReferenceEntryView', () => {
  it('S-008: renders the definition as markdown', () => {
    const wrapper = mountEntry({ definition: 'The **seasonal** fall of grey ash.' })

    const definition = wrapper.find('.reference-definition')
    expect(definition.exists()).toBe(true)
    expect(definition.html()).toContain('<strong>seasonal</strong>')
    expect(wrapper.find('.reference-definition-empty').exists()).toBe(false)
  })

  it('S-063: shows an empty definition as read-only prose with an edit control', async () => {
    const wrapper = mountEntry({ definition: '' })

    expect(wrapper.find('.reference-definition').exists()).toBe(false)
    expect(wrapper.find('.reference-definition-empty').text()).toContain('No definition yet')
    expect(wrapper.find('.reference-definition-source').exists()).toBe(false)

    const edit = wrapper.find('.reference-definition-edit')
    expect(edit.exists()).toBe(true)
    await edit.trigger('click')

    expect(wrapper.find('.reference-definition-source').exists()).toBe(true)
  })

  it('S-009: shows aliases, tags and facts in their groups', () => {
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

// Revision 2: the page has to be usable, not only readable. Revision 3 gives
// the page the paper palette and a display-first name.
describe('ReferenceEntryView editing', () => {
  it('S-053: paints the page with the theme text and accent', () => {
    const wrapper = mountEntry({}, {
      theme: { text: 'rgb(34, 51, 68)', accent: '#aabbcc' },
    })

    expect(wrapper.element.style.color).toBe('rgb(34, 51, 68)')
    expect(wrapper.element.style.getPropertyValue('--note-accent')).toBe('#aabbcc')
  })

  it('S-054: derives the field surface from the theme text colour', () => {
    const wrapper = mountEntry({}, {
      theme: { text: '#223344', accent: '#aabbcc' },
    })

    expect(wrapper.element.style.getPropertyValue('--note-text')).toBe('#223344')
    // jsdom cannot resolve scoped CSS, so the published token is the observable.
    expect(wrapper.element.style.getPropertyValue('--note-field-bg'))
      .toMatch(/^#223344[0-9a-f]{2}$/i)
  })

  it('S-055: renders the naming, definition and appears-in blocks in that order', () => {
    const wrapper = mountEntry(
      { definition: 'Grey ash falls.' },
      { mentions: [mention('s1', 'The Square')] },
    )

    const naming = wrapper.find('.reference-naming').element
    const definition = wrapper.find('.reference-definition').element
    const meta = wrapper.find('.reference-meta').element

    expect(naming.compareDocumentPosition(definition) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
    expect(definition.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
    // The column wrapper is what put appears-in beside the definition.
    expect(wrapper.find('.reference-definition-column').exists()).toBe(false)
  })

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

  it('S-057: shows a heading and an edit control, not a name field', () => {
    const wrapper = mountEntry()

    expect(wrapper.find('.reference-entry-heading').exists()).toBe(true)
    expect(wrapper.find('.reference-name-edit').exists()).toBe(true)
    expect(wrapper.find('.reference-name').exists()).toBe(false)
  })

  it('S-058: opens a focused name field seeded with the committed name', async () => {
    const wrapper = mountEntry({}, {}, { attachTo: document.body })

    const edit = wrapper.find('.reference-name-edit')
    expect(edit.exists()).toBe(true)
    await edit.trigger('click')
    await nextTick()

    const field = wrapper.find('.reference-name')
    expect(field.exists()).toBe(true)
    expect(field.element.value).toBe('Izildar Qualen')
    expect(wrapper.find('.reference-name-save').exists()).toBe(true)
    expect(wrapper.find('.reference-name-cancel').exists()).toBe(true)
    expect(document.activeElement).toBe(field.element)
  })

  it('S-059: commits a new name and returns to the heading', async () => {
    const wrapper = mountEntry()

    const edit = wrapper.find('.reference-name-edit')
    expect(edit.exists()).toBe(true)
    await edit.trigger('click')
    await wrapper.find('.reference-name').setValue('Essidor Agjadoff')
    await wrapper.find('.reference-name-save').trigger('click')

    expect(wrapper.emitted('rename')[0]).toEqual(['Essidor Agjadoff'])

    await wrapper.setProps({ entry: { ...baseEntry, name: 'Essidor Agjadoff' } })

    expect(wrapper.find('.reference-name').exists()).toBe(false)
    expect(wrapper.find('.reference-entry-heading').text()).toBe('Essidor Agjadoff')
  })

  it('S-060: cancels a name edit and keeps the committed name', async () => {
    const wrapper = mountEntry()

    const edit = wrapper.find('.reference-name-edit')
    expect(edit.exists()).toBe(true)
    await edit.trigger('click')
    await wrapper.find('.reference-name').setValue('A draft nobody keeps.')
    await wrapper.find('.reference-name-cancel').trigger('click')

    expect(wrapper.find('.reference-name').exists()).toBe(false)
    expect(wrapper.find('.reference-entry-heading').text()).toBe('Izildar Qualen')
    expect(wrapper.emitted('rename')).toBeFalsy()
  })

  it('S-061: shows the refusal beside an edit that keeps the draft', async () => {
    const wrapper = mountEntry()

    const edit = wrapper.find('.reference-name-edit')
    expect(edit.exists()).toBe(true)
    await edit.trigger('click')
    await wrapper.find('.reference-name').setValue('Izildar')
    await wrapper.find('.reference-name-save').trigger('click')

    await wrapper.setProps({ nameError: 'That name belongs to “Izildar Qualen”.' })

    const error = wrapper.find('.reference-name-error')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('Izildar Qualen')

    const field = wrapper.find('.reference-name')
    expect(field.exists()).toBe(true)
    expect(field.element.value).toBe('Izildar')
  })

  it('S-029: clears the name error when the writer changes the field', async () => {
    const wrapper = mountEntry()

    const edit = wrapper.find('.reference-name-edit')
    expect(edit.exists()).toBe(true)
    await edit.trigger('click')
    await wrapper.find('.reference-name').setValue('Izildar')
    await wrapper.find('.reference-name-save').trigger('click')
    await wrapper.setProps({ nameError: 'That name belongs to “Izildar Qualen”.' })
    expect(wrapper.find('.reference-name-error').exists()).toBe(true)

    await wrapper.find('.reference-name').setValue('Essidor Agjadoff')

    expect(wrapper.find('.reference-name-error').exists()).toBe(false)
  })

  it('S-062: opens an untitled entry in a focused name field', async () => {
    const wrapper = mountEntry(
      { name: '', kind: 'character' },
      {},
      { attachTo: document.body },
    )
    await nextTick()

    const field = wrapper.find('.reference-name')
    expect(field.exists()).toBe(true)
    expect(document.activeElement).toBe(field.element)
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

describe('ReferenceEntryView record groups', () => {
  it('S-064: always shows the aliases, tags and facts groups, empty included', () => {
    const wrapper = mountEntry()

    const groups = wrapper.findAll('.reference-group')
    expect(groups.map((group) => group.attributes('data-group'))).toEqual([
      'aliases',
      'tags',
      'facts',
    ])
    expect(wrapper.findAll('.reference-group-empty')).toHaveLength(3)
  })

  it('S-065: adds an alias and removes one chip', async () => {
    const wrapper = mountEntry()

    const input = wrapper.find('.reference-alias-input')
    expect(input.exists()).toBe(true)
    await input.setValue('Essidor Agjadoff')
    await wrapper.find('.reference-alias-add').trigger('click')
    expect(wrapper.emitted('add-alias')[0]).toEqual(['Essidor Agjadoff'])

    const withAlias = mountEntry({ aliases: ['Essidor Agjadoff'] })
    const remove = withAlias.find('.reference-alias-remove[data-alias="Essidor Agjadoff"]')
    expect(remove.exists()).toBe(true)
    await remove.trigger('click')
    expect(withAlias.emitted('remove-alias')[0]).toEqual(['Essidor Agjadoff'])
  })

  it('S-066: adds a tag and removes one chip', async () => {
    const wrapper = mountEntry()

    const input = wrapper.find('.reference-tag-input')
    expect(input.exists()).toBe(true)
    await input.setValue('history')
    await wrapper.find('.reference-tag-add').trigger('click')
    expect(wrapper.emitted('add-tag')[0]).toEqual(['history'])

    const withTag = mountEntry({ tags: ['history'] })
    const remove = withTag.find('.reference-tag-remove[data-tag="history"]')
    expect(remove.exists()).toBe(true)
    await remove.trigger('click')
    expect(withTag.emitted('remove-tag')[0]).toEqual(['history'])
  })

  it('S-067: adds a labelled fact and removes a fact row', async () => {
    const wrapper = mountEntry()

    const label = wrapper.find('.reference-fact-label-input')
    expect(label.exists()).toBe(true)
    await label.setValue('Wants')
    await wrapper.find('.reference-fact-value-input').setValue('the record back')
    await wrapper.find('.reference-fact-add').trigger('click')
    expect(wrapper.emitted('add-fact')[0]).toEqual([{ label: 'Wants', value: 'the record back' }])

    const withFact = mountEntry({ facts: [{ label: 'Wants', value: 'the record back' }] })
    const remove = withFact.find('.reference-fact-remove[data-index="0"]')
    expect(remove.exists()).toBe(true)
    await remove.trigger('click')
    expect(withFact.emitted('remove-fact')[0]).toEqual([0])
  })
})
