import { ref, watch, onUnmounted } from 'vue'

/// Debounced whole-document word count.
///
/// A live `computed` over every paragraph's text re-runs O(document) on every
/// keystroke — each `syncSection` mutation invalidates it — which hitched the
/// main thread while typing at scale (51k words). A deep watcher on `sections`
/// is O(1) per notification: Vue's deep watches hand the same reactive
/// reference as both oldValue and newValue, so there is no per-trigger clone.
/// The O(document) tally then runs once, `DEBOUNCE_MS` after typing stops. The
/// count lagging a fraction of a second is invisible; the typing smoothness is
/// not. (Same reasoning as the pagination watch's debounce.)
///
/// Shared by the editor status bar (`App.vue`) and the manuscript title page
/// (`manuscriptDisplay.vue`) so the two cannot drift — the divergence risk that
/// once bit word-count. In the read-only manuscript view the debounce is moot
/// (there is no keystroke stream), so a single debounced implementation is
/// correct for both consumers.
const DEBOUNCE_MS = 300

export function useWordCount(docRef) {
  const wordCount = ref(0)
  let timer = null

  function recompute() {
    const doc = docRef?.value ?? docRef
    if (!doc || !doc.sections) {
      wordCount.value = 0
      return
    }
    let count = 0
    for (const section of doc.sections) {
      for (const paragraph of section.paragraphs || []) {
        for (const element of paragraph.elements || []) {
          const text = element.textRun?.content || ''
          if (text.trim()) count += text.trim().split(/\s+/).length
        }
      }
    }
    wordCount.value = count
  }

  // Compute the initial count SYNCHRONOUSLY at setup so the first paint shows
  // the real number, not 0 — there is no keystroke stream to coalesce on the
  // very first run, so the debounce's whole purpose (avoiding an O(document)
  // re-tally per keystroke) doesn't apply. One O(document) pass on load is
  // fine; SUBSEQUENT changes (typing bursts) are then debounced as below.
  recompute()

  watch(
    () => docRef?.value?.sections,
    () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(recompute, DEBOUNCE_MS)
    },
    { deep: true },
  )

  onUnmounted(() => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  })

  return { wordCount, recompute }
}