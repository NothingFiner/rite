// Menu event routing (SPEC.md S-016 … S-018).
//
// STUB — signatures only. The implementer fills these in.
//
// The Rust side emits one window event named `menu` whose payload is the item
// id (`new`, `open`, `save`, `save_as`, `import`, `export_plain_text`,
// `export_markdown`, `export_docx`, `export_epub`, `undo`, `redo`). This module
// maps those ids to the app's existing actions.

/// The window event the Rust menu emits.
export const MENU_EVENT = 'menu'

/// The ids this app owns. Must match the Rust menu data exactly.
export const MENU_IDS = []

/// Build the id → action map from the app's existing surfaces.
export function createMenuActions(_deps) {
  return {}
}

/// Run the action for `id`. Returns false when `id` is not ours.
export function runMenuAction(_id, _actions) {
  return false
}

/// Listen for `menu` events for the host component's lifetime.
export function useMenuActions(_actions) {
  return { run: () => false }
}
