import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive, nextTick } from 'vue'
import OutlineView from './OutlineView.vue'
import { doc, entry, section } from '../composables/outlineFixtures.js'

// The Outline tab (SPEC.md 5.20, S-010 … S-015, S-017 … S-021).
//
// Rows come from the document, and summaries are attached to them by section
// id. Each case mounts the view with a reactive doc and a fake `useSummaries`.
// So these pin what the writer sees and which trigger each control calls.
// Generation itself is 4.8's, tested in useSummaries' own suite.

function makeStore(sections) {
  return reactive({ doc: reactive(doc(sections)), docVersion: 1 })
}

function makeSummaries({ entries = [], stale = 0, done = 0, total = 0 } = {}) {
  return reactive({
    summaryEntries: entries,
    summaryProgress: { done, total, stale },
    summariesBusy: false,
    summaryError: '',
    generateSummaries: vi.fn(),
    refreshStaleSummaries: vi.fn(),
    refreshSummaryStatus: vi.fn(),
  })
}

function makeSettings(model = 'llama3') {
  return { settings: reactive({ endpoint: 'http://localhost:11434', model, apiKey: '' }) }
}

function mountView({ sections, entries, stale, settings } = {}) {
  return mount(OutlineView, {
    props: {
      store: makeStore(sections ?? []),
      summaries: makeSummaries({ entries, stale }),
      settings: settings ?? makeSettings(),
    },
  })
}

const row = (wrapper, sectionId) => wrapper.find(`.outline-row[data-section-id="${sectionId}"]`)

const twoSections = () => [
  section('c1', 'The Arrival', 'chapter'),
  section('s1', 'Interlude', 'section'),
]

beforeEach(() => {
  // The view reads the store on mount. Nothing here writes anywhere.
  vi.clearAllMocks()
})

describe('OutlineView rows', () => {
  it('S-010: shows "No summary yet" for a section with no summary, never an empty row', () => {
    const wrapper = mountView({
      sections: twoSections(),
      entries: [entry('c1', 1, 'The Arrival', 'chapter', 'The door opens.')],
    })

    const bare = row(wrapper, 's1')
    expect(bare.exists()).toBe(true)
    expect(bare.text()).toMatch(/no summary yet/i)
    expect(bare.find('.outline-summary').text()).toBe('')

    // The summarized row shows its text, not the placeholder.
    const summarized = row(wrapper, 'c1')
    expect(summarized.find('.outline-summary').text()).toBe('The door opens.')
    expect(summarized.text()).not.toMatch(/no summary yet/i)
  })

  it('S-011: marks the stale row and leaves a current one unmarked', () => {
    const wrapper = mountView({
      sections: twoSections(),
      entries: [
        entry('c1', 1, 'The Arrival', 'chapter', 'Fresh.', false),
        entry('s1', 1, 'Interlude', 'section', 'Drifted.', true),
      ],
      stale: 1,
    })

    expect(row(wrapper, 's1').find('.outline-stale').exists()).toBe(true)
    expect(row(wrapper, 'c1').find('.outline-stale').exists()).toBe(false)
  })

  it('S-012: labels every summary as model output', () => {
    const wrapper = mountView({
      sections: twoSections(),
      entries: [
        entry('c1', 1, 'The Arrival', 'chapter', 'The door opens.'),
        entry('s1', 1, 'Interlude', 'section', 'A pause.'),
      ],
    })

    for (const id of ['c1', 's1']) {
      const label = row(wrapper, id).find('.outline-summary-label')
      expect(label.exists()).toBe(true)
      expect(label.text()).toMatch(/summary/i)
    }
  })

  it("S-013: shows a hidden section's row with a hidden marker", () => {
    const wrapper = mountView({
      sections: [
        section('c1', 'The Arrival', 'chapter'),
        section('s1', 'Epigraph', 'section', { hidden: true }),
      ],
    })

    expect(row(wrapper, 's1').exists()).toBe(true)
    expect(row(wrapper, 's1').find('.outline-hidden').exists()).toBe(true)
    expect(row(wrapper, 'c1').find('.outline-hidden').exists()).toBe(false)
  })

  it('S-014: offers no editable field and no action that writes into the manuscript', () => {
    const wrapper = mountView({
      sections: twoSections(),
      entries: [entry('c1', 1, 'The Arrival', 'chapter', 'The door opens.')],
    })

    // Rows first: with nothing rendered, "no editable field" is vacuously true.
    expect(wrapper.findAll('.outline-row')).toHaveLength(2)
    expect(wrapper.findAll('input, textarea, [contenteditable]')).toHaveLength(0)
    // Nothing in the view proposes moving model text into the writer's own
    // record: a summary is read here, never inserted.
    expect(wrapper.text()).not.toMatch(/insert/i)
  })
})

describe('OutlineView states', () => {
  it('S-015: follows a section being added, deleted or moved', async () => {
    const store = makeStore(twoSections())
    const wrapper = mount(OutlineView, {
      props: {
        store,
        summaries: makeSummaries({ entries: [] }),
        settings: makeSettings(),
      },
    })

    const ids = () => wrapper.findAll('.outline-row').map((el) => el.attributes('data-section-id'))
    expect(ids()).toEqual(['c1', 's1'])

    store.doc.sections.push(section('c2', '', 'chapter'))
    await nextTick()
    expect(ids()).toEqual(['c1', 's1', 'c2'])
    // The added chapter has no subtitle, so it is named by its number.
    expect(row(wrapper, 'c2').find('.outline-title').text()).toBe('Chapter 2')

    store.doc.sections.splice(0, 1)
    await nextTick()
    expect(ids()).toEqual(['s1', 'c2'])

    // Moving is a reorder of the same array: the rows follow the document.
    store.doc.sections.reverse()
    await nextTick()
    expect(ids()).toEqual(['c2', 's1'])
  })

  it('S-016: shows a "nothing to outline" state for a document with no sections', () => {
    const wrapper = mountView({ sections: [], entries: [] })

    expect(wrapper.find('.outline-empty').exists()).toBe(true)
    expect(wrapper.findAll('.outline-row')).toHaveLength(0)
    expect(wrapper.text()).toMatch(/nothing to outline/i)
    // An empty manuscript is not a failure.
    expect(wrapper.text()).not.toMatch(/error/i)
  })

  it('S-017: treats an empty summary store as "nothing generated yet", not a failure', async () => {
    const summaries = makeSummaries({ entries: [] })
    const wrapper = mount(OutlineView, {
      props: { store: makeStore(twoSections()), summaries, settings: makeSettings() },
    })
    await flushPromises()

    // One read answers "is anything generated?".
    expect(summaries.refreshSummaryStatus).toHaveBeenCalled()
    expect(wrapper.find('.outline-awaiting').exists()).toBe(true)
    // retrieve_summaries errors on an empty store by design. That error must
    // not reach the writer as a failure.
    expect(wrapper.text()).toMatch(/no summaries|nothing generated/i)
    expect(wrapper.text()).not.toMatch(/failed|error/i)
    // Every section still has its row: "no summaries" is not "no outline".
    expect(wrapper.findAll('.outline-row')).toHaveLength(2)
  })

  it('S-018: opens that section in the editor when a row is chosen', async () => {
    const wrapper = mountView({ sections: twoSections(), entries: [] })

    const target = row(wrapper, 's1')
    expect(target.exists()).toBe(true)
    await target.trigger('click')

    expect(wrapper.emitted('jump')).toBeTruthy()
    expect(wrapper.emitted('jump')[0]).toEqual(['s1'])
  })
})

describe('OutlineView generation gate', () => {
  const configured = () => makeSettings('llama3')
  const unconfigured = () => makeSettings('')

  it('S-019: offers "Generate summaries" in the empty state when a model is configured, and calls the existing trigger', async () => {
    const summaries = makeSummaries({ entries: [] })
    const wrapper = mount(OutlineView, {
      props: { store: makeStore(twoSections()), summaries, settings: configured() },
    })
    await flushPromises()

    const generate = wrapper.find('.outline-generate')
    expect(generate.exists()).toBe(true)
    await generate.trigger('click')

    expect(summaries.generateSummaries).toHaveBeenCalledTimes(1)
  })

  it('S-020: offers "Refresh stale" only when something is stale, and calls the existing trigger', async () => {
    const staleSummaries = makeSummaries({
      entries: [entry('c1', 1, 'The Arrival', 'chapter', 'Drifted.', true)],
      stale: 1,
    })
    const withStale = mount(OutlineView, {
      props: { store: makeStore(twoSections()), summaries: staleSummaries, settings: configured() },
    })
    await flushPromises()

    const refresh = withStale.find('.outline-refresh-stale')
    expect(refresh.exists()).toBe(true)
    await refresh.trigger('click')
    expect(staleSummaries.refreshStaleSummaries).toHaveBeenCalledTimes(1)

    // Nothing stale: no control, because there is nothing to refresh.
    const fresh = mount(OutlineView, {
      props: {
        store: makeStore(twoSections()),
        summaries: makeSummaries({
          entries: [entry('c1', 1, 'The Arrival', 'chapter', 'Current.')],
          stale: 0,
        }),
        settings: configured(),
      },
    })
    await flushPromises()
    expect(fresh.find('.outline-refresh-stale').exists()).toBe(false)
  })

  it('S-021: shows neither generation control without a model, and points at General Options', async () => {
    const wrapper = mount(OutlineView, {
      props: {
        store: makeStore(twoSections()),
        summaries: makeSummaries({ entries: [], stale: 2 }),
        settings: unconfigured(),
      },
    })
    await flushPromises()

    expect(wrapper.find('.outline-generate').exists()).toBe(false)
    expect(wrapper.find('.outline-refresh-stale').exists()).toBe(false)
    expect(wrapper.text()).toMatch(/general options/i)
  })
})
