import { open, save, ask, message } from '@tauri-apps/api/dialog'
import { readBinaryFile } from '@tauri-apps/api/fs'
import { useDocumentStore } from '../stores/document.js'
import { useToastsStore } from '../stores/toasts.js'
import { importDocx, importOdt } from './useImport.js'
import { isEmptyParagraph } from '../constants/ParagraphStyle.js'

/// A document is effectively empty (no real content to lose) when no section
/// has a title and every paragraph in every section is empty. Used by importFile
/// to decide whether to prompt "save before importing?" — a fresh untitled doc
/// (one section, one empty paragraph, no title) is empty and should not prompt.
function sectionListIsEmpty(sections) {
  if (!sections || sections.length === 0) return true
  return sections.every(
    (s) => !s.title?.trim() && (s.paragraphs?.length ? s.paragraphs.every(isEmptyParagraph) : true)
  )
}

export function useFileIO() {
  const store = useDocumentStore()

  async function saveFile() {
    if (store.lastPath) {
      try {
        await store.saveDocument(store.lastPath)
      } catch (e) {
        useToastsStore().pushToast({ type: 'error', message: e?.message || String(e) })
      }
      return
    }

    const filePath = await save({
      filters: [{ name: 'Rite Document', extensions: ['rite'] }],
      defaultPath: (store.doc?.title || 'Untitled') + '.rite',
    })
    if (!filePath) return
    try {
      await store.saveDocument(filePath)
    } catch (e) {
      useToastsStore().pushToast({ type: 'error', message: e?.message || String(e) })
    }
  }

  /// Save a COPY of the current document to a new path, then switch to it
  /// (Fix 3, non-destructive "Save As"). Unlike `saveFile`, this ALWAYS shows
  /// the save dialog — it never silently writes to `lastPath`. The old file
  /// stays on disk untouched (we never delete it); `saveDocument` then updates
  /// `lastPath` + title + saveState so subsequent quick-saves go to the NEW
  /// file. This is `saveFile` with the `lastPath` short-circuit removed and the
  /// dialog path always taken — split out so "Save" stays a one-click save to
  /// the current file and "Save As" is the explicit copy/rename-to-new-path.
  async function saveFileAs() {
    const filePath = await save({
      filters: [{ name: 'Rite Document', extensions: ['rite'] }],
      defaultPath: (store.doc?.title || 'Untitled') + '.rite',
    })
    if (!filePath) return
    try {
      await store.saveDocument(filePath)
    } catch (e) {
      useToastsStore().pushToast({ type: 'error', message: e?.message || String(e) })
    }
  }

  async function openFile() {
    const filePath = await open({
      filters: [{ name: 'Rite Document', extensions: ['rite'] }],
      multiple: false,
    })
    if (!filePath) return
    try {
      await store.loadDocument(filePath)
    } catch (e) {
      // The store rethrows open_document failures (it used to swallow them
      // silently with console.error, which read as "nothing happens" in the
      // UI). Surface the actual cause — a serde schema mismatch on an older
      // .rite, an IO error, etc. — so the user knows why the file didn't open.
      console.error('Failed to open:', e)
      await message('Failed to open document: ' + (e?.message || String(e)), {
        title: 'Rite',
        type: 'error',
      })
    }
  }

  async function importFile() {
    if (store.isModified && store.doc?.sections?.length > 0 && !sectionListIsEmpty(store.doc.sections)) {
      // Use Tauri's async `ask` (a Rust-side native dialog) instead of the
      // synchronous `window.confirm`. `window.confirm`/`window.alert` block the
      // webview's main thread on a WKWebView JS panel that, in this app's
      // overlay-titlebar + macOSPrivateApi window, does not render visibly — so
      // the call never returns and the app freezes (only reachable when a doc
      // with unsaved content is open, which is why import "hangs" then). The
      // async Tauri dialog keeps the webview responsive and is the same dialog
      // plugin `open`/`save` already use successfully.
      const shouldSave = await ask('You have unsaved changes. Save before importing?', {
        title: 'Rite',
        type: 'warning',
      })
      if (shouldSave) {
        await saveFile()
      }
    }

    const filePath = await open({
      filters: [
        { name: 'Documents', extensions: ['docx', 'odt'] },
        { name: 'Word Document', extensions: ['docx'] },
        { name: 'OpenDocument Text', extensions: ['odt'] },
      ],
      multiple: false,
    })
    if (!filePath) return
    try {
      const data = await readBinaryFile(filePath)
      const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      const lower = filePath.toLowerCase()
      let sections
      if (lower.endsWith('.docx')) {
        sections = await importDocx(arrayBuffer)
      } else if (lower.endsWith('.odt')) {
        sections = await importOdt(arrayBuffer)
      } else {
        throw new Error('Unsupported file type')
      }

      if (store.syncTimeout) clearTimeout(store.syncTimeout)

      store.setDoc({
        title: filePath.split(/[\\/]/).pop().replace(/\.(docx|odt)$/i, ''),
        author: '',
        authorContact: '',
        hasTOC: false,
        sections,
      })
      store.lastPath = null
      store.markModified()
      await store.syncToRust()
    } catch (e) {
      console.error('Failed to import:', e)
      await message('Import failed: ' + e.message, { title: 'Rite', type: 'error' })
    }
  }

  /// Guard the start of a new document. If the current doc has real unsaved
  /// content, offer to save it first (same `ask` dialog + sectionListIsEmpty
  /// check importFile uses). Returns once the guard is satisfied; the caller
  /// (App.vue) then opens the name-prompt modal. The actual fresh-doc creation
  /// lives in the store's `newDocument(title)` action, called after the user
  /// enters a name — the name is the whole point of 1.8, so it can't be decided
  /// here.
  async function newFile() {
    if (
      store.isModified &&
      store.doc?.sections?.length > 0 &&
      !sectionListIsEmpty(store.doc.sections)
    ) {
      const shouldSave = await ask('You have unsaved changes. Save before starting a new document?', {
        title: 'Rite',
        type: 'warning',
      })
      if (shouldSave) {
        await saveFile()
      }
    }
  }

  return { saveFile, saveFileAs, openFile, importFile, newFile }
}
