// Semantic-summary generation for the "Summaries" Feedback Target (Phase 4.8).
//
// 4.8's Rust layer (`summary.rs`) generates one neutral recap per section and
// stores it in the durable sidecar; `useChat` reads them back (free, no network)
// to inject as context. This composable is the JS trigger + status readout that
// makes generation observable: "Generate summaries" loops every section, and
// "Refresh stale" re-summarizes only the sections whose text changed since their
// recap was made. Mirrors `useRetrieval` (the 4.3 embeddings trigger), but:
//
// - Generation is USER-TRIGGERED, not debounced-on-edit. Re-embedding on every
//   edit keeps retrieval fresh; re-summarizing on every edit would burn tokens
//   for recaps the writer hasn't asked to update. So there is no docVersion
//   watcher that generates — only a lightweight one that refreshes the STATUS
//   readout (the "K stale" count) so the writer can see when recaps drift.
// - Generation uses the CHAT triple (endpoint/apiKey/model — text generation),
//   NOT the embeddings triple. Each section is one non-streaming `llm_chat` call
//   (no `llm-token` event → no cross-talk with a concurrent chat stream).
// - The endpoint/key/model are passed per call into the Rust command and never
//   held in Rust state — same boundary as chat/embed (keeps the key out of the
//   webview's inspectable fetch headers, the proxy's reason for existing).
//
// Factory returning refs + methods, wrapped in `reactive()` by App.vue (the
// established pattern — see useRetrieval/useChat). Needs the document store
// (for `doc.sections` + `docVersion`) and the RAW llm-settings composable (reads
// `settings.value.*`, like useChat — NOT the reactive-wrapped one).

import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/tauri'

/// Debounce for the docVersion status-refresh watcher. Matches `useRetrieval`'s
/// re-embed debounce so the "K stale" readout settles at the same point the
/// vector index would — just past the 1000ms typing-sync debounce + its
/// round-trip. Cheap: a scalar watch + one pure-Rust read, no generation.
const STATUS_REFRESH_DEBOUNCE_MS = 1500

export function useSummaries(store, llmSettings) {
  /// Generation status for the drawer readout:
  /// - 'idle'       — never generated, or reset.
  /// - 'generating' — a `summarize_and_store_section` loop is in flight.
  /// - 'ready'      — the last generation succeeded; recaps are current.
  /// - 'error'      — the last generation failed (e.g. Ollama not running, a
  ///                  section call rejected). `summaryError` carries the detail.
  const summaryStatus = ref('idle')
  /// Progress for the readout: `{ done, total, stale }`.
  /// - `total`  — the document's section count (the denominator: "N/M").
  /// - `done`   — how many sections have a stored summary (the numerator).
  /// - `stale`  — how many stored summaries no longer match their section's text
  ///   (the writer edited the section after generating its recap).
  /// Populated by `refreshSummaryStatus` (a pure-Rust read) after each
  /// generation/refresh and on a debounced docVersion change.
  const summaryProgress = ref({ done: 0, total: 0, stale: 0 })
  /// The error string when `summaryStatus` is 'error'; cleared on the next
  /// attempt. Names which section failed during a loop so the writer can find it.
  const summaryError = ref('')
  /// True while generation is in flight. OR'd into the LLM panel's busy gate by
  /// App.vue (`:busy="chatManager.anyBusy || summaries.summariesBusy"`) so Send
  /// is disabled during generation — not a stream-cross-talk issue (summaries
  /// are non-streaming), just local-Ollama resource contention + UX clarity.
  const summariesBusy = ref(false)

  /// Re-query the store for the readout counts. A pure-Rust read of the
  /// sidecar-backed summaries (no network) via `retrieve_summaries`, which
  /// returns each summarized section with a `stale` flag. On an empty store
  /// (no summaries generated yet) `retrieve_summaries` returns an error — that
  /// is the EXPECTED "nothing here yet" state, not a user-facing failure, so it
  /// is swallowed silently (progress resets to 0/0) rather than surfaced in
  /// `summaryError`. `total` is the live document's section count.
  async function refreshSummaryStatus() {
    const total = store.doc?.sections?.length || 0
    try {
      const entries = await invoke('retrieve_summaries', {})
      summaryProgress.value = {
        done: entries.length,
        total,
        stale: entries.filter((entry) => entry.stale).length,
      }
    } catch {
      // Empty store, or a (near-impossible) poisoned lock — either way the
      // readout shows 0/0. Not a generation error, so no `summaryError`.
      summaryProgress.value = { done: 0, total, stale: 0 }
    }
  }

  /// Generate a summary for one section and update progress. Returns true on
  /// success, false on failure (with `summaryError` + `summaryStatus` set).
  /// Uses the CHAT triple (text generation). An empty key is sent as `null` so
  /// Rust deserializes `Option<String>` = `None` (local Ollama needs no
  /// Authorization header). The command stores the summary + checkpoints the
  /// sidecar, so progress survives a mid-loop crash.
  async function summarizeOne(section) {
    const settings = llmSettings.settings.value
    try {
      await invoke('summarize_and_store_section', {
        sectionId: section.id,
        endpoint: settings.endpoint,
        apiKey: settings.apiKey || null,
        model: settings.model,
      })
      return true
    } catch (e) {
      summaryError.value =
        `Failed to summarize "${section.title || 'Untitled'}": ` +
        (typeof e === 'string' ? e : (e?.message || String(e)))
      summaryStatus.value = 'error'
      return false
    }
  }

  /// Generate (or re-generate) a summary for every section in the document.
  /// Loops the document's sections in order, one non-streaming LLM call each,
  /// updating `summaryProgress.done` as it goes so the readout advances. On the
  /// first section failure, stops the loop (a mid-loop error leaves the
  /// already-generated summaries in place + checkpointed; the writer fixes setup
  /// and reruns). On success, refreshes the status so the stale count is
  /// accurate, then sets `summaryStatus='ready'`.
  async function generateSummaries() {
    const sections = store.doc?.sections || []
    if (sections.length === 0) return
    if (summariesBusy.value) return
    summariesBusy.value = true
    summaryStatus.value = 'generating'
    summaryError.value = ''
    summaryProgress.value = { done: 0, total: sections.length, stale: 0 }
    for (const section of sections) {
      const ok = await summarizeOne(section)
      if (!ok) {
        summariesBusy.value = false
        return
      }
      summaryProgress.value = {
        ...summaryProgress.value,
        done: summaryProgress.value.done + 1,
      }
    }
    summaryStatus.value = 'ready'
    summariesBusy.value = false
    await refreshSummaryStatus()
  }

  /// Re-summarize only the sections whose stored summary is stale (the section's
  /// text changed since its recap was generated) or missing (a new section never
  /// summarized). Asks Rust for the stale set via `retrieve_stale_summary_section_ids`
  /// (the staleness rule lives in one tested place — `plan_resummarize`), then
  /// loops just those sections. If nothing is stale, refreshes the status (so
  /// the readout is current) and returns — no token spend.
  async function refreshStaleSummaries() {
    if (summariesBusy.value) return
    let staleIds
    try {
      staleIds = await invoke('retrieve_stale_summary_section_ids', {})
    } catch (e) {
      summaryError.value = typeof e === 'string' ? e : (e?.message || String(e))
      summaryStatus.value = 'error'
      return
    }
    if (staleIds.length === 0) {
      // Nothing stale — refresh the readout (summaries may have been generated
      // in a prior session and loaded from the sidecar) and report ready.
      await refreshSummaryStatus()
      summaryStatus.value = 'ready'
      return
    }
    const sections = store.doc?.sections || []
    const staleSections = sections.filter((section) => staleIds.includes(section.id))
    summariesBusy.value = true
    summaryStatus.value = 'generating'
    summaryError.value = ''
    for (const section of staleSections) {
      const ok = await summarizeOne(section)
      if (!ok) {
        summariesBusy.value = false
        return
      }
    }
    summaryStatus.value = 'ready'
    summariesBusy.value = false
    await refreshSummaryStatus()
  }

  /// Lightweight docVersion watcher — refreshes the STATUS readout (the "K
  /// stale" count) as the writer edits, so recaps that drift behind their
  /// sections are visible without the writer re-opening the drawer. Does NOT
  /// generate (generation is user-triggered; see the module header). Collapses a
  /// burst of edits into one read, STATUS_REFRESH_DEBOUNCE_MS after the last
  /// bump. The read swallows the empty-store case, so this is harmless when no
  /// summaries exist yet (a cheap invoke that resets to 0/0).
  let pendingTimer = null
  watch(
    () => store.docVersion,
    () => {
      if (pendingTimer) clearTimeout(pendingTimer)
      pendingTimer = setTimeout(() => {
        pendingTimer = null
        refreshSummaryStatus()
      }, STATUS_REFRESH_DEBOUNCE_MS)
    },
  )

  return {
    summaryStatus,
    summaryProgress,
    summaryError,
    summariesBusy,
    generateSummaries,
    refreshStaleSummaries,
    refreshSummaryStatus,
  }
}