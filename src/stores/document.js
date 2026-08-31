import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/tauri'
import { createSection } from '../constants/DocumentModel.js'
import { useToastsStore } from './toasts.js'

export const useDocumentStore = defineStore('document', {
  state: () => ({
    doc: null,
    isModified: false,
    isLoading: false,
    lastPath: null,
    syncTimeout: null,
    // Save indicator state for the status bar. `saveState` tracks the last
    // file-write attempt: 'idle' (nothing saved yet), 'saving' (a write is in
    // flight), 'saved' (the last write succeeded), 'error' (it failed).
    // `lastSavedAt` is the epoch-ms timestamp of the most recent successful
    // write, used for the "Saved 2m ago" relative label. Both are driven from
    // the two file-write paths — explicit `saveDocument` AND the background
    // `autosaveDocument` (which rewrites the whole `.rite`, not just journals
    // history) — so the indicator reflects every real flush to disk.
    saveState: 'idle',
    lastSavedAt: null,
  }),

  actions: {
    /// Surface a swallowed error to the user via the toasts store. Keeps a
    /// console.error for dev diagnostics; the toast is the user-visible signal
    /// that something went wrong (previously these catch sites were silent).
    /// `label` prefixes the message so the toast says e.g. "Save failed: ..."
    /// rather than just the raw Rust error string.
    notifyError(error, label) {
      const message = (label ? label + ': ' : '') + (error?.message || String(error))
      console.error(label || 'Error:', error)
      useToastsStore().pushToast({ type: 'error', message })
    },

    async loadInitialDocument() {
      try {
        const initialDoc = await invoke('get_document')
        this.doc = initialDoc
      } catch (e) {
        this.notifyError(e, 'Failed to load initial document')
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
        // The on-disk file matches memory, so the doc is "saved" — but we did
        // not write it this session, so there is no `lastSavedAt` to count
        // from. The status bar shows a bare "Saved" (no relative time) for
        // this case, distinct from "Saved 2m ago" after a real write.
        this.saveState = 'saved'
        this.lastSavedAt = null
      } catch (e) {
        // Log, then rethrow so the caller (useFileIO.openFile) can surface the
        // actual cause to the user. Previously this swallowed the error, which
        // made a failed open look like "nothing happens."
        console.error('Failed to open document:', e)
        throw e
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
        this.notifyError(e, 'Failed to delete section')
      }
    },

    async renameSection(id, title) {
      try {
        const updated = await invoke('rename_section', { id, title })
        this.doc = updated
        this.isModified = true
      } catch (e) {
        this.notifyError(e, 'Failed to rename section')
      }
    },

    async changeSectionType(id, newType) {
      try {
        const updated = await invoke('change_section_type', { id, newType })
        this.doc = updated
        this.isModified = true
      } catch (e) {
        this.notifyError(e, 'Failed to change section type')
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
        this.notifyError(e, 'Failed to apply text style')
      }
    },

    async undo() {
      try {
        // Flush any pending typing batch BEFORE undoing. syncToRust ships the
        // current doc to Rust, where sync_document journals it as the most
        // recent history delta — so the undo below reverts the user's latest
        // uncommitted edits instead of skipping them (the "he" vs "the" bug:
        // the live DOM/store had run ahead of the lagging Rust copy, so undo
        // reverted a stale snapshot). Harmless when nothing is pending:
        // syncToRust early-returns when !isModified, and push_history_delta
        // no-ops on an unchanged doc, so no spurious undo step is created.
        await this.syncToRust()
        const updated = await invoke('undo')
        this.doc = updated
        this.isModified = true
      } catch (e) {
        this.notifyError(e, 'Failed to undo')
      }
    },

    async redo() {
      try {
        // Same flush-before-redo rationale as undo: commit any pending typing
        // as a fresh delta (which truncates the redo branch, correctly killing
        // redo after a new edit) before reapplying the next forward delta.
        await this.syncToRust()
        const updated = await invoke('redo')
        this.doc = updated
        this.isModified = true
      } catch (e) {
        this.notifyError(e, 'Failed to redo')
      }
    },

    async saveDocument(path) {
      this.saveState = 'saving'
      try {
        await invoke('save_document', { path })
        if (this.doc) {
          this.doc.title = path.split(/[\\/]/).pop().replace(/\.(fwd|rite)$/, '')
        }
        this.lastPath = path
        this.isModified = false
        this.saveState = 'saved'
        this.lastSavedAt = Date.now()
      } catch (e) {
        this.saveState = 'error'
        this.notifyError(e, 'Failed to save')
      }
    },

    async autosaveDocument() {
      if (!this.lastPath || !this.isModified) return
      this.saveState = 'saving'
      try {
        await invoke('autosave_document')
        this.isModified = false
        this.saveState = 'saved'
        this.lastSavedAt = Date.now()
      } catch (e) {
        this.saveState = 'error'
        this.notifyError(e, 'Auto-save failed')
      }
    },

    async syncToRust() {
      if (!this.doc || !this.isModified) return
      try {
        await invoke('sync_document', { data: this.doc })
      } catch (e) {
        this.notifyError(e, 'Failed to sync to Rust')
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

    /// Adopt a document returned by `restore_version` as the live doc. Unlike
    /// `setDoc` + `markModified`, this does NOT trigger a debounced sync back to
    /// Rust: the Rust AppState already holds the restored document (the command
    /// set it and journaled the old→restored history delta), so syncing would
    /// just rewrite identical state. We only flag modified so the StatusBar
    /// reflects that the .rite on disk is now stale until the next explicit
    /// save. The editor re-renders from the new `doc.sections` via its watcher.
    applyRestoredDocument(restoredDoc) {
      this.doc = restoredDoc
      this.isModified = true
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

    /// Update ONE section in place from the editor's localized DOM readback.
    /// The editor confines every keystroke edit to a single section (cross-
    /// section backspace/delete is blocked), so on the typing path it reads back
    /// only the cursor's section and emits the result here — mutating one
    /// section instead of replacing the whole `doc.sections` array. That keeps
    /// the pagination per-section cache and the word-count watcher touching only
    /// the edited section rather than churning the whole document per
    /// keystroke. `syncSections` (whole-array replace) is still used for
    /// array-level changes like `insertSection`.
    syncSection({ id, title, paragraphs }) {
      if (!this.doc) return
      const s = this.doc.sections.find(s => s.id === id)
      if (!s) return
      s.title = title
      s.paragraphs = paragraphs
      this.markModified()
    },

    toJSON() {
      return JSON.parse(JSON.stringify(this.doc))
    },
  },
})