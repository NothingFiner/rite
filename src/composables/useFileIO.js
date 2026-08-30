import { open, save, ask, message } from '@tauri-apps/api/dialog'
import { readBinaryFile } from '@tauri-apps/api/fs'
import { useDocumentStore } from '../stores/document.js'
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
        console.error('Failed to save:', e)
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
      console.error('Failed to save:', e)
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
        hasEpigram: false,
        epigramText: '',
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

  return { saveFile, openFile, importFile }
}
