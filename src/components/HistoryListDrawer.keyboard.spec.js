import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import HistoryListDrawer from './HistoryListDrawer.vue'
import { formatHistoryTimestamp } from '../composables/useVersionHistory.js'

// Keyboard operability of the history rail (SPEC.md S-007, S-008, roadmap 5.7).
// DOM contracts only; the real key presses live in e2e/keyboard-navigation.spec.js.

const askMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/plugin-dialog', () => ({
  ask: (...args) => askMock(...args),
}))

beforeEach(() => {
  askMock.mockReset()
})

const ENTRIES = [
  { timestamp: '2026-11-01T09-15-00-000', kind: 'snapshot', label: 'Snapshot' },
  { timestamp: '2026-11-02T18-40-00-000', kind: 'delta', label: 'Autosave' },
  { timestamp: '2026-11-03T21-05-00-000', kind: 'delta', label: 'Autosave' },
]

function historyOf(overrides = {}) {
  return {
    entries: ENTRIES,
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

const mountDrawer = (history = historyOf()) =>
  mount(HistoryListDrawer, { props: { history, hasLastPath: true, open: true } })

const isControl = (el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button'

// A row may be the control itself or wrap one; S-007 does not care which.
const rowControl = (row) => {
  if (!row) return null
  if (isControl(row.element)) return row.element
  return row.element.querySelector('button, [role="button"]')
}

function accessibleName(el) {
  if (!el) return ''
  const label = el.getAttribute('aria-label')
  if (label && label.trim()) return label.trim()
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
  if (text) return text
  return (el.getAttribute('title') || '').trim()
}

describe('HistoryListDrawer — keyboard navigation', () => {
  it('S-007: should expose every history entry as a control named by its timestamp and kind', () => {
    const wrapper = mountDrawer()
    const rows = wrapper.findAll('.history-row')
    expect(rows).toHaveLength(ENTRIES.length)

    for (const [i, entry] of ENTRIES.entries()) {
      const control = rowControl(rows[i])
      expect(control, `entry ${i} exposes no control`).toBeTruthy()
      expect(isControl(control), `entry ${i} is not a button or role=button`).toBe(true)

      const name = accessibleName(control)
      expect(name, `entry ${i} name is missing the timestamp`).toContain(
        formatHistoryTimestamp(entry.timestamp)
      )
      // The kind must be spelled, not left as the S / Δ glyph.
      expect(name.toLowerCase(), `entry ${i} name is missing its kind`).toContain(entry.kind)
    }
  })

  it('S-008: should mark only the selected entry as the current item', () => {
    const selected = ENTRIES[1].timestamp
    const wrapper = mountDrawer(historyOf({ selectedTimestamp: selected }))
    const rows = wrapper.findAll('.history-row')

    for (const [i, entry] of ENTRIES.entries()) {
      const control = rowControl(rows[i])
      expect(control, `entry ${i} exposes no control`).toBeTruthy()
      const current = control.getAttribute('aria-current')
      if (entry.timestamp === selected) {
        expect(current, 'the selected entry is not marked current').toBe('true')
      } else {
        expect(current, `entry ${i} must not be marked current`).not.toBe('true')
      }
    }
  })
})
