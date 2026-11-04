// Thesaurus popover state and the selective context-menu takeover (roadmap
// 5.11, SPEC.md S-014 … S-021).
//
// Why the takeover is selective: the webview's own right-click menu is worth
// keeping. Copy works on a phrase selection, and WKWebView offers Learn /
// Ignore / Unlearn Spelling on a squiggled word. The app only claims the
// contextmenu event when the pointer is over exactly one word, so everything
// else keeps the native menu.
//
// Nothing is applied by hovering or by a single click. Marking a synonym only
// marks it; the document changes on OK and on nothing else.

import { reactive, onMounted, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'

/**
 * The word the app should take the context menu for.
 *
 * `selectionText` is `window.getSelection().toString()` at the click and
 * `wordAtPoint` is the word under the pointer, or null when the pointer is not
 * over a word. A collapsed caret inside a word reports an empty selection; a
 * selection of exactly that word reports the word itself. A selection of
 * several words belongs to the native menu, so this returns null.
 */
export function takeOverWord(selectionText, wordAtPoint) {
  // TODO(5.11): decide takeover (SPEC S-014 … S-017). The stub reports "a word
  // was hit" for every click so each rule below fails on its own assertion
  // instead of the whole suite failing on a null dereference.
  return ''
}

/**
 * The whole word containing `offset` in `text`, as `{ word, start, end }`, or
 * null when that offset is not inside a word. A word is a run of letters,
 * optionally joined by inner apostrophes or hyphens ("don't", "well-known").
 */
export function wordAtOffset(text, offset) {
  // TODO(5.11): locate the word under the caret (SPEC S-014, S-017).
  return null
}

/**
 * Split a document word into the parts a replacement must preserve:
 * `prefix` (leading non-letters, normally empty), `core` (the word itself) and
 * `suffix` (trailing non-letters — the comma in "Happy,").
 */
export function splitAffixes(word) {
  // TODO(5.11): split leading/trailing punctuation off the word (SPEC S-019).
  return null
}

/**
 * Shape `replacement` like the word it replaces: leading capitalisation and
 * trailing punctuation come from the original. "Happy," + "glad" is "Glad,".
 */
export function shapeReplacement(replacement, affixes) {
  // TODO(5.11): re-apply the original's shape (SPEC S-020, S-021).
  return ''
}

/**
 * Owns the popover's state and the document-level contextmenu listener.
 *
 * Returns `{ state, openCurrent, apply, close }`; see SPEC.md for the field
 * list. `openCurrent` runs on the `thesaurus` menu event, `apply` writes the
 * replacement into the sheet and closes, `close` only closes.
 */
export function useThesaurus() {
  const state = reactive({
    open: false,
    word: '',
    senses: [],
    loading: false,
    error: '',
    x: 0,
    y: 0,
  })

  function onContextMenu(event) {
    // TODO(5.11): takeover decision, then ask Rust for the word menu.
  }

  function openCurrent() {
    // TODO(5.11): look the captured word up and show the popover.
  }

  function apply(replacement) {
    // TODO(5.11): write the replacement into the editor sheet, then close.
  }

  function close() {
    state.open = false
  }

  onMounted(() => {
    document.addEventListener('contextmenu', onContextMenu, true)
  })
  onUnmounted(() => {
    document.removeEventListener('contextmenu', onContextMenu, true)
  })

  return { state, openCurrent, apply, close }
}
