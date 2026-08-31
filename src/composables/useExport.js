import { save, message } from '@tauri-apps/api/dialog'
import { invoke } from '@tauri-apps/api/tauri'
import { useDocumentStore } from '../stores/document.js'

/// Export the live document to a plain-text (.txt) or Markdown (.md) file.
///
/// The Rust `export_text` command reads the document straight from `AppState`
/// (the single source of truth), so this composable does not need to pass the
/// document over the wire — only the chosen `path` and `format`. A Tauri
/// native `save()` dialog picks the path with a format-appropriate extension
/// filter; a cancelled dialog returns early. Errors surface via a Tauri
/// `message()` error dialog, mirroring `useFileIO.openFile`'s pattern (a toast
/// system is being built separately; until it lands we use the same native
/// dialog the rest of the file I/O uses).
export function useExport() {
  const store = useDocumentStore()

  /// The base filename proposed in the save dialog. Falls back to "Untitled"
  /// when the document has no title, matching `useFileIO.saveFile`.
  function defaultFileName(extension) {
    const base = (store.doc?.title || 'Untitled').trim() || 'Untitled'
    return `${base}.${extension}`
  }

  /// `format` is the Rust `ExportFormat` discriminator — `'plainText'` or
  /// `'markdown'` (camelCase, matching the `#[serde(rename_all = "camelCase")]`
  /// on the Rust enum).
  async function exportFile(format) {
    const isMarkdown = format === 'markdown'
    const extension = isMarkdown ? 'md' : 'txt'
    const filterName = isMarkdown ? 'Markdown' : 'Plain Text'

    const path = await save({
      filters: [{ name: filterName, extensions: [extension] }],
      defaultPath: defaultFileName(extension),
    })
    if (!path) return // cancelled

    try {
      await invoke('export_text', { path, format })
    } catch (e) {
      console.error('Failed to export:', e)
      await message('Failed to export document: ' + (e?.message || String(e)), {
        title: 'Rite',
        type: 'error',
      })
    }
  }

  async function exportPlainText() {
    await exportFile('plainText')
  }

  async function exportMarkdown() {
    await exportFile('markdown')
  }

  return { exportFile, exportPlainText, exportMarkdown }
}