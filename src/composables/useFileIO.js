import { open, save } from '@tauri-apps/api/dialog'
import { readBinaryFile } from '@tauri-apps/api/fs'
import { useDocumentStore } from '../stores/document.js'
import { importDocx, importOdt } from './useImport.js'

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
      filters: [{ name: 'rite', extensions: ['fwd'] }],
      defaultPath: (store.doc?.title || 'Untitled') + '.fwd',
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
      filters: [{ name: 'rite', extensions: ['fwd'] }],
      multiple: false,
    })
    if (!filePath) return
    try {
      await store.loadDocument(filePath)
    } catch (e) {
      console.error('Failed to open:', e)
    }
  }

  async function importFile() {
    if (store.isModified && store.doc?.body?.content?.length > 0) {
      const shouldSave = confirm('You have unsaved changes. Save before importing?')
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
      let paragraphs
      if (lower.endsWith('.docx')) {
        paragraphs = await importDocx(arrayBuffer)
      } else if (lower.endsWith('.odt')) {
        paragraphs = await importOdt(arrayBuffer)
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
        body: { content: paragraphs },
      })
      store.lastPath = null
      store.markModified()
      await store.syncToRust()
    } catch (e) {
      console.error('Failed to import:', e)
      alert('Import failed: ' + e.message)
    }
  }

  return { saveFile, openFile, importFile }
}
