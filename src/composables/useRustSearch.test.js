import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useRustSearch } from './useRustSearch.js'

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/tauri'

describe('useRustSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes with empty state', () => {
    const search = useRustSearch()
    expect(search.matches.value).toEqual([])
    expect(search.currentIndex.value).toBe(-1)
    expect(search.query.value).toBe('')
    expect(search.matchCount.value).toBe(0)
  })

  it('returns empty result for empty query', async () => {
    const search = useRustSearch()
    const result = await search.findText('')
    expect(result.matches).toEqual([])
    expect(result.currentIndex).toBe(-1)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('finds text via Rust backend', async () => {
    invoke.mockResolvedValue([
      { paragraph_id: 'p1', start_offset: 0, end_offset: 5 },
      { paragraph_id: 'p2', start_offset: 3, end_offset: 8 },
    ])

    const search = useRustSearch()
    const result = await search.findText('hello')
    expect(invoke).toHaveBeenCalledWith('search_document', { query: 'hello' })
    expect(result.matches).toHaveLength(2)
    expect(result.currentIndex).toBe(0)
    expect(search.query.value).toBe('hello')
    expect(search.matchCount.value).toBe(2)
  })

  it('returns empty result when search fails', async () => {
    invoke.mockRejectedValue(new Error('search error'))
    const search = useRustSearch()
    const result = await search.findText('hello')
    expect(result.matches).toEqual([])
    expect(result.currentIndex).toBe(-1)
    expect(search.matches.value).toEqual([])
  })

  it('advances to next match with wrapping', async () => {
    invoke.mockResolvedValue([
      { paragraph_id: 'p1', start_offset: 0, end_offset: 3 },
      { paragraph_id: 'p1', start_offset: 4, end_offset: 7 },
    ])

    const search = useRustSearch()
    await search.findText('foo')
    expect(search.currentIndex.value).toBe(0)
    search.findNext()
    expect(search.currentIndex.value).toBe(1)
    search.findNext()
    expect(search.currentIndex.value).toBe(0)
  })

  it('findNext does nothing with no matches', () => {
    const search = useRustSearch()
    search.findNext()
    expect(search.currentIndex.value).toBe(-1)
  })

  it('goes to previous match with wrapping', async () => {
    invoke.mockResolvedValue([
      { paragraph_id: 'p1', start_offset: 0, end_offset: 3 },
      { paragraph_id: 'p1', start_offset: 4, end_offset: 7 },
      { paragraph_id: 'p1', start_offset: 8, end_offset: 11 },
    ])

    const search = useRustSearch()
    await search.findText('foo')
    search.findNext()
    search.findNext()
    expect(search.currentIndex.value).toBe(2)
    search.findPrev()
    expect(search.currentIndex.value).toBe(1)
    search.findPrev()
    search.findPrev()
    expect(search.currentIndex.value).toBe(2)
  })

  it('findPrev does nothing with no matches', () => {
    const search = useRustSearch()
    search.findPrev()
    expect(search.currentIndex.value).toBe(-1)
  })

  it('clears search state', async () => {
    invoke.mockResolvedValue([{ paragraph_id: 'p1', start_offset: 0, end_offset: 3 }])
    const search = useRustSearch()
    await search.findText('foo')
    expect(search.matchCount.value).toBe(1)
    search.clear()
    expect(search.matches.value).toEqual([])
    expect(search.currentIndex.value).toBe(-1)
    expect(search.query.value).toBe('')
    expect(search.matchCount.value).toBe(0)
  })

  it('replaces current match via Rust backend', async () => {
    invoke.mockResolvedValueOnce([
      { paragraph_id: 'p1', start_offset: 0, end_offset: 3 },
      { paragraph_id: 'p1', start_offset: 4, end_offset: 7 },
    ])
    invoke.mockResolvedValueOnce({
      matches: [{ paragraph_id: 'p1', start_offset: 4, end_offset: 7 }],
      current_index: 0,
    })

    const search = useRustSearch()
    await search.findText('foo')
    const result = await search.replaceCurrent('bar')
    expect(invoke).toHaveBeenCalledWith('replace_current', {
      query: 'foo',
      replacement: 'bar',
      matchIndex: 0,
    })
    expect(search.matches.value).toHaveLength(1)
    expect(search.currentIndex.value).toBe(0)
    expect(result.matches).toHaveLength(1)
  })

  it('replaceCurrent returns empty when no query', async () => {
    const search = useRustSearch()
    const result = await search.replaceCurrent('bar')
    expect(result.matches).toEqual([])
    expect(result.currentIndex).toBe(-1)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('replaceCurrent returns empty when index is negative', async () => {
    invoke.mockResolvedValue([])
    const search = useRustSearch()
    await search.findText('xyz')
    const result = await search.replaceCurrent('bar')
    expect(result.matches).toEqual([])
    expect(result.currentIndex).toBe(-1)
  })

  it('replaceAll replaces all via Rust backend', async () => {
    invoke.mockResolvedValueOnce([
      { paragraph_id: 'p1', start_offset: 0, end_offset: 3 },
      { paragraph_id: 'p1', start_offset: 4, end_offset: 7 },
    ])
    invoke.mockResolvedValueOnce(2)

    const search = useRustSearch()
    await search.findText('foo')
    const result = await search.replaceAll('bar')
    expect(invoke).toHaveBeenCalledWith('replace_all', { query: 'foo', replacement: 'bar' })
    expect(result.count).toBe(2)
    expect(search.matches.value).toEqual([])
    expect(search.currentIndex.value).toBe(-1)
  })

  it('replaceAll returns 0 when no query', async () => {
    const search = useRustSearch()
    const result = await search.replaceAll('bar')
    expect(result.count).toBe(0)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('replaceAll returns 0 on failure', async () => {
    invoke.mockResolvedValueOnce([{ paragraph_id: 'p1', start_offset: 0, end_offset: 3 }])
    invoke.mockRejectedValueOnce(new Error('replace error'))

    const search = useRustSearch()
    await search.findText('foo')
    const result = await search.replaceAll('bar')
    expect(result.count).toBe(0)
  })
})
