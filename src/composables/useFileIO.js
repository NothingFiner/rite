import { open, save } from '@tauri-apps/api/dialog'
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
      console.error('Failed to open:', e)
    }
  }

  async function importFile() {
    if (store.isModified && store.doc?.sections?.length > 0 && !sectionListIsEmpty(store.doc.sections)) {
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
      alert('Import failed: ' + e.message)
    }
  }

  return { saveFile, openFile, importFile }
}
