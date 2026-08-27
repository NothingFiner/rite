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
 * (`editorRef.value?.selectLine` / `navigatePage` / `navigateHeadingPage`)
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
  onInsertHeading,
}) {
  function onKeydown(e) {
    const cmd = e.metaKey || e.ctrlKey

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
        editorRef.value?.navigateHeadingPage?.(1)
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        editorRef.value?.navigateHeadingPage?.(-1)
        return
      }
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
    }
    if (cmd && e.key === 'Enter') {
      e.preventDefault()
      if (viewMode.value === 'editor') {
        leftDrawerMode.value = 'chapters'
        leftDrawerOpen.value = true
        addExpanded.value = true
      }
      return
    }
    if (leftDrawerOpen.value && leftDrawerMode.value === 'chapters' && addExpanded.value && !search.searchVisible) {
      const level = parseInt(e.key, 10)
      if (level >= 1 && level <= 6) {
        e.preventDefault()
        onInsertHeading(level)
        return
      }
    }
  }

  function onSelectionChange() {
    format.syncFormatState()
    format.updateSelectedWordCount()
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