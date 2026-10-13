import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDocumentStore } from '../stores/document.js'
import { useToastsStore } from '../stores/toasts.js'

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

  it('syncSection writes the title, type, and hidden flag from the localized readback', () => {
    const store = useDocumentStore()
    store.doc = { title: 'Test', sections: [makeSection('s1', 'Old', 'section', [makePara('p1', 'x')])] }
    store.syncSection({ id: 's1', title: 'New', sectionType: 'section', hidden: true, paragraphs: [makePara('p1', 'y')] })
    const s = store.doc.sections[0]
    expect(s.title).toBe('New')
    expect(s.hidden).toBe(true)
    expect(s.paragraphs[0].elements[0].textRun.content).toBe('y')
    expect(store.isModified).toBe(true)
  })

  it('syncSection leaves hidden untouched when the readback omits it', () => {
    const store = useDocumentStore()
    store.doc = { title: 'Test', sections: [{ id: 's1', title: 'E', sectionType: 'section', hidden: true, paragraphs: [] }] }
    store.syncSection({ id: 's1', title: 'E', paragraphs: [] })
    expect(store.doc.sections[0].hidden).toBe(true)
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

  it('sets a section hidden via Rust (flush-first, Rust doc assigned back)', async () => {
    const updatedDoc = { title: 'Test', sections: [{ id: 's1', title: 'Epigram', sectionType: 'section', hidden: true, paragraphs: [] }] }
    invoke.mockResolvedValue(updatedDoc)
    const store = useDocumentStore()
    store.doc = { title: 'Test', sections: [makeSection('s1', 'Epigram')] }
    store.isModified = true // a pending typing batch must flush before the invoke
    const docBeforeFlush = store.doc // the flush ships THIS doc, before the command's return replaces it
    await store.setSectionHidden('s1', true)
    // The pending sync ships the live doc first, THEN the command runs.
    expect(invoke).toHaveBeenNthCalledWith(1, 'sync_document', { data: docBeforeFlush })
    expect(invoke).toHaveBeenNthCalledWith(2, 'set_section_hidden', { id: 's1', hidden: true })
    expect(store.doc.sections[0].hidden).toBe(true)
    expect(store.isModified).toBe(true)
  })

  it('setSectionHidden skips the flush when nothing is pending', async () => {
    const updatedDoc = { title: 'Test', sections: [makeSection('s1')] }
    invoke.mockResolvedValue(updatedDoc)
    const store = useDocumentStore()
    store.doc = { title: 'Test', sections: [makeSection('s1')] }
    // isModified false → syncToRust early-returns; only the command runs.
    await store.setSectionHidden('s1', false)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('set_section_hidden', { id: 's1', hidden: false })
  })

  it('moves section via Rust', async () => {
    const updatedDoc = {
      title: 'Test',
      sections: [makeSection('s2'), makeSection('s1')],
    }
    invoke.mockResolvedValue(updatedDoc)
    const store = useDocumentStore()
    store.doc = {
      title: 'Test',
      sections: [makeSection('s1'), makeSection('s2')],
    }
    await store.moveSection('s1', 's2')
    // Tauri v1 maps the JS camelCase arg to Rust's to_after_id.
    expect(invoke).toHaveBeenCalledWith('move_section', { id: 's1', toAfterId: 's2' })
    // Rust's returned doc (with the reordered sections) is assigned back.
    expect(store.doc.sections.map((s) => s.id)).toEqual(['s2', 's1'])
    expect(store.isModified).toBe(true)
  })

  it('maps a null destination to Rust None (front) when moving a section', async () => {
    invoke.mockResolvedValue({ title: 'Test', sections: [] })
    const store = useDocumentStore()
    store.doc = { title: 'Test', sections: [makeSection('s1'), makeSection('s2')] }
    await store.moveSection('s2', null)
    expect(invoke).toHaveBeenCalledWith('move_section', { id: 's2', toAfterId: null })
  })

  it('flushes pending edits before invoking moveSection', async () => {
    const updatedDoc = { title: 'Test', sections: [] }
    invoke.mockResolvedValue(updatedDoc)
    const store = useDocumentStore()
    store.doc = { title: 'Test', sections: [makeSection('s1')] }
    store.isModified = true
    await store.moveSection('s1', null)
    // The FIRST invoke is the flush (sync_document shipping the pending
    // edits to Rust) — without it, assigning the returned doc would discard
    // the un-synced edits.
    expect(invoke.mock.calls[0][0]).toBe('sync_document')
    expect(invoke).toHaveBeenCalledWith('move_section', { id: 's1', toAfterId: null })
  })

  it('reports an error when moving a section fails', async () => {
    invoke.mockRejectedValue(new Error('MoveSection: section nope not found'))
    const store = useDocumentStore()
    const original = { title: 'Test', sections: [makeSection('s1')] }
    store.doc = original

    const toasts = useToastsStore()
    vi.spyOn(toasts, 'pushToast')

    await store.moveSection('nope', 's1')
    // The catch swallows the failure but surfaces it as a labeled toast.
    // (toEqual, not toBe: Pinia hands back a reactive proxy of the doc.)
    expect(store.doc).toEqual(original) // untouched
    expect(toasts.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: expect.stringContaining('nope not found') }),
    )
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

  // --- Save indicator (saveState / lastSavedAt) ----------------------------
  // The status bar's "Saving… / Saved Xm ago / Save failed" label is driven
  // entirely by these two store fields, flipped by the file-write actions.

  it('initializes with idle saveState and no lastSavedAt', () => {
    const store = useDocumentStore()
    expect(store.saveState).toBe('idle')
    expect(store.lastSavedAt).toBeNull()
  })

  it('saveDocument transitions saving → saved and stamps lastSavedAt', async () => {
    invoke.mockResolvedValue(undefined)
    const store = useDocumentStore()
    store.doc = { title: 'Save Me', sections: [] }
    store.isModified = true

    const inFlight = store.saveDocument('/save.rite')
    // Synchronously set to 'saving' before the awaited invoke resolves, so the
    // status bar can show "Saving…" during the write.
    expect(store.saveState).toBe('saving')
    await inFlight

    expect(store.saveState).toBe('saved')
    expect(typeof store.lastSavedAt).toBe('number')
  })

  it('saveDocument records error state when the write fails', async () => {
    invoke.mockRejectedValue(new Error('disk full'))
    const store = useDocumentStore()
    store.doc = { title: 'Save Me', sections: [] }
    store.isModified = true

    await store.saveDocument('/save.rite')
    expect(store.saveState).toBe('error')
    // A failed write must NOT advance lastSavedAt — the label says "Save
    // failed", not "Saved just now".
    expect(store.lastSavedAt).toBeNull()
  })

  it('autosaveDocument transitions saving → saved and stamps lastSavedAt', async () => {
    invoke.mockResolvedValue(undefined)
    const store = useDocumentStore()
    store.lastPath = '/test.rite'
    store.isModified = true

    await store.autosaveDocument()
    expect(invoke).toHaveBeenCalledWith('autosave_document')
    expect(store.saveState).toBe('saved')
    expect(typeof store.lastSavedAt).toBe('number')
  })

  it('autosaveDocument records error state when the write fails', async () => {
    invoke.mockRejectedValue(new Error('autosave boom'))
    const store = useDocumentStore()
    store.lastPath = '/test.rite'
    store.isModified = true

    await store.autosaveDocument()
    expect(store.saveState).toBe('error')
    expect(store.lastSavedAt).toBeNull()
  })

  it('skipping autosave (no path / not modified) leaves saveState untouched', async () => {
    const store = useDocumentStore()
    store.saveState = 'saved'
    store.lastSavedAt = 1000
    store.lastPath = null
    store.isModified = true
    await store.autosaveDocument()
    // Bailed before setting 'saving' — a no-op autosave must not clobber an
    // existing "Saved" indicator.
    expect(store.saveState).toBe('saved')
    expect(store.lastSavedAt).toBe(1000)
  })

  it('loadDocument marks the doc saved with no lastSavedAt (opened, not written)', async () => {
    const mockDoc = { title: 'Opened', author: '', sections: [] }
    invoke.mockResolvedValue(mockDoc)
    const store = useDocumentStore()
    await store.loadDocument('/opened.rite')
    expect(store.saveState).toBe('saved')
    // We did not write it this session, so there is no timestamp to count from.
    expect(store.lastSavedAt).toBeNull()
  })

  // --- New document (name-on-creation, 1.8) --------------------------------

  it('newDocument installs a named fresh doc, unsaved, and syncs it to Rust', async () => {
    invoke.mockResolvedValue(undefined)
    const store = useDocumentStore()
    store.lastPath = '/old.rite'
    store.isModified = false
    store.saveState = 'saved'
    store.lastSavedAt = 12345

    await store.newDocument('My Novel')

    expect(store.doc.title).toBe('My Novel')
    // One empty section to type into.
    expect(store.doc.sections).toHaveLength(1)
    expect(store.doc.sections[0].paragraphs).toHaveLength(1)
    // Never saved: no path, no save state, but flagged modified so the editor
    // knows to sync edits.
    expect(store.lastPath).toBeNull()
    expect(store.isModified).toBe(true)
    expect(store.saveState).toBe('idle')
    expect(store.lastSavedAt).toBeNull()
    // Pushed to Rust so AppState holds the new doc, not the previous one.
    expect(invoke).toHaveBeenCalledWith('sync_document', expect.objectContaining({
      data: expect.objectContaining({ title: 'My Novel' }),
    }))
  })

  it('newDocument falls back to Untitled for an empty or whitespace name', async () => {
    invoke.mockResolvedValue(undefined)
    const store = useDocumentStore()
    await store.newDocument('   ')
    expect(store.doc.title).toBe('Untitled')
  })
})