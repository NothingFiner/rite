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

import { save } from '@tauri-apps/api/dialog'
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
      // The title follows the new filename (saveDocument derives it from path).
      expect(store.doc.title).toBe('novel-copy')
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
})