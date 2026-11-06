import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import HistoryView from './HistoryView.vue'

// HistoryView only needs the `history` prop to render its header + empty-state
// canvas; the preview/diff branches are exercised elsewhere. A minimal reactive
// stand-in is enough for the toggle/back behavior under test here.
function createHistory(overrides = {}) {
  return {
    selectedTimestamp: null,
    diffBlocks: null,
    previewDocument: null,
    loading: false,
    error: null,
    ...overrides,
  }
}

function mountHistory(props = {}) {
  return mount(HistoryView, {
    props: { history: createHistory(), ...props },
  })
}

describe('HistoryView', () => {
  it('renders the header and the Back to editor button', () => {
    const wrapper = mountHistory()
    expect(wrapper.find('.history-view-header').exists()).toBe(true)
    expect(wrapper.find('.history-back').text()).toContain('Back to editor')
  })

  it('emits back on Back-to-editor click', async () => {
    const wrapper = mountHistory()
    await wrapper.find('.history-back').trigger('click')
    expect(wrapper.emitted('back')).toBeTruthy()
  })

  it('shows a Versions toggle button', () => {
    const wrapper = mountHistory()
    expect(wrapper.find('.history-versions-toggle').exists()).toBe(true)
    expect(wrapper.find('.history-versions-toggle').text()).toContain('Versions')
  })

  it('is not active and offers "Show version list" when the drawer is closed', () => {
    const wrapper = mountHistory({ versionsOpen: false })
    const toggle = wrapper.find('.history-versions-toggle')
    expect(toggle.classes()).not.toContain('active')
    expect(toggle.attributes('title')).toBe('Show version list')
  })

  it('is active and offers "Hide version list" when the drawer is open', () => {
    const wrapper = mountHistory({ versionsOpen: true })
    const toggle = wrapper.find('.history-versions-toggle')
    expect(toggle.classes()).toContain('active')
    expect(toggle.attributes('title')).toBe('Hide version list')
  })

  it('emits toggle-versions on Versions button click', async () => {
    const wrapper = mountHistory({ versionsOpen: false })
    await wrapper.find('.history-versions-toggle').trigger('click')
    expect(wrapper.emitted('toggle-versions')).toBeTruthy()
    expect(wrapper.emitted('toggle-versions')[0]).toHaveLength(0)
  })

  it('defaults versionsOpen to false (toggle not active)', () => {
    const wrapper = mountHistory()
    expect(wrapper.find('.history-versions-toggle').classes()).not.toContain('active')
  })

  it('shows the timestamp title when a version is selected', () => {
    const wrapper = mountHistory({
      history: createHistory({ selectedTimestamp: '2026-09-28T12:00:00Z' }),
    })
    expect(wrapper.find('.history-view-title').text()).toContain('Preview')
  })
})