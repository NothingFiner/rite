import { onMounted, onUnmounted } from 'vue'

/**
 * Centralised keyboard-shortcut handling for the app shell.
 *
 * Takes the pieces of state it needs to act on (store, file IO, the format and
 * search composables, the editor ref, the drawer refs, and an insert-heading
 * callback) and wires its own `keydown` + `selectionchange` listeners on
 * `document` for the host component's lifetime. Keeping this out of App.vue's
 * setup body lets App.vue be about layout/wiring rather than key mapping, and
 * makes every shortcut's effect a call on an injected dependency — no hidden
 * DOM reach-through.
 *
 * Page/line navigation delegates to methods exposed by the editor
 * (`editorRef.value?.selectLine` / `navigatePage` / `navigateSectionPage`)
 * rather than the parent reaching into the editor's private DOM.
 *
 * Refs are passed in as refs; the composable reads `.value` itself.
 */
export function useKeyboardShortcuts({
  store,
  fileIO,
  format,
  search,
  viewMode,
  leftDrawerOpen,
  leftDrawerMode,
  addExpanded,
  editorRef,
  onInsertSection,
  // Focus / typewriter mode (roadmap 5.3). Every access is optional-chained
  // (`focusMode?.`) because App.vue doesn't wire it yet and the unit-test
  // mocks may omit pieces (e.g. no `recentre` key): an absent focusMode must
  // simply mean none of the focus-mode behaviour applies.
  focusMode,
}) {
  function onKeydown(e) {
    const cmd = e.metaKey || e.ctrlKey

    // Cmd+Shift+S → Save As (copy to a new path). Checked BEFORE plain Cmd+S
    // so the shifted variant doesn't fall through to the quick-save branch.
    // `e.key` is 'S' (uppercase) when Shift is held on most layouts, but lower-
    // casing keeps it correct regardless of layout/CapsLock state.
    if (cmd && e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      fileIO.saveFileAs()
      return
    }

    if (cmd && e.key === 's') {
      e.preventDefault()
      fileIO.saveFile()
      return
    }

    if (cmd && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      store.undo()
      return
    }

    if (cmd && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
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

    // Cmd/Ctrl+Shift+F → toggle focus / typewriter mode (roadmap 5.3). Must be
    // checked BEFORE the plain `cmd && e.key === 'f'` search branch below:
    // with Shift held `e.key` may arrive as 'F' (which the search branch would
    // miss), and on layouts that report lowercase 'f' it would otherwise fall
    // through INTO the search branch. Lower-casing covers both, so a cmd/ctrl
    // +shift+F is always focus mode, never search. Editor-view only: in the
    // manuscript/history views the combination is left alone entirely (no
    // preventDefault, no toggle) so those views' own key handling is untouched
    // (S-004).
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
      if (leftDrawerOpen.value) {
        e.preventDefault()
        leftDrawerOpen.value = false
        return
      }
      // Focus mode is the LAST fall-through of the chain (S-007 order):
      // a search panel Escape closes only the search, an open drawer Escape
      // closes only the drawer, and focus mode exits only once nothing else
      // wants the key — closing chrome first, the mode last.
      if (focusMode?.active?.value) {
        e.preventDefault()
        focusMode.exit()
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