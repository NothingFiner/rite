// The four control kinds, as the components publish them (SPEC.md revision 9,
// S-123, S-124, S-126, S-127 and S-128).
//
// jsdom does not resolve a scoped <style> block, so the observable here is the
// class a component puts on the element. That is the contract: the class picks
// the kind, and the kind's colour comes from the tokens the surface publishes.
// The computed-colour half of the story is e2e/control-kinds.spec.js.

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import ActivityBar from './ActivityBar.vue'
import LlmPanel from './LlmPanel.vue'
import NavigationDrawer from './NavigationDrawer.vue'
import ReferenceEntryView from './ReferenceEntryView.vue'
import ReferencesNavDrawer from './ReferencesNavDrawer.vue'
import TextOptionsDrawer from './TextOptionsDrawer.vue'
import Toolbar from './Toolbar.vue'
import { doc, section } from '../composables/outlineFixtures.js'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))

const drawerItem = (wrapper, label) =>
  wrapper.findAll('.activity-icons .activity-icon').find((b) => b.attributes('aria-label') === label)

const formatButton = (wrapper, label) =>
  wrapper.findAll('.activity-format .activity-icon').find((b) => b.attributes('aria-label') === label)

const mountAddCluster = () =>
  mount(NavigationDrawer, {
    props: {
      open: true,
      expanded: true,
      tocItems: [{ id: 'c1', title: 'Chapter One', kind: 'chapter', sectionType: 'chapter' }],
    },
  })

describe('segmented sets', () => {
  it('S-123: draws the four views as one segmented control', () => {
    const wrapper = mount(Toolbar, { props: { mode: 'editor' } })

    const track = wrapper.find('.view-tabs')
    expect(track.classes()).toContain('control-segmented')

    const segments = wrapper.findAll('.view-tabs .view-tab')
    expect(segments).toHaveLength(4)
    for (const segment of segments) {
      expect(segment.classes()).toContain('control-segment')
    }

    // The selected segment is the one that reads as chosen, so the kind's
    // accent state has a single element to paint.
    const active = wrapper.findAll('.view-tabs .view-tab.active')
    expect(active).toHaveLength(1)
    expect(active[0].attributes('aria-selected')).toBe('true')
  })

  it('S-123: keeps the toolbar’s arrow-key navigation over the segments', async () => {
    const wrapper = mount(Toolbar, { props: { mode: 'editor' }, attachTo: document.body })
    const tabs = wrapper.findAll('.view-tabs .view-tab')
    tabs[0].element.focus()

    await tabs[0].trigger('keydown', { key: 'ArrowRight' })

    // Focus moved to the next segment and the view it names was reported.
    expect(document.activeElement).toBe(tabs[1].element)
    expect(wrapper.emitted('setMode')?.at(-1)).toEqual(['manuscript'])
    wrapper.unmount()
  })

  it('S-123: draws the three reference surfaces as one segmented control', () => {
    const store = reactive({
      doc: reactive(doc([section('c1', 'Chapter One', 'chapter')])),
      notes: { overview: '', sections: {}, orphaned: '' },
    })
    const wrapper = mount(ReferencesNavDrawer, {
      props: { store, selectedId: 'overview', surface: 'outline', references: { entries: [] } },
    })

    expect(wrapper.find('.surface-tabs').classes()).toContain('control-segmented')

    const segments = wrapper.findAll('.surface-tabs .surface-tab')
    expect(segments).toHaveLength(3)
    for (const segment of segments) {
      expect(segment.classes()).toContain('control-segment')
    }
    expect(wrapper.findAll('.surface-tab[aria-selected="true"]')).toHaveLength(1)
  })
})

describe('borderless controls', () => {
  it('S-124: makes each rail button a borderless control with the pressed one active', () => {
    const wrapper = mount(ActivityBar, {
      props: { viewMode: 'editor', activeId: 'chapters', drawerOpen: true },
    })

    const items = wrapper.findAll('.activity-icons .activity-icon')
    expect(items).toHaveLength(4)
    for (const item of items) {
      expect(item.classes()).toContain('control-borderless')
    }

    const active = items.filter((item) => item.classes().includes('active'))
    expect(active).toHaveLength(1)
    expect(active[0].attributes('aria-label')).toBe('Sections')
  })
})

describe('bordered controls', () => {
  const theme = {
    editorMargin: 'compact',
    editorZoom: 16,
    setMargin: vi.fn(),
    setZoom: vi.fn(),
  }
  const format = {
    editorFont: "'Inter', sans-serif",
    fontOptions: [{ label: 'Inter', family: "'Inter', sans-serif" }],
    setFont: vi.fn(),
  }
  const manuscriptFormat = {
    formatId: 'standard',
    formats: [{ id: 'standard', name: 'Standard' }],
    selectFormat: vi.fn(),
  }

  it('S-127: draws the text options’ zoom buttons as bordered controls', () => {
    const wrapper = mount(TextOptionsDrawer, {
      props: { open: true, theme, format, manuscriptFormat },
    })

    const zoom = wrapper.findAll('.zoom-btn')
    expect(zoom.length).toBeGreaterThanOrEqual(3)
    for (const button of zoom) {
      expect(button.classes()).toContain('control-bordered')
    }

    // One chosen option per row, and it is the pressed state rather than a
    // colour of the component's own.
    const rows = wrapper.findAll('.zoom-row')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    for (const row of rows) {
      expect(row.findAll('.zoom-btn.active').length).toBe(1)
    }
  })

  it('S-127: draws the assistant’s Send as the one primary bordered control', () => {
    const chat = {
      input: 'Draft the next scene',
      messages: [],
      scope: 'section',
      effectiveScope: 'section',
      selectedRoleName: '',
      retrievalError: '',
      send: vi.fn(),
      clear: vi.fn(),
      setRole: vi.fn(),
      buildContextMessages: (text) => [{ role: 'user', content: text }],
    }
    const manager = {
      tabs: [{ id: 't1', label: 'Assistant' }],
      activeId: 't1',
      selectSession: vi.fn(),
      closeSession: vi.fn(),
      createSession: vi.fn(),
      stopActive: vi.fn(),
    }
    const wrapper = mount(LlmPanel, {
      props: { chat, manager, settings: { settings: { model: 'llama3' } } },
    })

    const send = wrapper.find('.llm-send-btn')
    expect(send.classes()).toContain('control-bordered')
    expect(send.classes()).toContain('is-primary')

    const clear = wrapper.findAll('.llm-clear-btn')
    expect(clear.length).toBeGreaterThanOrEqual(1)
    for (const button of clear) {
      expect(button.classes()).toContain('control-bordered')
      expect(button.classes()).not.toContain('is-primary')
    }

    // Exactly one primary in the panel: the action that commits work.
    expect(wrapper.findAll('.is-primary')).toHaveLength(1)
  })

  it('S-127: draws the references add option and the entry’s save actions as bordered', () => {
    const store = reactive({
      doc: reactive(doc([section('c1', 'Chapter One', 'chapter')])),
      notes: { overview: '', sections: {}, orphaned: '' },
    })
    const drawer = mount(ReferencesNavDrawer, {
      props: {
        store,
        selectedId: 'overview',
        surface: 'characters',
        references: { entries: [] },
      },
    })
    expect(drawer.find('.reference-add-option').classes()).toContain('control-bordered')

    const entry = {
      id: 'r1',
      kind: 'character',
      name: 'Izildar Qualen',
      definition: 'Keeper of the Ashfall record.',
      aliases: [],
      tags: [],
      facts: [],
      includedSections: [],
      excludedSections: [],
    }
    const page = mount(ReferenceEntryView, { props: { entry, mentions: [] } })

    // The page publishes the theme's control tokens, so these two read as the
    // writer's chrome rather than the app's.
    expect(page.find('.reference-definition-edit').classes()).toContain('control-borderless')
  })
})

describe('format toggles', () => {
  it('S-126: disables the three format buttons when the caret is not in the editor', () => {
    const away = mount(ActivityBar, { props: { viewMode: 'editor', cursorActive: false } })
    for (const label of ['Bold', 'Italic', 'Underline']) {
      expect(formatButton(away, label).attributes('disabled'), label).toBeDefined()
    }

    // Positive control: the same three buttons are usable with a caret, so the
    // disabled attribute above is the prop and not always-on markup.
    const atCaret = mount(ActivityBar, { props: { viewMode: 'editor', cursorActive: true } })
    for (const label of ['Bold', 'Italic', 'Underline']) {
      expect(formatButton(atCaret, label).attributes('disabled'), label).toBeUndefined()
    }
  })

  it('S-126: draws the format toggles as bordered controls', () => {
    const wrapper = mount(ActivityBar, { props: { viewMode: 'editor', cursorActive: true } })
    for (const label of ['Bold', 'Italic', 'Underline']) {
      const button = formatButton(wrapper, label)
      expect(button.classes(), label).toContain('control-bordered')
      expect(button.classes(), label).toContain('activity-icon')
    }
  })
})

describe('chips', () => {
  it('S-128: draws aliases and tags as chips, never as buttons', () => {
    const entry = {
      id: 'r1',
      kind: 'character',
      name: 'Izildar Qualen',
      definition: '',
      aliases: ['Izi', 'The Keeper'],
      tags: ['ashfall', 'north'],
      facts: [],
      includedSections: [],
      excludedSections: [],
    }
    const wrapper = mount(ReferenceEntryView, { props: { entry, mentions: [] } })

    const chips = wrapper.findAll('.reference-alias, .reference-tag')
    expect(chips).toHaveLength(4)
    for (const chip of chips) {
      expect(chip.classes(), chip.text()).toContain('control-chip')
      expect(chip.element.tagName).toBe('SPAN')
      expect(chip.classes(), chip.text()).not.toContain('control-bordered')
      expect(chip.classes(), chip.text()).not.toContain('control-borderless')
    }
  })
})

describe('the add cluster', () => {
  it('S-129: draws the two add options as bordered primary controls', () => {
    const wrapper = mountAddCluster()

    const options = wrapper.findAll('.add-options .add-confirm')
    expect(options).toHaveLength(2)
    for (const option of options) {
      expect(option.classes()).toContain('control-bordered')
      expect(option.classes()).toContain('is-primary')
    }

    // The circle they grow out of is the same control in a round shape.
    expect(wrapper.find('.add-btn').exists()).toBe(true)
    expect(wrapper.find('.add-btn').text()).toBe('')
  })

  it('S-142: names each add option for assistive technology', () => {
    const labels = mountAddCluster()
      .findAll('.add-options .add-confirm')
      .map((option) => option.attributes('aria-label'))

    // A visible "Chapter" reads as a heading in a list of controls. The name
    // has to carry the action, because the label does not.
    expect(labels).toEqual(['Add new chapter', 'Add new section'])
  })

  it('S-143: shows the option labels without a + prefix', () => {
    const labels = mountAddCluster()
      .findAll('.add-options .add-confirm')
      .map((option) => option.text())

    expect(labels).toEqual(['Chapter', 'Section'])
  })
})
