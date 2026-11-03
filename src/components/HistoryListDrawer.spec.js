import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import HistoryListDrawer from './HistoryListDrawer.vue'

// The history rail: list the stored versions, select one for the preview canvas,
// flip the canvas to a diff, and restore a version (behind a native confirm).
// The component owns no history state — it drives the `useVersionHistory`
// instance App hands it — so every assertion is about that delegation.

const askMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/dialog', () => ({
  ask: (...args) => askMock(...args),
}))

function historyOf(overrides = {}) {
  return {
    entries: [],
    selectedTimestamp: null,
    loading: false,
    error: '',
    diffBlocks: null,
    selectVersion: vi.fn(),
    clearDiff: vi.fn(),
    restoreVersion: vi.fn(),
    diffAgainstCurrent: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  askMock.mockReset()
})

const mountDrawer = (history, hasLastPath = true, open = true) =>
  mount(HistoryListDrawer, { props: { history, hasLastPath, open } })

const entries = [
  { timestamp: '2026-11-01T10-30-00-000', kind: 'snapshot' },
  { timestamp: '2026-11-01T10-35-00-000', kind: 'delta' },
]

describe('HistoryListDrawer', () => {
  it('follows the open prop', async () => {
    const wrapper = mountDrawer(historyOf(), true, false)
    expect(wrapper.find('.drawer').classes()).not.toContain('open')

    await wrapper.setProps({ open: true })
    expect(wrapper.find('.drawer').classes()).toContain('open')
  })

  it('asks the writer to save first when the document has no path', () => {
    const wrapper = mountDrawer(historyOf(), false)

    expect(wrapper.find('.drawer-empty').text()).toContain(
      'Save the document to start its version history.',
    )
    expect(wrapper.find('.history-list').exists()).toBe(false)
  })

  it('lists versions with a snapshot/delta marker and a formatted time', () => {
    const wrapper = mountDrawer(historyOf({ entries }))

    const rows = wrapper.findAll('.history-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].find('.history-kind').classes()).toContain('snapshot')
    expect(rows[0].find('.history-kind').text()).toBe('S')
    expect(rows[0].text()).toContain('2026-11-01 10:30')
    expect(rows[1].find('.history-kind').classes()).toContain('delta')
    expect(rows[1].find('.history-kind').text()).toBe('Δ')
    expect(rows[1].text()).toContain('2026-11-01 10:35')
  })

  it('marks the selected version and selects another on click', async () => {
    const history = historyOf({ entries, selectedTimestamp: entries[0].timestamp })
    const wrapper = mountDrawer(history)

    expect(wrapper.findAll('.history-row')[0].classes()).toContain('active')
    expect(wrapper.findAll('.history-row')[1].classes()).not.toContain('active')

    await wrapper.findAll('.history-row')[1].trigger('click')

    expect(history.selectVersion).toHaveBeenCalledWith(entries[1].timestamp)
  })

  it('drops the diff instead of re-selecting when the open diff is the clicked row', async () => {
    const history = historyOf({
      entries,
      selectedTimestamp: entries[0].timestamp,
      diffBlocks: [{ type: 'unchanged' }],
    })
    const wrapper = mountDrawer(history)

    await wrapper.findAll('.history-row')[0].trigger('click')

    expect(history.clearDiff).toHaveBeenCalled()
    expect(history.selectVersion).not.toHaveBeenCalled()
  })

  it('says the history is empty once loading has finished', () => {
    const wrapper = mountDrawer(historyOf({ entries: [], loading: false }))

    expect(wrapper.find('.history-empty').text()).toContain(
      'No history yet — save or autosave will record versions.',
    )
  })

  it('shows a loading line while the first page is still arriving', () => {
    const wrapper = mountDrawer(historyOf({ entries: [], loading: true }))

    expect(wrapper.find('.history-empty').text()).toContain('Loading…')
  })

  it('surfaces a load error', () => {
    const wrapper = mountDrawer(historyOf({ entries, error: 'Could not read history' }))

    expect(wrapper.find('.history-error').text()).toBe('Could not read history')
  })

  it('hides the action footer until a version is selected', () => {
    expect(mountDrawer(historyOf({ entries })).find('.drawer-footer').exists()).toBe(false)
    expect(
      mountDrawer(historyOf({ entries, selectedTimestamp: entries[0].timestamp })).find(
        '.drawer-footer',
      ).exists(),
    ).toBe(true)
  })

  it('hides the action footer when the document was never saved', () => {
    const wrapper = mountDrawer(
      historyOf({ entries, selectedTimestamp: entries[0].timestamp }),
      false,
    )

    expect(wrapper.find('.drawer-footer').exists()).toBe(false)
  })

  it('disables both actions while a version loads', () => {
    const wrapper = mountDrawer(
      historyOf({ entries, selectedTimestamp: entries[0].timestamp, loading: true }),
    )

    for (const button of wrapper.findAll('.history-action')) {
      expect(button.attributes('disabled')).toBeDefined()
    }
  })

  it('opens the diff for the selected version, then goes back to the preview', async () => {
    const history = historyOf({ entries, selectedTimestamp: entries[0].timestamp })
    const wrapper = mountDrawer(history)
    const diffButton = () => wrapper.findAll('.history-action')[1]

    expect(diffButton().text()).toBe('Diff vs current')
    await diffButton().trigger('click')
    expect(history.diffAgainstCurrent).toHaveBeenCalledWith(entries[0].timestamp)

    await wrapper.setProps({ history: { ...history, diffBlocks: [{ type: 'unchanged' }] } })
    expect(diffButton().text()).toBe('Back to preview')
    await diffButton().trigger('click')
    expect(history.clearDiff).toHaveBeenCalled()
  })

  it('restores only after the writer confirms', async () => {
    const history = historyOf({ entries, selectedTimestamp: entries[0].timestamp })
    const wrapper = mountDrawer(history)

    askMock.mockResolvedValueOnce(false)
    await wrapper.findAll('.history-action')[0].trigger('click')
    await flushPromises()
    expect(history.restoreVersion).not.toHaveBeenCalled()

    askMock.mockResolvedValueOnce(true)
    await wrapper.findAll('.history-action')[0].trigger('click')
    await flushPromises()
    expect(history.restoreVersion).toHaveBeenCalledWith(entries[0].timestamp)
  })

  it('warns that restoring is non-destructive before asking', async () => {
    const history = historyOf({ entries, selectedTimestamp: entries[0].timestamp })
    const wrapper = mountDrawer(history)

    askMock.mockResolvedValueOnce(false)
    await wrapper.findAll('.history-action')[0].trigger('click')
    await flushPromises()

    expect(askMock).toHaveBeenCalledTimes(1)
    const [message, options] = askMock.mock.calls[0]
    expect(message).toContain('Cmd+Z')
    expect(options).toEqual({ title: 'Rite', type: 'warning' })
  })
})

// Let the `await ask(...)` continuation run.
function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
