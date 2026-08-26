import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/tauri'

export const useDocumentStore = defineStore('document', {
  state: () => ({
    doc: null,
    isModified: false,
    isLoading: false,
    lastPath: null,
    syncTimeout: null,
  }),

  actions: {
    async loadInitialDocument() {
      try {
        const initialDoc = await invoke('get_document')
        this.doc = initialDoc
      } catch (e) {
        console.error('Failed to load initial document:', e)
        this.doc = {
          title: 'Untitled',
          author: 'Author Name',
          authorContact: '',
          hasTOC: false,
          hasEpigram: false,
          epigramText: '',
          body: { content: [] },
        }
      }
    },

    async loadDocument(path) {
      this.isLoading = true
      try {
        const data = await invoke('open_document', { path })
        this.doc = data
        this.lastPath = path
        this.isModified = false
      } catch (e) {
        console.error('Failed to open document:', e)
      } finally {
        this.isLoading = false
      }
    },

    async insertHeading(level, afterId = null) {
      try {
        const updated = await invoke('insert_heading', { level, afterId })
        this.doc = updated
        this.isModified = true
      } catch (e) {
        console.error('Failed to insert heading:', e)
      }
    },

    async deleteHeading(id) {
      try {
        const updated = await invoke('delete_heading', { id })
        this.doc = updated
        this.isModified = true
      } catch (e) {
        console.error('Failed to delete heading:', e)
      }
    },

    async renameSection(id, title) {
      try {
        const updated = await invoke('rename_section', { id, title })
        this.doc = updated
        this.isModified = true
      } catch (e) {
        console.error('Failed to rename section:', e)
      }
    },

    async applyTextStyle({ paragraphId, startOffset, endOffset, bold, italic, underline, fontSize }) {
      try {
        const updated = await invoke('apply_text_style', {
          paragraphId,
          startOffset,
          endOffset,
          styleDelta: { bold, italic, underline, fontSize },
        })
        this.doc = updated
        this.isModified = true
      } catch (e) {
        console.error('Failed to apply text style:', e)
      }
    },

    async applyParagraphStyle({ paragraphId, style }) {
      try {
        const updated = await invoke('apply_paragraph_style', { paragraphId, style })
        this.doc = updated
        this.isModified = true
      } catch (e) {
        console.error('Failed to apply paragraph style:', e)
      }
    },

    async undo() {
      try {
        const updated = await invoke('undo')
        this.doc = updated
        this.isModified = true
      } catch (e) {
        console.error('Failed to undo:', e)
      }
    },

    async redo() {
      try {
        const updated = await invoke('redo')
        this.doc = updated
        this.isModified = true
      } catch (e) {
        console.error('Failed to redo:', e)
      }
    },

    async saveDocument(path) {
      try {
        await invoke('save_document', { path })
        if (this.doc) {
          this.doc.title = path.split(/[\\/]/).pop().replace(/\.(fwd|rite)$/, '')
        }
        this.lastPath = path
        this.isModified = false
      } catch (e) {
        console.error('Failed to save:', e)
      }
    },

    async autosaveDocument() {
      if (!this.lastPath || !this.isModified) return
      try {
        await invoke('autosave_document')
        this.isModified = false
      } catch (e) {
        console.error('Auto-save failed:', e)
      }
    },

    async syncToRust() {
      if (!this.doc || !this.isModified) return
      try {
        await invoke('sync_document', { data: this.doc })
      } catch (e) {
        console.error('Failed to sync to Rust:', e)
      }
    },

    debouncedSync() {
      if (this.syncTimeout) clearTimeout(this.syncTimeout)
      this.syncTimeout = setTimeout(() => this.syncToRust(), 1000)
    },

    markModified() {
      this.isModified = true
      this.debouncedSync()
    },

    resetModified() {
      this.isModified = false
    },

    setDoc(newDoc) {
      this.doc = newDoc
    },

    syncBodyContent(paragraphs) {
      if (!this.doc) return
      if (!this.doc.body) this.doc.body = { content: [] }
      this.doc.body.content = paragraphs
      this.markModified()
    },

    toJSON() {
      return JSON.parse(JSON.stringify(this.doc))
    },
  },
})
