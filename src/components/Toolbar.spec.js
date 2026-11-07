import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import Toolbar from './Toolbar.vue'

describe('Toolbar', () => {
  it('renders toolbar', () => {
    const wrapper = mount(Toolbar)
    expect(wrapper.find('.toolbar').exists()).toBe(true)
    expect(wrapper.find('.brand-text').text()).toBe('rite')
  })

  it('editor button is active in editor mode', () => {
    const wrapper = mount(Toolbar, { props: { mode: 'editor' } })
    const buttons = wrapper.findAll('.tool-btn')
    expect(buttons[0].classes()).toContain('active')
    expect(buttons[1].classes()).not.toContain('active')
  })

  it('manuscript button is active in manuscript mode', () => {
    const wrapper = mount(Toolbar, { props: { mode: 'manuscript' } })
    const buttons = wrapper.findAll('.tool-btn')
    expect(buttons[0].classes()).not.toContain('active')
    expect(buttons[1].classes()).toContain('active')
  })

  it('emits setMode on editor button click', async () => {
    const wrapper = mount(Toolbar)
    await wrapper.findAll('.tool-btn')[0].trigger('click')
    expect(wrapper.emitted('setMode')).toBeTruthy()
    expect(wrapper.emitted('setMode')[0]).toEqual(['editor'])
  })

  it('emits setMode on manuscript button click', async () => {
    const wrapper = mount(Toolbar)
    await wrapper.findAll('.tool-btn')[1].trigger('click')
    expect(wrapper.emitted('setMode')).toBeTruthy()
    expect(wrapper.emitted('setMode')[0]).toEqual(['manuscript'])
  })

  it('emits toggleRight on drawer toggle click', async () => {
    const wrapper = mount(Toolbar, { props: { rightOpen: false } })
    await wrapper.find('.drawer-toggle').trigger('click')
    expect(wrapper.emitted('toggleRight')).toBeTruthy()
  })

  it('shows drawer toggle as active when rightOpen is true', () => {
    const wrapper = mount(Toolbar, { props: { rightOpen: true } })
    expect(wrapper.find('.drawer-toggle').classes()).toContain('active')
  })

  it('defaults mode to editor', () => {
    const wrapper = mount(Toolbar)
    const buttons = wrapper.findAll('.tool-btn')
    expect(buttons[0].classes()).toContain('active')
  })

  it('defaults rightOpen to false', () => {
    const wrapper = mount(Toolbar)
    expect(wrapper.find('.drawer-toggle').classes()).not.toContain('active')
  })
})

// --- view tablist (SPEC.md 5.7a, S-004 … S-006) ------------------------------
//
// The toolbar is stateless: it takes `mode` as a prop and emits `setMode`. So a
// tab key handler has to move focus itself, and these cases attach the component
// to the document to read where focus landed.

// S-010 widens this tablist from three tabs to four, with Notes third. The
// 5.7a expectations below assume the old width, so they move with the order.
const VIEW_MODES = ['editor', 'manuscript', 'notes', 'history']
const VIEW_LABELS = ['Editor', 'Manuscript', 'Notes', 'History']

const viewTabs = (wrapper) => wrapper.findAll('.view-tabs .view-tab')

function mountTablist(mode) {
  return mount(Toolbar, { attachTo: document.body, props: { mode } })
}

function lastMode(wrapper) {
  return wrapper.emitted('setMode')?.at(-1)?.[0]
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Toolbar view tablist', () => {
  it('S-004: keeps one tab stop in the view tablist, on the selected tab', () => {
    for (const [index, mode] of VIEW_MODES.entries()) {
      const wrapper = mountTablist(mode)
      const stopped = viewTabs(wrapper).filter((tab) => tab.attributes('tabindex') === '0')

      expect(stopped).toHaveLength(1)
      expect(stopped[0].text()).toBe(VIEW_LABELS[index])
      expect(
        viewTabs(wrapper).filter((tab) => tab.attributes('tabindex') === '-1'),
      ).toHaveLength(3)

      wrapper.unmount()
    }
  })

  it('S-005: moves selection and focus with ArrowRight and ArrowLeft, wrapping at the ends', async () => {
    const wrapper = mountTablist('editor')

    await viewTabs(wrapper)[0].trigger('keydown', { key: 'ArrowRight' })
    expect(lastMode(wrapper)).toBe('manuscript')
    expect(document.activeElement).toBe(viewTabs(wrapper)[1].element)

    // ArrowLeft on the first tab wraps to the last one.
    await viewTabs(wrapper)[0].trigger('keydown', { key: 'ArrowLeft' })
    expect(lastMode(wrapper)).toBe('history')
    expect(document.activeElement).toBe(viewTabs(wrapper)[3].element)
  })

  it('S-006: moves to the first and last view tab with Home and End', async () => {
    const wrapper = mountTablist('manuscript')

    await viewTabs(wrapper)[1].trigger('keydown', { key: 'End' })
    expect(lastMode(wrapper)).toBe('history')
    expect(document.activeElement).toBe(viewTabs(wrapper)[3].element)

    await viewTabs(wrapper)[3].trigger('keydown', { key: 'Home' })
    expect(lastMode(wrapper)).toBe('editor')
    expect(document.activeElement).toBe(viewTabs(wrapper)[0].element)
  })
})

// SPEC.md 5.17 S-010. The four view tabs keep the one-tab-stop contract
// 5.7a established and extend the arrow / Home / End walk to the new tab.
describe('Toolbar four view tabs', () => {
  it('S-010: renders Editor, Manuscript, Notes and History in that order', () => {
    const wrapper = mount(Toolbar, { props: { mode: 'notes' } })
    const tabs = viewTabs(wrapper)

    expect(tabs.map((tab) => tab.text())).toEqual(['Editor', 'Manuscript', 'Notes', 'History'])
    expect(tabs.map((tab) => tab.attributes('role'))).toEqual(['tab', 'tab', 'tab', 'tab'])
    expect(tabs.map((tab) => tab.attributes('aria-selected'))).toEqual([
      'false',
      'false',
      'true',
      'false',
    ])
    expect(tabs.filter((tab) => tab.attributes('tabindex') === '0')).toHaveLength(1)
  })

  it('S-010: reaches Notes with the arrow keys and moves focus with it', async () => {
    const wrapper = mountTablist('manuscript')

    await viewTabs(wrapper)[1].trigger('keydown', { key: 'ArrowRight' })

    expect(lastMode(wrapper)).toBe('notes')
    expect(document.activeElement).toBe(viewTabs(wrapper)[2].element)
  })

  it('S-010: marks Notes as the active tab in notes mode', () => {
    const wrapper = mount(Toolbar, { props: { mode: 'notes' } })

    expect(viewTabs(wrapper)[2].classes()).toContain('active')
    expect(viewTabs(wrapper)[2].attributes('tabindex')).toBe('0')
  })
})

// SPEC.md 5.7b S-005. The banner landmark and where it belongs are set out in
// the landmark table of SPEC.md.
describe('Toolbar landmark', () => {
  it('S-005: marks the toolbar with the banner role', () => {
    const wrapper = mount(Toolbar)
    expect(wrapper.find('.toolbar').attributes('role')).toBe('banner')
  })
})
