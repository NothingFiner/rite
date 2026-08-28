import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useVersionHistory, formatHistoryTimestamp } from './useVersionHistory.js'

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/tauri'

// A minimal stand-in for the Pinia document store — only the method the
// composable calls (applyRestoredDocument) needs to exist. Spied per-test.
const mockStore = {
  applyRestoredDocument: vi.fn(),
}

function makeEntry(timestamp, kind) {
  return { timestamp, kind, label: null }
}

describe('useVersionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes with empty state', () => {
    const history = useVersionHistory(mockStore)
    expect(history.entries.value).toEqual([])
    expect(history.selectedTimestamp.value).toBeNull()
    expect(history.previewDocument.value).toBeNull()
    expect(history.diffBlocks.value).toBeNull()
    expect(history.loading.value).toBe(false)
    expect(history.error.value).toBeNull()
  })

  it('loadHistory populates entries from list_history', async () => {
    invoke.mockResolvedValue([
      makeEntry('2026-08-01T10-00-00-000', 'snapshot'),
      makeEntry('2026-08-01T10-30-00-000', 'delta'),
    ])
    const history = useVersionHistory(mockStore)
    await history.loadHistory()
    expect(invoke).toHaveBeenCalledWith('list_history')
    expect(history.entries.value).toHaveLength(2)
    expect(history.entries.value[0].kind).toBe('snapshot')
    expect(history.error.value).toBeNull()
  })

  it('loadHistory records an error and clears entries on failure', async () => {
    invoke.mockRejectedValue('no document path')
    const history = useVersionHistory(mockStore)
    await history.loadHistory()
    expect(history.entries.value).toEqual([])
    expect(history.error.value).toBe('no document path')
  })

  it('selectVersion reconstructs the version and clears any open diff', async () => {
    const doc = { title: 'T', sections: [] }
    invoke.mockResolvedValue(doc)
    const history = useVersionHistory(mockStore)
    history.diffBlocks.value = [{ type: 'unchanged' }]
    await history.selectVersion('2026-08-01T10-00-00-000')
    expect(invoke).toHaveBeenCalledWith('reconstruct_version', { timestamp: '2026-08-01T10-00-00-000' })
    expect(history.previewDocument.value).toStrictEqual(doc)
    expect(history.selectedTimestamp.value).toBe('2026-08-01T10-00-00-000')
    expect(history.diffBlocks.value).toBeNull()
    expect(history.loading.value).toBe(false)
  })

  it('selectVersion clears selection on failure', async () => {
    invoke.mockRejectedValue('reconstruct failed')
    const history = useVersionHistory(mockStore)
    await history.selectVersion('2026-08-01T10-00-00-000')
    expect(history.previewDocument.value).toBeNull()
    expect(history.selectedTimestamp.value).toBeNull()
    expect(history.error.value).toBe('reconstruct failed')
  })

  it('restoreVersion adopts the restored doc and reloads history + clears preview', async () => {
    const restored = { title: 'Restored', sections: [] }
    invoke
      .mockResolvedValueOnce(restored) // restore_version
      .mockResolvedValueOnce([makeEntry('2026-08-01T10-00-00-000', 'snapshot')]) // list_history
    const history = useVersionHistory(mockStore)
    history.selectedTimestamp.value = '2026-08-01T10-00-00-000'
    history.previewDocument.value = { title: 'old preview', sections: [] }

    const ok = await history.restoreVersion('2026-08-01T10-00-00-000')

    expect(ok).toBe(true)
    expect(invoke).toHaveBeenCalledWith('restore_version', { timestamp: '2026-08-01T10-00-00-000' })
    expect(mockStore.applyRestoredDocument).toHaveBeenCalledWith(restored)
    expect(invoke).toHaveBeenCalledWith('list_history')
    // Restore returns the drawer to the list.
    expect(history.selectedTimestamp.value).toBeNull()
    expect(history.previewDocument.value).toBeNull()
  })

  it('restoreVersion returns false and records error on failure (does not touch store)', async () => {
    invoke.mockRejectedValue('restore failed')
    const history = useVersionHistory(mockStore)
    const ok = await history.restoreVersion('2026-08-01T10-00-00-000')
    expect(ok).toBe(false)
    expect(mockStore.applyRestoredDocument).not.toHaveBeenCalled()
    expect(history.error.value).toBe('restore failed')
  })

  it('diffAgainstCurrent fetches the diff and ensures the preview is loaded', async () => {
    const doc = { title: 'Past', sections: [] }
    const diffs = [{ type: 'modified', sectionId: 's1' }]
    invoke
      .mockResolvedValueOnce(doc) // reconstruct_version (preview not yet loaded)
      .mockResolvedValueOnce(diffs) // diff_against_current
    const history = useVersionHistory(mockStore)
    await history.diffAgainstCurrent('2026-08-01T10-00-00-000')
    expect(invoke).toHaveBeenCalledWith('reconstruct_version', { timestamp: '2026-08-01T10-00-00-000' })
    expect(invoke).toHaveBeenCalledWith('diff_against_current', { timestamp: '2026-08-01T10-00-00-000' })
    expect(history.diffBlocks.value).toStrictEqual(diffs)
    expect(history.previewDocument.value).toStrictEqual(doc)
    expect(history.selectedTimestamp.value).toBe('2026-08-01T10-00-00-000')
  })

  it('diffAgainstCurrent skips re-fetching the preview when already selected', async () => {
    const diffs = [{ type: 'unchanged' }]
    invoke.mockResolvedValue(diffs)
    const history = useVersionHistory(mockStore)
    history.selectedTimestamp.value = '2026-08-01T10-00-00-000'
    history.previewDocument.value = { title: 'already loaded', sections: [] }
    await history.diffAgainstCurrent('2026-08-01T10-00-00-000')
    // Only diff_against_current should have been called.
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('diff_against_current', { timestamp: '2026-08-01T10-00-00-000' })
    expect(history.diffBlocks.value).toStrictEqual(diffs)
  })

  it('diffAgainstCurrent records error and clears diff on failure', async () => {
    invoke.mockRejectedValue('diff failed')
    const history = useVersionHistory(mockStore)
    await history.diffAgainstCurrent('2026-08-01T10-00-00-000')
    expect(history.diffBlocks.value).toBeNull()
    expect(history.error.value).toBe('diff failed')
  })

  it('clearPreview resets selection, preview, and diff', () => {
    const history = useVersionHistory(mockStore)
    history.selectedTimestamp.value = 'ts'
    history.previewDocument.value = { sections: [] }
    history.diffBlocks.value = [{ type: 'unchanged' }]
    history.clearPreview()
    expect(history.selectedTimestamp.value).toBeNull()
    expect(history.previewDocument.value).toBeNull()
    expect(history.diffBlocks.value).toBeNull()
  })

  it('clearDiff drops the diff but keeps the selected preview', () => {
    const history = useVersionHistory(mockStore)
    history.selectedTimestamp.value = 'ts'
    history.previewDocument.value = { sections: [] }
    history.diffBlocks.value = [{ type: 'unchanged' }]
    history.clearDiff()
    expect(history.diffBlocks.value).toBeNull()
    expect(history.selectedTimestamp.value).toBe('ts')
    expect(history.previewDocument.value).not.toBeNull()
  })
})

describe('formatHistoryTimestamp', () => {
  it('formats a full stem into YYYY-MM-DD HH:MM', () => {
    expect(formatHistoryTimestamp('2026-08-27T14-30-05-123')).toBe('2026-08-27 14:30')
  })

  it('formats a midnight timestamp', () => {
    expect(formatHistoryTimestamp('2026-01-01T00-00-00-000')).toBe('2026-01-01 00:00')
  })

  it('returns the input unchanged for a non-matching string', () => {
    expect(formatHistoryTimestamp('not-a-timestamp')).toBe('not-a-timestamp')
  })

  it('returns undefined unchanged when passed nothing', () => {
    expect(formatHistoryTimestamp(undefined)).toBeUndefined()
  })
})