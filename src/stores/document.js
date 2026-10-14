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
    // A cheap monotonic counter bumped whenever the document changes AND Rust's
    // copy is/became current — i.e. at every point the in-memory vector store
    // (Phase 4.3) would need to re-diff. `useRetrieval` watches this scalar
    // (debounced 1500ms) instead of deep-watching the whole `doc`: same trigger
    // coverage, no per-edit traversal of a large manuscript. Bumped at:
    // `syncToRust` (typing / new / import — after the sync lands), `undo`,
    // `redo`, `loadDocument`, and `applyRestoredDocument` (the restore path
    // skips syncToRust because Rust is already current there). NOT bumped on a
    // failed sync: Rust wouldn't have the new doc, so re-embedding would index
    // stale state.
    docVersion: 0,
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
        // A different document was installed in Rust by `open_document`; bump
        // so `useRetrieval` triggers a full re-build of the index (the old
        // vectors belong to the previous manuscript).
        this.docVersion++
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
        // Flush pending typing BEFORE invoking (same rationale as undo): the
        // command returns Rust's doc, and assigning that back would discard
        // ≤1s of un-synced edits. Harmless when nothing is pending.
        await this.syncToRust()
        const updated = await invoke('delete_section', { id })
        this.doc = updated
        this.isModified = true
      } catch (e) {
        this.notifyError(e, 'Failed to delete section')
      }
    },

    async renameSection(id, title) {
      try {
        // Same flush-before-invoke rationale as deleteSection.
        await this.syncToRust()
        const updated = await invoke('rename_section', { id, title })
        this.doc = updated
        this.isModified = true
      } catch (e) {
        this.notifyError(e, 'Failed to rename section')
      }
    },

    async changeSectionType(id, newType) {
      try {
        // Same flush-before-invoke rationale as deleteSection.
        await this.syncToRust()
        const updated = await invoke('change_section_type', { id, newType })
        this.doc = updated
        this.isModified = true
      } catch (e) {
        this.notifyError(e, 'Failed to change section type')
      }
    },

    async setSectionHidden(id, hidden) {
      try {
        // Same flush-before-invoke rationale as deleteSection: the command
        // returns Rust's doc, so a pending typing batch must land in Rust first
        // or this assignment would silently discard it.
        await this.syncToRust()
        const updated = await invoke('set_section_hidden', { id, hidden })
        this.doc = updated
        this.isModified = true
      } catch (e) {
        this.notifyError(e, 'Failed to hide/unhide section')
      }
    },

    async moveSection(id, toAfterId) {
      try {
        // Same flush-before-invoke rationale as undo/redo: move_section
        // operates on Rust's doc and returns it; assigning that back without
        // flushing would silently discard ≤1s of un-synced edits.
        await this.syncToRust()
        // Tauri v1 maps toAfterId → to_after_id; null maps to None = front.
        const updated = await invoke('move_section', { id, toAfterId })
        this.doc = updated
        this.isModified = true
      } catch (e) {
        this.notifyError(e, 'Failed to move section')
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
        this.docVersion++
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
        this.docVersion++
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
        // Rust now holds the edited doc; bump so `useRetrieval` re-diffs the
        // index against it. Inside the try so a failed sync does NOT bump
        // (Rust wouldn't have the new state).
        this.docVersion++
      } catch (e) {
        this.notifyError(e, 'Failed to sync to Rust')
      }
    },

    debouncedSync() {
      if (this.syncTimeout) clearTimeout(this.syncTimeout)
      this.syncTimeout = setTimeout(() => this.syncToRust(), 1000)
    },

    /// Flush a PENDING debounced sync to Rust immediately, awaiting its
    /// completion. Unlike `undo`/`redo` (which `await this.syncToRust()`
    /// directly), this first checks for a pending timeout: if the debounce has
    /// already fired the doc is already in Rust and this is a no-op, so a caller
    /// that runs per-keystroke (the search panel's `performSearch`) doesn't
    /// re-ship an unchanged doc on every Find keystroke. The search path needs
    /// this because `search_document` reads Rust's `state.document`, which lags
    /// the live editor by up to the 1000ms debounce — without a flush, typing
    /// text and opening Find within that window searches an empty/stale Rust
    /// doc and returns zero matches (no highlights, nothing to navigate),
    /// even though the word count (JS-side) already reflects the edit.
    async flushSync() {
      if (this.syncTimeout) {
        clearTimeout(this.syncTimeout)
        this.syncTimeout = null
        await this.syncToRust()
      }
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

    /// Start a brand-new document with a chosen name. The name becomes the
    /// document title and the default filename on the first Save (the Save
    /// dialog seeds itself from `doc.title`, so prompting for a name up front
    /// closes the old pre-first-save "untitled / no path" window). Mirrors
    /// `importFile`'s setDoc → markModified → syncToRust shape: we clear any
    /// pending debounced sync, install the fresh doc, then push it to Rust so
    /// the Rust AppState holds the new document (subsequent edits/undo sync
    /// against it, not the previous doc).
    ///
    /// Frontend-only by design (Phase 1.8): `sync_document` journals a delta
    /// from the previous doc to this one, so the version history still holds
    /// the prior document's entries and one undo reverts to it — the same
    /// characteristic import has. A true clean-slate history would need a
    /// Rust-side `new_document` command that also clears AppState history; that
    /// is deliberately deferred.
    async newDocument(title) {
      const doc = {
        title: (title || '').trim() || 'Untitled',
        author: '',
        authorContact: '',
        hasTOC: false,
        sections: [createSection()],
      }
      if (this.syncTimeout) clearTimeout(this.syncTimeout)
      this.doc = doc
      this.lastPath = null
      this.isModified = true
      // A never-saved doc has no save state to advertise yet.
      this.saveState = 'idle'
      this.lastSavedAt = null
      await this.syncToRust()
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
      // Rust already holds the restored doc (the command set it); bump so the
      // index re-builds against the restored manuscript.
      this.docVersion++
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
    syncSection({ id, title, sectionType, hidden, paragraphs }) {
      if (!this.doc) return
      const s = this.doc.sections.find(s => s.id === id)
      if (!s) return
      s.title = title
      // sectionType/hidden ride the localized readback for completeness — a
      // typing edit can't actually change either (locked titles block input;
      // hidden lives on the same locked surface), but writing them back keeps
      // the DOM and model from ever disagreeing about a section's shape.
      if (sectionType) s.sectionType = sectionType
      if (typeof hidden === 'boolean') s.hidden = hidden
      s.paragraphs = paragraphs
      this.markModified()
    },

    toJSON() {
      return JSON.parse(JSON.stringify(this.doc))
    },
  },
})