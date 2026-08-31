import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDocumentStore } from '../stores/document.js'

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/tauri'

function makeSection(id, title = '', sectionType = 'section', paragraphs = []) {
  return { id, title, sectionType, paragraphs }
}

function makePara(id, content = '') {
  return { id, elements: [{ textRun: { content, textStyle: {} } }], leftIndent: null, rightIndent: null, firstLineIndent: null }
}

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
      sections: [makeSection('s1', 'Chapter 1', 'chapter', [makePara('p1', 'Hello')])],
    }
    invoke.mockResolvedValue(mockDoc)

    const store = useDocumentStore()
    await store.loadDocument('/test.rite')
    expect(invoke).toHaveBeenCalledWith('open_document', { path: '/test.rite' })
    expect(store.doc.title).toBe('Test Novel')
    expect(store.doc.sections).toHaveLength(1)
    expect(store.isModified).toBe(false)
  })

  it('saves document via Rust', async () => {
    invoke.mockResolvedValue(undefined)

    const store = useDocumentStore()
    store.doc = { title: 'Save Me', sections: [] }
    store.isModified = true

    await store.saveDocument('/save.rite')
    expect(invoke).toHaveBeenCalledWith('save_document', { path: '/save.rite' })
    expect(store.isModified).toBe(false)
  })

  it('serializes to JSON', () => {
    const store = useDocumentStore()
    store.doc = { title: 'JSON Test', sections: [] }
    const json = store.toJSON()
    expect(json.title).toBe('JSON Test')
  })

  it('syncs sections and marks modified', () => {
    const store = useDocumentStore()
    store.doc = { title: 'Test', sections: [] }
    const sections = [makeSection('s1', 'Prologue', 'section', [makePara('p1', 'Hello')])]
    store.syncSections(sections)
    expect(store.doc.sections).toEqual(sections)
    expect(store.isModified).toBe(true)
  })

  it('syncSections is a no-op when doc is null', () => {
    const store = useDocumentStore()
    store.doc = null
    store.syncSections([makeSection('s1')])
    expect(store.doc).toBeNull()
  })

  it('loads initial document from Rust', async () => {
    const mockDoc = { title: 'Initial', sections: [] }
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
    expect(store.doc.sections).toHaveLength(1)
    expect(store.doc.sections[0].sectionType).toBe('section')
    expect(store.doc.sections[0].paragraphs).toHaveLength(1)
  })

  it('deletes section via Rust', async () => {
    const updatedDoc = { title: 'Test', sections: [] }
    invoke.mockResolvedValue(updatedDoc)
    const store = useDocumentStore()
    store.doc = { title: 'Test', sections: [makeSection('s1')] }
    await store.deleteSection('s1')
    expect(invoke).toHaveBeenCalledWith('delete_section', { id: 's1' })
    expect(store.doc.sections).toHaveLength(0)
    expect(store.isModified).toBe(true)
  })

  it('renames section via Rust', async () => {
    const updatedDoc = { title: 'Test', sections: [makeSection('s1', 'New Title')] }
    invoke.mockResolvedValue(updatedDoc)
    const store = useDocumentStore()
    store.doc = { title: 'Test', sections: [makeSection('s1', 'Old')] }
    await store.renameSection('s1', 'New Title')
    expect(invoke).toHaveBeenCalledWith('rename_section', { id: 's1', title: 'New Title' })
    expect(store.isModified).toBe(true)
  })

  it('changes section type via Rust', async () => {
    const updatedDoc = { title: 'Test', sections: [makeSection('s1', '', 'chapter')] }
    invoke.mockResolvedValue(updatedDoc)
    const store = useDocumentStore()
    store.doc = { title: 'Test', sections: [makeSection('s1', '', 'section')] }
    await store.changeSectionType('s1', 'chapter')
    expect(invoke).toHaveBeenCalledWith('change_section_type', { id: 's1', newType: 'chapter' })
    expect(store.isModified).toBe(true)
  })

  it('autosaves when lastPath and isModified are set', async () => {
    invoke.mockResolvedValue(undefined)
    const store = useDocumentStore()
    store.lastPath = '/test.rite'
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
    store.lastPath = '/test.rite'
    store.isModified = false
    await store.autosaveDocument()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('syncs document to Rust when modified', async () => {
    invoke.mockResolvedValue(undefined)
    const store = useDocumentStore()
    store.doc = { title: 'Sync', sections: [] }
    store.isModified = true
    await store.syncToRust()
    expect(invoke).toHaveBeenCalledWith('sync_document', { data: store.doc })
  })

  it('skips sync when not modified', async () => {
    const store = useDocumentStore()
    store.doc = { title: 'Sync', sections: [] }
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
    store.doc = { title: 'Test', sections: [] }
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
    const newDoc = { title: 'Direct', sections: [] }
    store.setDoc(newDoc)
    expect(store.doc).toEqual(newDoc)
  })
})