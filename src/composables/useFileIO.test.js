import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDocumentStore } from '../stores/document.js'
import { useToastsStore } from '../stores/toasts.js'

vi.mock('@tauri-apps/api/dialog', () => ({
  save: vi.fn(),
  open: vi.fn(),
  ask: vi.fn(),
  message: vi.fn(),
}))

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/fs', () => ({
  readBinaryFile: vi.fn(),
}))

import { save, open, ask, message } from '@tauri-apps/api/dialog'
import { invoke } from '@tauri-apps/api/tauri'
import { useFileIO } from './useFileIO.js'

describe('useFileIO', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('saveFileAs (Fix 3 — copy + switch)', () => {
    it('always shows the save dialog, even when a lastPath is already set', async () => {
      // The defining difference from saveFile: saveFile short-circuits to a
      // silent write when lastPath exists; saveFileAs ALWAYS prompts so the
      // user picks a new path (the copy destination). The old file is never
      // deleted — non-destructive.
      save.mockResolvedValue('/tmp/novel-copy.rite')
      invoke.mockResolvedValue(undefined)

      const store = useDocumentStore()
      store.doc = { title: 'Novel', sections: [] }
      store.lastPath = '/tmp/novel.rite'

      const { saveFileAs } = useFileIO()
      await saveFileAs()

      expect(save).toHaveBeenCalledWith({
        filters: [{ name: 'Rite Document', extensions: ['rite'] }],
        defaultPath: 'Novel.rite',
      })
      expect(invoke).toHaveBeenCalledWith('save_document', { path: '/tmp/novel-copy.rite' })
    })

    it('switches lastPath + saveState to the new file (the copy becomes current)', async () => {
      // saveDocument updates lastPath, title, and saveState — so after Save As
      // a subsequent quick-save (Cmd+S) writes to the NEW file, not the old
      // one. The old file remains on disk untouched.
      save.mockResolvedValue('/tmp/novel-copy.rite')
      invoke.mockResolvedValue(undefined)

      const store = useDocumentStore()
      store.doc = { title: 'Novel', sections: [] }
      store.lastPath = '/tmp/novel.rite'

      const { saveFileAs } = useFileIO()
      await saveFileAs()

      expect(store.lastPath).toBe('/tmp/novel-copy.rite')
      expect(store.isModified).toBe(false)
      expect(store.saveState).toBe('saved')
      expect(store.lastSavedAt).toBeTypeOf('number')
      // The title does NOT follow the filename: the document's title is its own
      // property, set by the New prompt, by opening a file, or in Document Info.
      // This assertion is the inverse of what it used to be — that behaviour was
      // a bug, because it discarded the title stored in the file on every save
      // (and any title the user typed in Document Info). See SPEC.md S-003.
      expect(store.doc.title).toBe('Novel')
    })

    it('seeds the dialog with "Untitled" when the document has no title', async () => {
      save.mockResolvedValue('/tmp/Untitled.rite')
      invoke.mockResolvedValue(undefined)

      const store = useDocumentStore()
      store.doc = { title: '', sections: [] }

      const { saveFileAs } = useFileIO()
      await saveFileAs()

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: 'Untitled.rite' }),
      )
    })

    it('does nothing when the save dialog is cancelled', async () => {
      // A cancelled dialog returns null; saveFileAs must bail before invoking
      // save_document, and must NOT clobber the existing lastPath.
      save.mockResolvedValue(null)

      const store = useDocumentStore()
      store.doc = { title: 'Novel', sections: [] }
      store.lastPath = '/tmp/novel.rite'

      const { saveFileAs } = useFileIO()
      await saveFileAs()

      expect(invoke).not.toHaveBeenCalled()
      expect(store.lastPath).toBe('/tmp/novel.rite')
    })

    it('leaves saveState errored and surfaces a toast when save_document rejects', async () => {
      save.mockResolvedValue('/tmp/novel-copy.rite')
      invoke.mockRejectedValue(new Error('disk full'))

      const store = useDocumentStore()
      store.doc = { title: 'Novel', sections: [] }
      store.lastPath = '/tmp/novel.rite'

      const toasts = useToastsStore()
      vi.spyOn(toasts, 'pushToast')

      const { saveFileAs } = useFileIO()
      await saveFileAs()

      // saveDocument catches the invoke failure itself (it does NOT rethrow):
      // it sets saveState='error' and pushes a labeled toast via notifyError.
      // saveFileAs's own catch therefore never runs — the toast is the store's,
      // prefixed with the "Failed to save" label.
      expect(store.saveState).toBe('error')
      expect(toasts.pushToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: 'Failed to save: disk full' }),
      )
    })
  })

  describe('saveFile (quick save — unchanged behavior, locked in)', () => {
    it('silently writes to lastPath without showing a dialog', async () => {
      // The complement to saveFileAs: when lastPath exists, saveFile writes
      // straight to it — no dialog, no toast. This is why both exist: Save is
      // one-click to the current file, Save As is the explicit copy.
      invoke.mockResolvedValue(undefined)

      const store = useDocumentStore()
      store.doc = { title: 'Novel', sections: [] }
      store.lastPath = '/tmp/novel.rite'

      const { saveFile } = useFileIO()
      await saveFile()

      expect(save).not.toHaveBeenCalled()
      expect(invoke).toHaveBeenCalledWith('save_document', { path: '/tmp/novel.rite' })
      expect(store.saveState).toBe('saved')
    })

    it('falls back to the save dialog when there is no lastPath', async () => {
      save.mockResolvedValue('/tmp/novel.rite')
      invoke.mockResolvedValue(undefined)

      const store = useDocumentStore()
      store.doc = { title: 'Novel', sections: [] }
      store.lastPath = null

      const { saveFile } = useFileIO()
      await saveFile()

      expect(save).toHaveBeenCalledWith({
        filters: [{ name: 'Rite Document', extensions: ['rite'] }],
        defaultPath: 'Novel.rite',
      })
      expect(store.lastPath).toBe('/tmp/novel.rite')
    })
  })
  // ---------------------------------------------------------------------
  // SPEC.md S-001..S-009 - the title is independent of the filename.
  //
  // The document's title is a property of the document: set by the New
  // prompt, adopted from the file on open, or typed in Document Info. Saving
  // never rewrites it. These tests drive the real composable + the real
  // store, so what they assert is what the app does end to end.
  // ---------------------------------------------------------------------
  describe('save and title independence (SPEC S-001..S-009)', () => {
    it('S-001: saving to the current path writes the document without changing its title', async () => {
      invoke.mockResolvedValue(undefined)

      const store = useDocumentStore()
      store.doc = { title: 'Chapter One', sections: [] }
      store.lastPath = '/tmp/novel.rite'

      const { saveFile } = useFileIO()
      await saveFile()

      expect(invoke).toHaveBeenCalledWith('save_document', { path: '/tmp/novel.rite' })
      expect(store.doc.title).toBe('Chapter One')
    })

    it('S-002: Save As writes to the chosen path and later quick saves use it', async () => {
      save.mockResolvedValue('/tmp/copy.rite')
      invoke.mockResolvedValue(undefined)

      const store = useDocumentStore()
      store.doc = { title: 'Chapter One', sections: [] }
      store.lastPath = '/tmp/novel.rite'

      const { saveFileAs, saveFile } = useFileIO()
      await saveFileAs()
      await saveFile()

      expect(invoke).toHaveBeenNthCalledWith(1, 'save_document', { path: '/tmp/copy.rite' })
      expect(invoke).toHaveBeenNthCalledWith(2, 'save_document', { path: '/tmp/copy.rite' })
      // The quick save must not reopen the dialog: it writes to the path
      // Save As just installed.
      expect(save).toHaveBeenCalledTimes(1)
    })

    it('S-003: Save As does not change the document title', async () => {
      save.mockResolvedValue('/tmp/a-completely-different-name.rite')
      invoke.mockResolvedValue(undefined)

      const store = useDocumentStore()
      store.doc = { title: 'Chapter One', sections: [] }
      store.lastPath = '/tmp/novel.rite'

      const { saveFileAs } = useFileIO()
      await saveFileAs()

      expect(store.lastPath).toBe('/tmp/a-completely-different-name.rite')
      expect(store.doc.title).toBe('Chapter One')
    })

    it('S-004: Save As writes over an existing path without asking again', async () => {
      // The native save dialog already confirms replacement. A second,
      // app-level "file exists, overwrite?" prompt is worse than none: it
      // treats the writer as if they had not just answered that question.
      save.mockResolvedValue('/tmp/existing.rite')
      invoke.mockResolvedValue(undefined)

      const store = useDocumentStore()
      store.doc = { title: 'Chapter One', sections: [] }
      store.lastPath = '/tmp/novel.rite'

      const { saveFileAs } = useFileIO()
      await saveFileAs()

      expect(invoke).toHaveBeenCalledWith('save_document', { path: '/tmp/existing.rite' })
      expect(ask).not.toHaveBeenCalled()
      expect(message).not.toHaveBeenCalled()
    })

    it('S-005: Save As on an unmodified document still writes to the chosen path', async () => {
      // Save As is not "save if dirty": the writer asked for a write, so the
      // file is written even when nothing changed since the last save.
      save.mockResolvedValue('/tmp/copy.rite')
      invoke.mockResolvedValue(undefined)

      const store = useDocumentStore()
      store.doc = { title: 'Chapter One', sections: [] }
      store.lastPath = '/tmp/novel.rite'
      store.isModified = false

      const { saveFileAs } = useFileIO()
      await saveFileAs()

      expect(invoke).toHaveBeenCalledWith('save_document', { path: '/tmp/copy.rite' })
    })

    it('S-006: Save As to the path the document already has still writes', async () => {
      save.mockResolvedValue('/tmp/novel.rite')
      invoke.mockResolvedValue(undefined)

      const store = useDocumentStore()
      store.doc = { title: 'Chapter One', sections: [] }
      store.lastPath = '/tmp/novel.rite'

      const { saveFileAs } = useFileIO()
      await saveFileAs()

      expect(invoke).toHaveBeenCalledWith('save_document', { path: '/tmp/novel.rite' })
      expect(store.lastPath).toBe('/tmp/novel.rite')
    })

    it('S-007: the Save As dialog proposes the current filename when the document has a path', async () => {
      // Seeding from the title would propose a misleading name now that the
      // two are independent: a document titled "Chapter One" living in
      // draft-v2.rite should offer draft-v2.rite, not Chapter One.rite.
      save.mockResolvedValue('/tmp/draft-v2-copy.rite')
      invoke.mockResolvedValue(undefined)

      const store = useDocumentStore()
      store.doc = { title: 'Chapter One', sections: [] }
      store.lastPath = '/tmp/draft-v2.rite'

      const { saveFileAs } = useFileIO()
      await saveFileAs()

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: 'draft-v2.rite' }),
      )
    })

    it('S-007: the Save As dialog proposes the title when the document has no path', async () => {
      save.mockResolvedValue('/tmp/Chapter One.rite')
      invoke.mockResolvedValue(undefined)

      const store = useDocumentStore()
      store.doc = { title: 'Chapter One', sections: [] }
      store.lastPath = null

      const { saveFileAs } = useFileIO()
      await saveFileAs()

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: 'Chapter One.rite' }),
      )
    })

    it('S-008: opening a document adopts the title stored in the file', async () => {
      open.mockResolvedValue('/tmp/on-disk.rite')
      invoke.mockResolvedValue({ title: 'The Stored Title', sections: [] })

      const store = useDocumentStore()
      store.doc = { title: 'Whatever Was Here Before', sections: [] }

      const { openFile } = useFileIO()
      await openFile()

      expect(invoke).toHaveBeenCalledWith('open_document', { path: '/tmp/on-disk.rite' })
      expect(store.doc.title).toBe('The Stored Title')
    })

    it('S-009: cancelling the Save As dialog leaves the path and the title unchanged', async () => {
      save.mockResolvedValue(null)

      const store = useDocumentStore()
      store.doc = { title: 'Chapter One', sections: [] }
      store.lastPath = '/tmp/novel.rite'

      const { saveFileAs } = useFileIO()
      await saveFileAs()

      expect(invoke).not.toHaveBeenCalled()
      expect(store.lastPath).toBe('/tmp/novel.rite')
      expect(store.doc.title).toBe('Chapter One')
    })
  })
})
