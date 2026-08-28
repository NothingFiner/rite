// Version-history UI state and Tauri calls for the History drawer.
//
// The Rust backend (history.rs) stores snapshots + deltas in a sidecar and can
// reconstruct any past version by replaying deltas forward from the nearest
// snapshot. This composable is the frontend consumer: it lists versions,
// fetches a read-only preview of one, asks Rust to restore a version as the
// live document (undoable — the command journals an old→restored delta), and
// fetches a structural diff of a past version against the current live doc.
//
// Factory returning refs + methods, wrapped in `reactive()` by App.vue (the
// established pattern — see useNavigation/useSectionFormat). The `store`
// argument is the Pinia document store; restore adopts the returned Document
// via `store.applyRestoredDocument` (which sets the live doc without syncing
// back to Rust, since Rust already holds it).

import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/tauri'

export function useVersionHistory(store) {
  // `{ timestamp, kind, label }` from list_history, oldest first. `kind` is
  // "snapshot" or "delta"; `label` is currently always null (a future "name
  // this checkpoint" feature would populate it).
  const entries = ref([])
  // Stem of the currently-selected version, or null when the list view is shown.
  const selectedTimestamp = ref(null)
  // The reconstructed Document for the selected version (read-only preview,
  // and the left pane of the diff view).
  const previewDocument = ref(null)
  // Vec<SectionDiff> when a diff against current is shown, else null.
  const diffBlocks = ref(null)
  const loading = ref(false)
  const error = ref(null)

  /// Fetch every snapshot and delta in the open document's history sidecar.
  /// Called when the drawer opens and after a restore (to be safe — restore
  /// does not write a snapshot, so the list is unchanged, but re-fetching keeps
  /// the UI honest if the sidecar changed).
  async function loadHistory() {
    error.value = null
    try {
      entries.value = await invoke('list_history')
    } catch (e) {
      error.value = typeof e === 'string' ? e : String(e)
      entries.value = []
    }
  }

  /// Reconstruct the version at `timestamp` for a read-only preview. Clears any
  /// open diff so the drawer shows the preview, not a stale diff.
  async function selectVersion(timestamp) {
    loading.value = true
    error.value = null
    diffBlocks.value = null
    try {
      previewDocument.value = await invoke('reconstruct_version', { timestamp })
      selectedTimestamp.value = timestamp
    } catch (e) {
      error.value = typeof e === 'string' ? e : String(e)
      previewDocument.value = null
      selectedTimestamp.value = null
    } finally {
      loading.value = false
    }
  }

  /// Restore the version at `timestamp` as the live document. Non-destructive
  /// (the .rite on disk is untouched until the next explicit save) and undoable
  /// (Cmd+Z reverts — the Rust command journaled an old→restored history delta).
  /// The confirmation prompt is the caller's concern (the drawer's button
  /// handler), so this composable stays pure logic and testable without a
  /// window.confirm mock. Returns true on success, false on failure.
  async function restoreVersion(timestamp) {
    loading.value = true
    error.value = null
    try {
      const restored = await invoke('restore_version', { timestamp })
      store.applyRestoredDocument(restored)
      await loadHistory()
      clearPreview()
      return true
    } catch (e) {
      error.value = typeof e === 'string' ? e : String(e)
      return false
    } finally {
      loading.value = false
    }
  }

  /// Diff the version at `timestamp` (left/old) against the current live
  /// document (right/new). Ensures the preview for that timestamp is loaded so
  /// the left pane matches the diff's old side.
  async function diffAgainstCurrent(timestamp) {
    loading.value = true
    error.value = null
    try {
      if (selectedTimestamp.value !== timestamp || !previewDocument.value) {
        previewDocument.value = await invoke('reconstruct_version', { timestamp })
        selectedTimestamp.value = timestamp
      }
      diffBlocks.value = await invoke('diff_against_current', { timestamp })
    } catch (e) {
      error.value = typeof e === 'string' ? e : String(e)
      diffBlocks.value = null
    } finally {
      loading.value = false
    }
  }

  /// Reset selection/preview/diff — return the drawer to the version list.
  function clearPreview() {
    selectedTimestamp.value = null
    previewDocument.value = null
    diffBlocks.value = null
  }

  /// Drop the diff view but keep the selected preview (the "← Back" control
  /// from the diff to the preview).
  function clearDiff() {
    diffBlocks.value = null
  }

  return {
    entries,
    selectedTimestamp,
    previewDocument,
    diffBlocks,
    loading,
    error,
    loadHistory,
    selectVersion,
    restoreVersion,
    diffAgainstCurrent,
    clearPreview,
    clearDiff,
  }
}

/// Format a history timestamp stem into a friendly label. The stems are
/// fixed-width UTC `YYYY-MM-DDTHH-MM-SS-mmm` (lexicographically sortable), so
/// we present the date + minute portion as-is in UTC. Converting to local time
/// would make this timezone-dependent and the unit test flaky across machines;
/// the underlying timestamps are UTC and labeling them so is honest. Returns
/// the original string unchanged when it does not match the stem shape (a
/// defensive fallback rather than rendering garbage).
export function formatHistoryTimestamp(timestamp) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})$/.exec(timestamp || '')
  if (!match) return timestamp
  const [, year, month, day, hour, minute] = match
  return `${year}-${month}-${day} ${hour}:${minute}`
}