import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDocumentStore } from '../stores/document.js'

vi.mock('@tauri-apps/api/dialog', () => ({
  save: vi.fn(),
  message: vi.fn(),
}))

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(),
}))

import { save, message } from '@tauri-apps/api/dialog'
import { invoke } from '@tauri-apps/api/tauri'
import { useExport } from './useExport.js'

describe('useExport', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('exportPlainText opens a .txt save dialog and invokes export_text', async () => {
    save.mockResolvedValue('/tmp/novel.txt')
    invoke.mockResolvedValue(undefined)

    const store = useDocumentStore()
    store.doc = { title: 'Novel', sections: [] }

    const { exportPlainText } = useExport()
    await exportPlainText()

    expect(save).toHaveBeenCalledWith({
      filters: [{ name: 'Plain Text', extensions: ['txt'] }],
      defaultPath: 'Novel.txt',
    })
    expect(invoke).toHaveBeenCalledWith('export_text', {
      path: '/tmp/novel.txt',
      format: 'plainText',
    })
    expect(message).not.toHaveBeenCalled()
  })

  it('exportMarkdown opens a .md save dialog and invokes export_text', async () => {
    save.mockResolvedValue('/tmp/novel.md')
    invoke.mockResolvedValue(undefined)

    const store = useDocumentStore()
    store.doc = { title: 'Novel', sections: [] }

    const { exportMarkdown } = useExport()
    await exportMarkdown()

    expect(save).toHaveBeenCalledWith({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: 'Novel.md',
    })
    expect(invoke).toHaveBeenCalledWith('export_text', {
      path: '/tmp/novel.md',
      format: 'markdown',
    })
  })

  it('falls back to "Untitled" when the document has no title', async () => {
    save.mockResolvedValue('/tmp/Untitled.txt')
    invoke.mockResolvedValue(undefined)

    const store = useDocumentStore()
    store.doc = { title: '', sections: [] }

    const { exportPlainText } = useExport()
    await exportPlainText()

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'Untitled.txt' }),
    )
  })

  it('does nothing when the save dialog is cancelled', async () => {
    // A cancelled save dialog returns null/undefined; the composable must bail
    // before invoking export_text.
    save.mockResolvedValue(null)

    const store = useDocumentStore()
    store.doc = { title: 'Novel', sections: [] }

    const { exportPlainText } = useExport()
    await exportPlainText()

    expect(invoke).not.toHaveBeenCalled()
    expect(message).not.toHaveBeenCalled()
  })

  it('shows an error dialog when invoke rejects', async () => {
    save.mockResolvedValue('/tmp/novel.txt')
    invoke.mockRejectedValue(new Error('disk full'))

    const store = useDocumentStore()
    store.doc = { title: 'Novel', sections: [] }

    const { exportPlainText } = useExport()
    await exportPlainText()

    expect(invoke).toHaveBeenCalled()
    expect(message).toHaveBeenCalledWith(
      'Failed to export document: disk full',
      { title: 'Rite', type: 'error' },
    )
  })

  it('exportFile delegates to the same path with the given format', async () => {
    save.mockResolvedValue('/tmp/novel.md')
    invoke.mockResolvedValue(undefined)

    const store = useDocumentStore()
    store.doc = { title: 'Novel', sections: [] }

    const { exportFile } = useExport()
    await exportFile('markdown')

    expect(invoke).toHaveBeenCalledWith('export_text', {
      path: '/tmp/novel.md',
      format: 'markdown',
    })
  })

  it('exportDocx opens a .docx save dialog and invokes export_docx (no format arg)', async () => {
    save.mockResolvedValue('/tmp/novel.docx')
    invoke.mockResolvedValue(undefined)

    const store = useDocumentStore()
    store.doc = { title: 'Novel', sections: [] }

    const { exportDocx } = useExport()
    await exportDocx()

    expect(save).toHaveBeenCalledWith({
      filters: [{ name: 'Word Document', extensions: ['docx'] }],
      defaultPath: 'Novel.docx',
    })
    // The DOCX command takes only a path — there is no format discriminator.
    expect(invoke).toHaveBeenCalledWith('export_docx', { path: '/tmp/novel.docx' })
    expect(message).not.toHaveBeenCalled()
  })

  it('exportDocx shows an error dialog when invoke rejects', async () => {
    save.mockResolvedValue('/tmp/novel.docx')
    invoke.mockRejectedValue(new Error('disk full'))

    const store = useDocumentStore()
    store.doc = { title: 'Novel', sections: [] }

    const { exportDocx } = useExport()
    await exportDocx()

    expect(message).toHaveBeenCalledWith(
      'Failed to export document: disk full',
      { title: 'Rite', type: 'error' },
    )
  })
})