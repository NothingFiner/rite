// Menu event routing (SPEC.md S-016 … S-018).
//
// The Rust side emits one window event named `menu` whose payload is the item
// id (`new`, `open`, `save`, `save_as`, `import`, `export_plain_text`,
// `export_markdown`, `export_docx`, `export_epub`, `undo`, `redo`). This
// module maps those ids to the app's existing actions.

import { listen } from '@tauri-apps/api/event'
import { onMounted, onUnmounted } from 'vue'

/** The window event the Rust menu emits (`MENU_EVENT_NAME` in `src-tauri/src/menu.rs`). */
export const MENU_EVENT = 'menu'

/**
 * The ids this app owns: the File items plus undo/redo. Must match the
 * `MenuNode::Item` ids of `definition()` in `src-tauri/src/menu.rs` — native
 * items (quit, clipboard, window) and separators never emit an event.
 */
export const MENU_IDS = Object.freeze([
  'new',
  'open',
  'save',
  'save_as',
  'import',
  'export_plain_text',
  'export_markdown',
  'export_docx',
  'export_epub',
  'undo',
  'redo',
])

/** Build the id → action map from the app's existing surfaces. */
export function createMenuActions(deps) {
  return {
    new: deps.newDocument.onNewFile,
    open: deps.fileIO.openFile,
    save: deps.fileIO.saveFile,
    save_as: deps.fileIO.saveFileAs,
    import: deps.fileIO.importFile,
    export_plain_text: deps.exports.exportPlainText,
    export_markdown: deps.exports.exportMarkdown,
    export_docx: deps.exports.exportDocx,
    export_epub: deps.exports.exportEpub,
    undo: deps.store.undo,
    redo: deps.store.redo,
  }
}

/**
 * Run the action for `id`. Returns false when `id` is not ours — unknown,
 * non-string, or a key the map does not actually carry (inherited
 * Object.prototype names like `toString` stay callable but are not entries).
 */
export function runMenuAction(id, actions) {
  if (typeof id !== 'string' || !actions) return false
  if (!Object.prototype.hasOwnProperty.call(actions, id)) return false
  const action = actions[id]
  if (typeof action !== 'function') return false
  action()
  return true
}

/** Listen for `menu` events for the host component's lifetime. */
export function useMenuActions(actions) {
  let unlisten = null

  onMounted(async () => {
    try {
      unlisten = await listen(MENU_EVENT, (event) => {
        runMenuAction(event.payload, actions)
      })
    } catch (error) {
      // A dead menu listener must never be a silent one.
      console.error('useMenuActions: failed to listen for `menu` events', error)
    }
  })

  onUnmounted(() => {
    unlisten?.()
  })

  return {
    run: (id) => runMenuAction(id, actions),
  }
}