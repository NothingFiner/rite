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

// A word is a run of letters, optionally joined by inner apostrophes or
// hyphens ("don't", "well-known"); the `u` flag is what makes \p{L} work.
const WORD_PATTERN = /[\p{L}]+(?:['-][\p{L}]+)*/gu

// Punctuation that sticks to a word ("Happy," '"well-known."') — anything
// that is not a letter and not whitespace. Whitespace would widen the claim
// into a phrase, another letter into a second word; both belong to the
// native menu.
const STICKY_PUNCTUATION_PATTERN = /[^\p{L}\s]/u

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
  // No word (or a whitespace-only one) under the pointer: never ours to take,
  // whatever the selection reports.
  if (wordAtPoint == null || wordAtPoint.trim() === '') return null

  const selection = (selectionText ?? '').trim()
  // Collapsed caret / whitespace-only selection: the pointer word is ours.
  if (selection === '') return wordAtPoint

  // Several words selected means the writer is working with a phrase; only a
  // selection that matches the pointer word is a single-word selection.
  return selection === wordAtPoint.trim() ? wordAtPoint : null
}

/**
 * The whole word containing `offset` in `text`, as `{ word, start, end }`, or
 * null when that offset is not inside a word. A word is a run of letters,
 * optionally joined by inner apostrophes or hyphens ("don't", "well-known").
 */
export function wordAtOffset(text, offset) {
  if (text == null) return null

  // A fresh copy per call: a shared /g regex would carry lastIndex between
  // callers and silently skip matches.
  const wordPattern = new RegExp(WORD_PATTERN.source, WORD_PATTERN.flags)
  let match
  while ((match = wordPattern.exec(text)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (start <= offset && offset < end) {
      return { word: match[0], start, end }
    }
  }
  return null
}

/**
 * Split a document word into the parts a replacement must preserve:
 * `prefix` (leading non-letters, normally empty), `core` (the word itself) and
 * `suffix` (trailing non-letters — the comma in "Happy,").
 */
export function splitAffixes(word) {
  const text = word ?? ''
  let firstLetter = -1
  let lastLetter = -1
  for (let index = 0; index < text.length; index += 1) {
    if (/\p{L}/u.test(text[index])) {
      if (firstLetter === -1) firstLetter = index
      lastLetter = index
    }
  }
  // No letters at all: the core is empty, so the lookup simply errs — the
  // honest outcome for a word that was never a word.
  if (firstLetter === -1) return { prefix: '', core: '', suffix: text }
  return {
    prefix: text.slice(0, firstLetter),
    core: text.slice(firstLetter, lastLetter + 1),
    suffix: text.slice(lastLetter + 1),
  }
}

/**
 * Shape `replacement` like the word it replaces: leading capitalisation and
 * trailing punctuation come from the original. "Happy," + "glad" is "Glad,".
 */
export function shapeReplacement(replacement, affixes) {
  const text = replacement ?? ''
  const core = affixes?.core ?? ''
  const suffix = affixes?.suffix ?? ''
  // Only a lead-capital original makes a lead-capital replacement ("Happy" →
  // "Glad"); a lowered core keeps its case ("happy" → "glad").
  const capitalised =
    /^\p{Lu}/u.test(core) && text !== ''
      ? text.charAt(0).toUpperCase() + text.slice(1)
      : text
  return capitalised + suffix
}

/** Breathing room between the popover and the window edges. */
const POPOVER_GAP = 8

/**
 * Where the popover should sit for a click at `(x, y)`.
 *
 * The popover opens at the click point, but never at the window's expense: it
 * flips to the left of the click when it would cross the right edge, lifts
 * above the bottom edge the same way, and clamps into the window with `gap`
 * to spare at every edge. The component measures itself after render and
 * passes the numbers in, so this stays a pure function.
 */
export function placePopover({
  x,
  y,
  width,
  height,
  viewportWidth,
  viewportHeight,
  gap = POPOVER_GAP,
}) {
  // A window smaller than the popover cannot be satisfied by moving it, so
  // shrink the box we reason about to what the window can hold. The stylesheet
  // caps the real element at the same size (`max-width` / `max-height`).
  const boxWidth = Math.min(width, Math.max(0, viewportWidth - 2 * gap))
  const boxHeight = Math.min(height, Math.max(0, viewportHeight - 2 * gap))

  // Right edge: prefer flipping to the left of the click point (the popover
  // then grows towards the text the writer just clicked) over sliding away
  // from it. Either way it ends up inside the window.
  let left = x + boxWidth + gap > viewportWidth ? x - boxWidth : x
  left = Math.min(Math.max(left, gap), Math.max(gap, viewportWidth - boxWidth - gap))

  let top = y + boxHeight + gap > viewportHeight ? viewportHeight - boxHeight - gap : y
  top = Math.min(Math.max(top, gap), Math.max(gap, viewportHeight - boxHeight - gap))

  return { left, top }
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

  // The text-node slice the takeover claimed. Composable-local so two hosts
  // do not share a capture; needed later by openCurrent (to display with its
  // punctuation) and apply (to write the replacement in place).
  let captured = null

  // Widen the claimed letter run over punctuation glued to it ("Happy" +
  // "," is the slice "Happy,") — never over whitespace, and never into the
  // words or letters on either side.
  function stuckOnPunctuation(character) {
    return STICKY_PUNCTUATION_PATTERN.test(character)
  }

  function extendOverStuckPunctuation(text, start, end) {
    while (start > 0 && stuckOnPunctuation(text[start - 1])) start -= 1
    while (end < text.length && stuckOnPunctuation(text[end])) end += 1
    return { start, end }
  }

  function onContextMenu(event) {
    if (typeof document.caretRangeFromPoint !== 'function') return
    const range = document.caretRangeFromPoint(event.clientX, event.clientY)
    // Pointer over chrome or a non-text node: the native menu survives.
    if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return

    const textNode = range.startContainer
    // Only the editor sheet is ours. A right-click on a chapter title in the
    // drawer, in the assistant panel or on the status bar is not a thesaurus
    // request, so the native menu stays there too.
    if (!textNode.parentElement?.closest('.editor-sheet')) return

    const hit = wordAtOffset(textNode.textContent, range.startOffset)
    if (!hit) return

    const ownedWord = takeOverWord(window.getSelection()?.toString() ?? '', hit.word)
    // Multi-word selection or no word: keep the native menu (copy, spellcheck
    // live there), so no preventDefault here.
    if (!ownedWord) return

    event.preventDefault()
    const extended = extendOverStuckPunctuation(textNode.textContent, hit.start, hit.end)
    captured = { node: textNode, start: extended.start, end: extended.end }
    state.x = event.clientX
    state.y = event.clientY
    // Exactly the two keys the Rust side reads. A rejected menu request is
    // unmodelled (unit mocks resolve null) and leaves the document untouched,
    // so per the brief it is ignored on purpose.
    invoke('show_word_menu', { x: event.clientX, y: event.clientY }).catch(() => {})
  }

  function openCurrent() {
    // Only a takeover claims a lookup; the menu event alone means nothing.
    if (!captured) return

    state.word = captured.node.textContent.slice(captured.start, captured.end)
    state.open = true
    state.senses = []
    state.error = ''
    state.loading = true

    // The lookup asks for the core only ("well-known", not '"well-known."');
    // WordEntry arrives camelCase from Rust's serde.
    invoke('thesaurus_lookup', { word: splitAffixes(state.word).core })
      .then((entry) => {
        state.senses = entry?.senses ?? []
      })
      .catch((reason) => {
        // The popover stays open; the component owns the error line, and the
        // writer is shown what failed.
        state.error = reason?.message ?? String(reason)
      })
      .finally(() => {
        state.loading = false
      })
  }

  function apply(replacement) {
    // Nothing taken over: nothing to write into, and close never writes.
    if (!captured) return
    const { node, start, end } = captured
    captured = null

    // The word's node may have gone since the takeover (the sheet was
    // replaced); then the replacement has nowhere to land, so just close.
    if (!node.parentElement || !document.contains(node)) {
      close()
      return
    }

    const text = node.textContent ?? ''
    const boundedStart = Math.min(start, text.length)
    const boundedEnd = Math.min(end, text.length)
    node.textContent = text.slice(0, boundedStart) + replacement + text.slice(boundedEnd)

    // The same event a keystroke fires, so the existing readback
    // (editorDisplay.onInput → syncFromDOM → App → store) notices the edit.
    // `closest` exists on elements only, and the captured node is a text node,
    // so walk up through its parent.
    const sheet = node.parentElement?.closest('.editor-sheet')
    if (sheet) sheet.dispatchEvent(new Event('input', { bubbles: true }))

    close()
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
