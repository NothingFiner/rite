import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/tauri'
import { createSection } from '../constants/DocumentModel.js'

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
          sections: [createSection()],
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

    async deleteSection(id) {
      try {
        const updated = await invoke('delete_section', { id })
        this.doc = updated
        this.isModified = true
      } catch (e) {
        console.error('Failed to delete section:', e)
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

    async changeSectionType(id, newType) {
      try {
        const updated = await invoke('change_section_type', { id, newType })
        this.doc = updated
        this.isModified = true
      } catch (e) {
        console.error('Failed to change section type:', e)
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

    /// Replace the document's sections from the editor's flat-DOM sync. The
    /// editor owns the flat block sequence; on every edit it groups blocks
    /// back into sections and emits the result here. This is the single
    /// direct write into doc.sections, so it is the one place the model and
    /// the live DOM are reconciled.
    syncSections(sections) {
      if (!this.doc) return
      this.doc.sections = sections
      this.markModified()
    },

    toJSON() {
      return JSON.parse(JSON.stringify(this.doc))
    },
  },
})