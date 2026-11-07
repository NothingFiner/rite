import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import ReferencesView from './ReferencesView.vue'
import { doc, section } from '../composables/outlineFixtures.js'

// SPEC.md 5.20a's page sentences: S-004, S-010 … S-020, and S-021's empty
// document. The drawer's own sentences live in ReferencesNavDrawer.spec.js.
//
// The page is the selection: one entry in, one note and its recap out. The
// shell owns which entry that is, so every interaction here is a prop or an
// emitted event, never local navigation.

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))

const outlineDoc = doc([
  section('c1', 'Chapter One', 'chapter'),
  section('s1', 'The Door', 'section'),
  section('s2', 'Ashes', 'section'),
])

const notes = {
  overview: 'A letter starts it all.',
  sections: { s1: 'The door is a lie.', s2: 'Everything ends in ash.' },
  orphaned: 'Cut in draft four.',
}

function makeStore(overrides = {}) {
  return reactive({
    doc: reactive(outlineDoc),
    notes: { ...notes, sections: { ...notes.sections } },
    isModified: false,
    markModified: vi.fn(),
    ...overrides,
  })
}

function makeSummaries({ entries = [], stale = 0 } = {}) {
  return reactive({
    summaryEntries: entries,
    summaryProgress: { done: entries.length, total: 3, stale },
    summariesBusy: false,
    summaryError: '',
    generateSummaries: vi.fn(async () => []),
    summarizeOne: vi.fn(async () => ({})),
    refreshStaleSummaries: vi.fn(async () => []),
    refreshSummaryStatus: vi.fn(async () => {}),
  })
}

const summaryEntry = (sectionId, text, stale = false) => ({
  sectionId,
  chapterIndex: 1,
  title: 'The Door',
  sectionType: 'section',
  summary: text,
  stale,
})

function mountView(props = {}) {
  return mount(ReferencesView, {
    props: {
      store: makeStore(),
      theme: reactive({ bg: 'rgb(250, 247, 242)', text: 'rgb(34, 34, 34)', accent: '#4f8ef7' }),
      summaries: makeSummaries(),
      settings: { settings: reactive({ model: 'llama3' }) },
      entryId: 'overview',
      anchorId: null,
      ...props,
    },
  })
}

const notesView = (wrapper) => wrapper.find('.notes-view')
const title = (wrapper) => wrapper.find('.note-head .note-title')
const subtitle = (wrapper) => wrapper.find('.note-head .note-sub')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ReferencesView selection', () => {
  it('S-004: renders the entry it is given, so the selection can outlive the view', async () => {
    const wrapper = mountView({ entryId: 's1' })

    expect(notesView(wrapper).exists()).toBe(true)
    expect(title(wrapper).exists()).toBe(true)
    expect(title(wrapper).text()).toBe('The Door')
    expect(wrapper.find('.note-rendered').text()).toContain('The door is a lie.')

    // The parent hands down a different entry. The page follows without a click.
    await wrapper.setProps({ entryId: 's2' })
    expect(title(wrapper).text()).toBe('Ashes')
    expect(wrapper.find('.note-rendered').text()).toContain('Everything ends in ash.')
  })

  it('S-010: falls back to the story overview when the selected section is gone', () => {
    const wrapper = mountView({ entryId: 'deleted-section' })

    expect(title(wrapper).exists()).toBe(true)
    expect(title(wrapper).text()).toMatch(/story overview/i)
    // The deleted id's note is not shown under the overview's title.
    expect(wrapper.find('.note-rendered').text()).toContain('A letter starts it all.')
    expect(wrapper.find('.note-rendered').text()).not.toContain('The door is a lie.')
  })

  it('S-021: shows the overview page for a document with no sections, without an error', () => {
    const wrapper = mountView({
      store: makeStore({ doc: reactive(doc([])) }),
      summaries: makeSummaries(),
    })

    expect(wrapper.find('.references-view').exists()).toBe(true)
    expect(title(wrapper).exists()).toBe(true)
    expect(title(wrapper).text()).toMatch(/story overview/i)
    expect(wrapper.text()).not.toMatch(/error|failed/i)
  })
})

describe('ReferencesView detail', () => {
  it('S-011: names the selected section and its place in the manuscript', () => {
    const wrapper = mountView({ entryId: 's1' })

    expect(subtitle(wrapper).exists()).toBe(true)
    expect(subtitle(wrapper).text()).toContain('Chapter One')
    expect(subtitle(wrapper).text()).toMatch(/section/i)
  })

  it('S-012: renders the selected note as markdown', () => {
    const store = makeStore({
      notes: { overview: '', sections: { s1: 'A **bold** plan.' }, orphaned: '' },
    })
    const wrapper = mountView({ store, entryId: 's1' })

    const body = wrapper.find('.note-rendered')
    expect(body.exists()).toBe(true)
    expect(body.html()).toContain('<strong>bold</strong>')
    expect(wrapper.find('.note-source').exists()).toBe(false)
  })

  it('S-013: shows the overview note and the orphaned note for their own rows', async () => {
    const wrapper = mountView({ entryId: 'overview' })
    expect(wrapper.find('.note-rendered').exists()).toBe(true)
    expect(wrapper.find('.note-rendered').text()).toContain('A letter starts it all.')

    await wrapper.setProps({ entryId: 'orphaned' })
    expect(wrapper.find('.note-rendered').exists()).toBe(true)
    expect(wrapper.find('.note-rendered').text()).toContain('Cut in draft four.')
    expect(wrapper.find('.note-rendered').text()).not.toContain('A letter starts it all.')
  })
})

describe('ReferencesView recap', () => {
  it('S-014: labels the recap as model output and places it below the note', () => {
    const wrapper = mountView({
      entryId: 's1',
      summaries: makeSummaries({ entries: [summaryEntry('s1', 'A neutral recap of the door.')] }),
    })

    const block = wrapper.find('.note-recap')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('A neutral recap of the door.')

    const label = block.find('.note-recap-label')
    expect(label.exists()).toBe(true)
    expect(label.text()).toMatch(/assistant recap/i)
    expect(label.text()).toMatch(/read-only/i)

    // Attribution comes before the prose, and the block follows the note.
    const text = block.find('.note-recap-text')
    expect(text.exists()).toBe(true)
    expect(
      label.element.compareDocumentPosition(text.element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const note = wrapper.find('.note-rendered')
    expect(note.exists()).toBe(true)
    expect(
      note.element.compareDocumentPosition(block.element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('S-015: appends the recap to the draft and enters editing without saving', async () => {
    const store = makeStore()
    const wrapper = mountView({
      store,
      entryId: 's1',
      summaries: makeSummaries({ entries: [summaryEntry('s1', 'A neutral recap.')] }),
    })

    const insert = wrapper.find('.note-insert-recap')
    expect(insert.exists()).toBe(true)
    await insert.trigger('click')

    const source = wrapper.find('.note-source')
    expect(source.exists()).toBe(true)
    const value = source.element.value
    expect(value).toContain('The door is a lie.')
    expect(value).toContain('A neutral recap.')
    expect(value.indexOf('The door is a lie.')).toBeLessThan(value.indexOf('A neutral recap.'))

    // Appending a draft is not a save: the store still holds the old note.
    expect(store.notes.sections.s1).toBe('The door is a lie.')
    expect(store.commitNote).not.toHaveBeenCalled()
  })

  it('S-016: shows no recap block without a stored summary, and none for a retired row', async () => {
    const wrapper = mountView({ entryId: 's1', summaries: makeSummaries() })

    expect(wrapper.find('.note-recap').exists()).toBe(false)
    // The generation gate is a separate sentence. With a model configured the
    // slot may explain itself, but it must not claim a recap exists.
    expect(wrapper.find('.note-recap-text').exists()).toBe(false)

    await wrapper.setProps({ entryId: 'orphaned' })
    expect(wrapper.find('.note-recap').exists()).toBe(false)
  })

  it('S-017: edits with the pencil, and commits a dirty draft when the selection changes', async () => {
    const store = makeStore()
    const wrapper = mountView({ store, entryId: 's1' })

    expect(wrapper.find('.note-edit').exists()).toBe(true)
    await wrapper.find('.note-edit').trigger('click')
    expect(wrapper.find('.note-source').exists()).toBe(true)
    expect(wrapper.find('.note-save').exists()).toBe(true)
    expect(wrapper.find('.note-reset').exists()).toBe(true)

    await wrapper.find('.note-source').setValue('Dirty draft.')
    await wrapper.setProps({ entryId: 's2' })
    await flushPromises()

    expect(store.notes.sections.s1).toBe('Dirty draft.')
  })

  it('S-017: commits a dirty draft when the page unmounts', async () => {
    const store = makeStore()
    const wrapper = mountView({ store, entryId: 's1' })

    expect(wrapper.find('.note-edit').exists()).toBe(true)
    await wrapper.find('.note-edit').trigger('click')
    await wrapper.find('.note-source').setValue('Dirty draft.')
    wrapper.unmount()
    await flushPromises()

    expect(store.notes.sections.s1).toBe('Dirty draft.')
  })
})

describe('ReferencesView generation', () => {
  it('S-018: offers Generate summaries when nothing is summarized and a model is configured', async () => {
    const summaries = makeSummaries()
    const wrapper = mountView({ summaries, entryId: 's1' })

    const slot = wrapper.find('.note-recap-empty')
    expect(slot.exists()).toBe(true)
    expect(slot.text()).toMatch(/nothing has been summarized/i)

    const generate = wrapper.find('.note-generate')
    expect(generate.exists()).toBe(true)
    await generate.trigger('click')
    expect(summaries.generateSummaries).toHaveBeenCalled()
  })

  it('S-019: shows no generation control without a model, and points at General Options', () => {
    const wrapper = mountView({
      entryId: 's1',
      summaries: makeSummaries(),
      settings: { settings: reactive({ model: '' }) },
    })

    expect(wrapper.find('.note-generate').exists()).toBe(false)
    const link = wrapper.find('.note-options-link')
    expect(link.exists()).toBe(true)
    expect(link.text()).toMatch(/general options/i)
  })

  it('S-020: marks a stale recap and regenerates that section only', async () => {
    const summaries = makeSummaries({
      entries: [summaryEntry('s1', 'A stale recap.', true)],
      stale: 1,
    })
    const wrapper = mountView({ summaries, entryId: 's1' })

    expect(wrapper.find('.note-recap-stale').exists()).toBe(true)
    expect(wrapper.find('.note-recap-stale').text()).toMatch(/stale/i)

    const regenerate = wrapper.find('.note-regenerate')
    expect(regenerate.exists()).toBe(true)
    await regenerate.trigger('click')

    expect(summaries.summarizeOne).toHaveBeenCalledWith('s1')
    expect(summaries.generateSummaries).not.toHaveBeenCalled()
  })

  it('S-020: leaves a current recap unmarked and offers no regenerate', () => {
    const wrapper = mountView({
      entryId: 's1',
      summaries: makeSummaries({ entries: [summaryEntry('s1', 'A current recap.')] }),
    })

    expect(wrapper.find('.note-recap-stale').exists()).toBe(false)
    expect(wrapper.find('.note-regenerate').exists()).toBe(false)
  })
})
