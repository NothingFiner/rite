import { onMounted, onUnmounted } from 'vue'

// Focusable controls, in document order.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), ' +
  '[tabindex]:not([tabindex="-1"])'

/**
 * Hand focus to the first focusable control after `el`, wrapping to the start of
 * the document when `el` is last. `focus()` silently no-ops on a hidden
 * candidate, so each one is verified; if none takes, `el` is blurred.
 */
function focusAfter(el) {
  const candidates = Array.from(document.querySelectorAll(FOCUSABLE))
    .filter(candidate => !el.contains(candidate))
  const following = candidates.filter(candidate =>
    el.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING)
  for (const candidate of following.length ? following : candidates) {
    candidate.focus()
    if (document.activeElement === candidate) return
  }
  el.blur()
}

/**
 * Centralised keyboard-shortcut handling for the app shell.
 *
 * Takes the pieces of state it needs to act on (store, the format and
 * search composables, the editor ref, the drawer refs, and an insert-heading
 * callback) and wires its own `keydown` + `selectionchange` listeners on
 * `document` for the host component's lifetime. Keeping this out of App.vue's
 * setup body lets App.vue be about layout/wiring rather than key mapping, and
 * makes every shortcut's effect a call on an injected dependency — no hidden
 * DOM reach-through. One exception: the Escape fall-through reads the active
 * view's `$el`, because moving focus past the sheet is a DOM operation.
 *
 * Page/line navigation delegates to methods exposed by the editor
 * (`editorRef.value?.selectLine` / `navigatePage` / `navigateSectionPage`)
 * rather than the parent reaching into the editor's private DOM.
 *
 * Refs are passed in as refs; the composable reads `.value` itself.
 */
export function useKeyboardShortcuts({
  store,
  format,
  search,
  // Optional-chained at every use (`themePicker?.`): App.vue wires it, but
  // unit-test mocks and pre-wiring hosts do not, and an absent picker simply
  // skips its Escape branch.
  themePicker,
  viewMode,
  leftDrawerOpen,
  leftDrawerMode,
  addExpanded,
  editorRef,
  onInsertSection,
  // Optional-chained, like the picker: App.vue wires focus mode, the mocks may
  // omit parts of it, and an absent one means none of its behaviour applies.
  focusMode,
  // Returns focus to the drawer's opener button (S-017). Optional-chained: the
  // mocks pass no opener, and then the close happens with no focus return.
  focusDrawerOpener,
}) {
  function onKeydown(e) {
    const cmd = e.metaKey || e.ctrlKey

    // The native menu owns Save, Save As, Undo and Redo (src-tauri/src/menu.rs).
    // Handling those here too would fire each twice, and a double undo is silent
    // data loss. Cmd/Ctrl+Y has no menu item, so it stays as a second redo
    // spelling (S-021).
    if (cmd && e.key === 'y') {
      e.preventDefault()
      store.redo()
      return
    }

    if (cmd && viewMode.value === 'editor') {
      if (e.key === 'b') {
        e.preventDefault()
        format.toggleFormat('bold')
        return
      }
      if (e.key === 'i') {
        e.preventDefault()
        format.toggleFormat('italic')
        return
      }
      if (e.key === 'u') {
        e.preventDefault()
        format.toggleFormat('underline')
        return
      }
      if (e.key === 'l') {
        e.preventDefault()
        editorRef.value?.selectLine?.()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        editorRef.value?.navigatePage?.(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        editorRef.value?.navigatePage?.(-1)
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        editorRef.value?.navigateSectionPage?.(1)
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        editorRef.value?.navigateSectionPage?.(-1)
        return
      }
    }

    // Checked BEFORE the plain `f` search branch: with Shift held `e.key` may
    // arrive as 'F', which the search branch would miss, and a layout that
    // reports lowercase 'f' would otherwise fall through into it. Editor view
    // only (S-004).
    if (cmd && e.shiftKey && e.key.toLowerCase() === 'f') {
      if (viewMode.value !== 'editor') return
      e.preventDefault()
      focusMode.toggle()
      return
    }

    if (cmd && e.key === 'f') {
      e.preventDefault()
      if (search.searchVisible) {
        search.closeSearch()
      } else {
        search.openSearch()
      }
      return
    }
    if (e.key === 'Escape') {
      if (search.searchVisible) {
        e.preventDefault()
        search.closeSearch()
        return
      }
      // The picker closes before any drawer (chain order, SPEC 5.7): the most
      // recently opened popup wins, so Escape over a tooltip never reaches the
      // drawer.
      if (themePicker?.open?.value) {
        e.preventDefault()
        themePicker.close()
        return
      }
      if (leftDrawerOpen.value) {
        e.preventDefault()
        // Read focus BEFORE the close: escape pressed elsewhere closes the
        // drawer without stealing focus (S-017).
        const focusInDrawer = document.activeElement?.closest?.('.drawer') != null
        leftDrawerOpen.value = false
        if (focusInDrawer) focusDrawerOpener?.()
        return
      }
      // Escape chain (S-007): search → theme picker → drawer → focus mode →
      // editor. One press does one thing, so each branch returns. With no
      // chrome open, focus leaves the sheet so the captured Tab key cannot
      // trap the keyboard (S-022).
      if (focusMode?.active?.value) {
        e.preventDefault()
        focusMode.exit()
        return
      }
      if (viewMode.value === 'editor') {
        e.preventDefault()
        const sheetEl = editorRef.value?.$el
        if (sheetEl) {
          focusAfter(sheetEl)
          // Belt and braces: the move must land. If focus is still inside the
          // sheet — the only candidate was the sheet itself — drop it so the
          // page cannot trap the keyboard.
          if (document.activeElement === sheetEl || sheetEl.contains(document.activeElement)) {
            sheetEl.blur()
          }
        }
      }
    }
    if (cmd && e.key === 'Enter') {
      e.preventDefault()
      if (viewMode.value === 'editor') {
        // The drawer open is additionally gated on focus mode: while the mode
        // is active its chrome may not open (S-009), so canOpenDrawer() ===
        // false defers the drawer (`!== false` keeps the branch open when
        // focusMode isn't wired, i.e. the pre-focus-mode behaviour).
        if (focusMode?.canOpenDrawer?.() !== false) {
          leftDrawerMode.value = 'chapters'
          leftDrawerOpen.value = true
          addExpanded.value = true
        }
      }
      return
    }
    // The old number-key (1–6) "insert heading level N" shortcut is gone —
    // there are two add actions now (Chapter / Section), exposed as buttons in
    // the nav drawer's add control. Adding a letter-key shortcut (e.g. c/s) was
    // considered and rejected: those are common prose letters, and with the
    // drawer open + expanded a plain keystroke would misfire while the user
    // types. Cmd+Enter opens the drawer and reveals the buttons; that's enough.
  }

  function onSelectionChange() {
    format.syncFormatState()
    format.updateSelectedWordCount()
    // While focus mode is active, every caret move re-centres the caret's
    // paragraph (e2e-covered; jsdom has no layout). Optional call because the
    // unit-test focus-mode mocks have no `recentre` key; the call is inert
    // when the mode is inactive — recentre self-guards.
    focusMode?.recentre?.()
  }

  onMounted(() => {
    document.addEventListener('keydown', onKeydown)
    document.addEventListener('selectionchange', onSelectionChange)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', onKeydown)
    document.removeEventListener('selectionchange', onSelectionChange)
  })
}