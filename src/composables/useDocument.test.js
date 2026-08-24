import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDocumentStore } from '../stores/document.js'

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/tauri'

describe('useDocumentStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('initializes with null doc', () => {
    const store = useDocumentStore()
    expect(store.doc).toBeNull()
    expect(store.isModified).toBe(false)
  })

  it('loads document from Rust', async () => {
    const mockDoc = {
      title: 'Test Novel',
      author: 'Test Author',
      body: { content: [{ id: 'p1', paragraphStyle: 'normal', elements: [{ textRun: { content: 'Hello', textStyle: {} } }] }] },
    }
    invoke.mockResolvedValue(mockDoc)

    const store = useDocumentStore()
    await store.loadDocument('/test.fwd')
    expect(invoke).toHaveBeenCalledWith('open_document', { path: '/test.fwd' })
    expect(store.doc.title).toBe('Test Novel')
    expect(store.doc.body.content).toHaveLength(1)
    expect(store.isModified).toBe(false)
  })

  it('saves document via Rust', async () => {
    invoke.mockResolvedValue(undefined)

    const store = useDocumentStore()
    store.doc = { title: 'Save Me', body: { content: [] } }
    store.isModified = true

    await store.saveDocument('/save.fwd')
    expect(invoke).toHaveBeenCalledWith('save_document', { path: '/save.fwd' })
    expect(store.isModified).toBe(false)
  })

  it('serializes to JSON', () => {
    const store = useDocumentStore()
    store.doc = { title: 'JSON Test', body: { content: [] } }
    const json = store.toJSON()
    expect(json.title).toBe('JSON Test')
  })

  it('syncs body content and marks modified', () => {
    const store = useDocumentStore()
    store.doc = { title: 'Test', body: { content: [] } }
    const paragraphs = [{ id: 'p1', paragraphStyle: 'normal', elements: [] }]
    store.syncBodyContent(paragraphs)
    expect(store.doc.body.content).toEqual(paragraphs)
    expect(store.isModified).toBe(true)
  })

  it('loads initial document from Rust', async () => {
    const mockDoc = { title: 'Initial', body: { content: [] } }
    invoke.mockResolvedValue(mockDoc)
    const store = useDocumentStore()
    await store.loadInitialDocument()
    expect(invoke).toHaveBeenCalledWith('get_document')
    expect(store.doc.title).toBe('Initial')
  })

  it('falls back to default doc when initial load fails', async () => {
    invoke.mockRejectedValue(new Error('rust error'))
    const store = useDocumentStore()
    await store.loadInitialDocument()
    expect(store.doc.title).toBe('Untitled')
    expect(store.doc.author).toBe('Author Name')
    expect(store.doc.body.content).toEqual([])
  })

  it('inserts heading via Rust', async () => {
    const updatedDoc = { title: 'Test', body: { content: [{ id: 'h1', paragraphStyle: 'heading1' }] } }
    invoke.mockResolvedValue(updatedDoc)
    const store = useDocumentStore()
    store.doc = { title: 'Test', body: { content: [] } }
    await store.insertHeading(1)
    expect(invoke).toHaveBeenCalledWith('insert_heading', { level: 1, afterId: null })
    expect(store.doc.body.content).toHaveLength(1)
    expect(store.isModified).toBe(true)
  })

  it('deletes heading via Rust', async () => {
    const updatedDoc = { title: 'Test', body: { content: [] } }
    invoke.mockResolvedValue(updatedDoc)
    const store = useDocumentStore()
    store.doc = { title: 'Test', body: { content: [{ id: 'h1' }] } }
    await store.deleteHeading('h1')
    expect(invoke).toHaveBeenCalledWith('delete_heading', { id: 'h1' })
    expect(store.doc.body.content).toHaveLength(0)
    expect(store.isModified).toBe(true)
  })

  it('renames section via Rust', async () => {
    const updatedDoc = { title: 'Test', body: { content: [] } }
    invoke.mockResolvedValue(updatedDoc)
    const store = useDocumentStore()
    store.doc = { title: 'Test', body: { content: [] } }
    await store.renameSection('h1', 'New Title')
    expect(invoke).toHaveBeenCalledWith('rename_section', { id: 'h1', title: 'New Title' })
    expect(store.isModified).toBe(true)
  })

  it('autosaves when lastPath and isModified are set', async () => {
    invoke.mockResolvedValue(undefined)
    const store = useDocumentStore()
    store.lastPath = '/test.fwd'
    store.isModified = true
    await store.autosaveDocument()
    expect(invoke).toHaveBeenCalledWith('autosave_document')
    expect(store.isModified).toBe(false)
  })

  it('skips autosave when no lastPath', async () => {
    const store = useDocumentStore()
    store.lastPath = null
    store.isModified = true
    await store.autosaveDocument()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('skips autosave when not modified', async () => {
    const store = useDocumentStore()
    store.lastPath = '/test.fwd'
    store.isModified = false
    await store.autosaveDocument()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('syncs document to Rust when modified', async () => {
    invoke.mockResolvedValue(undefined)
    const store = useDocumentStore()
    store.doc = { title: 'Sync', body: { content: [] } }
    store.isModified = true
    await store.syncToRust()
    expect(invoke).toHaveBeenCalledWith('sync_document', { data: store.doc })
  })

  it('skips sync when not modified', async () => {
    const store = useDocumentStore()
    store.doc = { title: 'Sync', body: { content: [] } }
    store.isModified = false
    await store.syncToRust()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('skips sync when doc is null', async () => {
    const store = useDocumentStore()
    store.doc = null
    store.isModified = true
    await store.syncToRust()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('marks modified and triggers debounced sync', () => {
    vi.useFakeTimers()
    const store = useDocumentStore()
    store.doc = { title: 'Test', body: { content: [] } }
    store.markModified()
    expect(store.isModified).toBe(true)
    vi.advanceTimersByTime(1100)
    expect(invoke).toHaveBeenCalledWith('sync_document', { data: store.doc })
    vi.useRealTimers()
  })

  it('resets modified flag', () => {
    const store = useDocumentStore()
    store.isModified = true
    store.resetModified()
    expect(store.isModified).toBe(false)
  })

  it('sets doc directly', () => {
    const store = useDocumentStore()
    const newDoc = { title: 'Direct', body: { content: [] } }
    store.setDoc(newDoc)
    expect(store.doc).toEqual(newDoc)
  })
})
