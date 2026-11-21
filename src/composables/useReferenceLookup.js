// The reference lookup chooser (SPEC.md revision 5, S-105/S-106).
//
// The chooser owns no capture and no matcher. The word-menu takeover in
// useThesaurus.js claims the contextmenu event and hands Rust the word. This
// composable reads that capture through `currentCapture` on the
// `look_up_reference` menu event, then asks Rust for the matches under the
// same rule `show_word_menu` offers the item with.
//
// Nothing is stored: choosing a match only moves the shell to References.
// The manuscript text is untouched (the lookup writes nothing at all).

import { reactive } from 'vue'
import { invoke } from '@tauri-apps/api/core'

/**
 * Owns the chooser's state. Returns `{ state, open, close }`.
 *
 * `open(capture)` reads `{ word, x, y }` from `useThesaurus.currentCapture`,
 * invokes `reference_matches_for_word` and fills `matches`. A failed invoke
 * keeps the chooser open with the reason in `state.error`. `close` only
 * closes. A menu event with no capture behind it is a no-op. The menu offers
 * the item only after a takeover, so an event without one means nothing.
 */
export function useReferenceLookup() {
  const state = reactive({
    open: false,
    word: '',
    matches: [],
    loading: false,
    error: '',
    x: 0,
    y: 0,
  })

  function open(capture) {
    if (!capture || capture.word === '') return

    state.open = true
    state.word = capture.word
    state.x = capture.x
    state.y = capture.y
    state.matches = []
    state.error = ''
    state.loading = true

    // Matches arrive camelCase from Rust's serde on `ReferenceMatch`.
    invoke('reference_matches_for_word', { word: capture.word })
      .then((matches) => {
        state.matches = Array.isArray(matches) ? matches : []
      })
      .catch((reason) => {
        // The chooser stays open. The component owns the error line, and the
        // writer is shown what failed.
        state.error = reason?.message ?? String(reason)
      })
      .finally(() => {
        state.loading = false
      })
  }

  function close() {
    state.open = false
  }

  return { state, open, close }
}
