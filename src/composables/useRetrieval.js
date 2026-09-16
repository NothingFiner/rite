// Background manuscript indexing for RAG retrieval (Phase 4.3).
//
// Keeps the in-memory vector store current as the manuscript changes, so 4.4's
// retrieval can rank passages against fresh vectors. The store itself lives in
// Rust (`AppState::vectors` + `section_hashes`); this composable is the JS
// trigger + the status readout that makes 4.3 observable before 4.4 wires
// retrieval into the chat.
//
// It watches the document store's cheap `docVersion` counter (bumped wherever
// the doc changes AND Rust's copy is current — see `stores/document.js`) with a
// 1500ms debounce, just past the 1000ms typing-sync debounce + its round-trip.
// So for a typing burst the `sync_document` round-trip lands first and the
// re-embed diffs against the synced state; for undo/redo/open/restore, Rust is
// already current (those paths mutate `AppState.document` directly), so the same
// debounce fires correctly there too. Each bump resets the timer, so the last
// edit wins — matching Rust's own "last trigger wins" AtomicBool guard.
//
// Opt-in: nothing fires while `embeddingsEnabled` is false (a writer without a
// local Ollama isn't peppered with failing embedding calls). Toggling it on
// triggers an immediate full build; toggling off cancels any pending re-embed
// and returns the readout to 'idle'. The embeddings endpoint/key/model are
// passed per call into the Rust command and never held in Rust state — same
// boundary as chat/embed (keeps the key out of the webview's inspectable fetch
// headers, the proxy's reason for existing).
//
// Factory returning refs + methods, wrapped in `reactive()` by App.vue (the
// established pattern — see useChat/useNavigation). Needs the document store
// (for `docVersion`) and the RAW llm-settings composable (reads
// `settings.value.*`, like useChat — NOT the reactive-wrapped one).

import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/tauri'

/// Debounce for the docVersion watcher. Just longer than the 1000ms typing-sync
/// debounce + its round-trip, so a typing burst syncs to Rust before the
/// re-embed re-diffs. Cheap to watch: a scalar counter, no doc traversal.
const REEMBED_DEBOUNCE_MS = 1500

export function useRetrieval(store, llmSettings) {
  /// Index status for the drawer readout:
  /// - 'idle'     — indexing off, or never run yet.
  /// - 'indexing' — a `reembed_document` call is in flight.
  /// - 'ready'    — the last call succeeded; the store is current.
  /// - 'error'    — the last call failed (e.g. Ollama not running / model not pulled).
  const reembedStatus = ref('idle')
  /// The last `ReembedReport` from Rust (`builtFromScratch` / `sectionsEmbedded`
  /// / `chunksEmbedded` / `chunksTotal`). Null until the first successful call;
  /// the drawer renders "Index: N chunks · M sections · up to date" from it.
  const reembedReport = ref(null)
  /// The error string when `reembedStatus` is 'error'; cleared on the next
  /// attempt so a successful re-embed doesn't keep showing a stale error.
  const reembedError = ref('')

  /// Fire one `reembed_document` pass against the current Rust document. No-op
  /// when indexing is disabled or no embeddings model is configured, so the
  /// docVersion watcher can call this unconditionally and the guard keeps it
  /// cheap. Reads the embeddings triple (separate from chat) per call; an empty
  /// key is sent as `null` so Rust deserializes `Option<String>` = `None`
  /// (local Ollama needs no Authorization header).
  async function reembedNow() {
    const settings = llmSettings.settings.value
    if (!settings.embeddingsEnabled || !settings.embeddingsModel) return
    reembedStatus.value = 'indexing'
    reembedError.value = ''
    try {
      const report = await invoke('reembed_document', {
        endpoint: settings.embeddingsEndpoint,
        apiKey: settings.embeddingsApiKey || null,
        model: settings.embeddingsModel,
      })
      reembedReport.value = report
      reembedStatus.value = 'ready'
    } catch (e) {
      reembedError.value = typeof e === 'string' ? e : (e?.message || String(e))
      reembedStatus.value = 'error'
    }
  }

  /// Debounced docVersion watcher. Every doc change bumps `docVersion`; we
  /// collapse a burst of edits into one re-embed, fired REEMBED_DEBOUNCE_MS
  /// after the last bump. The guard inside `reembedNow` makes this a no-op while
  /// indexing is off, so the timer is harmless when disabled.
  let pendingTimer = null
  watch(
    () => store.docVersion,
    () => {
      if (pendingTimer) clearTimeout(pendingTimer)
      pendingTimer = setTimeout(() => {
        pendingTimer = null
        reembedNow()
      }, REEMBED_DEBOUNCE_MS)
    },
  )

  /// Toggling the index on triggers an immediate full build (the store is empty
  /// / stale while off). Toggling off cancels any pending re-embed (clearing the
  /// debounce timer so a just-armed build doesn't fire after the user opted out)
  /// and returns the readout to 'idle'. Non-immediate: Vue's `watch` only fires
  /// on change, so an app start with the setting already on does NOT build here
  /// — the first real doc change (open/create/edit) bumps `docVersion` and does.
  watch(
    () => llmSettings.settings.value.embeddingsEnabled,
    (enabled) => {
      if (enabled) {
        reembedNow()
      } else {
        if (pendingTimer) {
          clearTimeout(pendingTimer)
          pendingTimer = null
        }
        reembedStatus.value = 'idle'
      }
    },
  )

  return {
    reembedStatus,
    reembedReport,
    reembedError,
    reembedNow,
  }
}