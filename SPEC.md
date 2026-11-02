# SPEC — Native application menu

**Status:** approved. Implement exactly these behaviours; do not weaken or edit the tests.

Replace the status bar's file buttons with a native application menu built in Rust
(File / Edit / Window), and route the menu's app-owned items back to the frontend as
`menu` events. The native menu is the single menu on macOS, Windows and Linux.

## Context

Decisions taken with the user before this branch existed. The implementer needs them;
they are not visible anywhere else.

- **One native menu, all platforms.** Tauri v1 renders a real menu on macOS (system
  bar), Windows (Win32) and Linux (GTK). The separate in-app "File" popup was rejected,
  and the status bar's individual file buttons are removed rather than kept alongside.
- **Markdown stays; PDF never existed.** `Export .md` is implemented and gets a menu
  item. There is no PDF exporter and none is added.
- **`New…` already asks for a name.** `onNewFile` runs the save-before guard and then
  shows `PromptModal`. This feature only moves the entry point; the flow is existing
  behaviour and must keep working through the menu.
- **Undo/Redo are app-owned; Cut/Copy/Paste/Select All are native.** `store.undo()`
  flushes pending typing to Rust before undoing, so native WebKit undo would desync the
  two. Paste must stay native because `editorDisplay.vue`'s `@paste` handler only runs
  when the webview raises the event; JavaScript cannot synthesise a paste payload.
- **The menu owns these accelerators.** `Cmd/Ctrl+N`, `O`, `S`, `Shift+S`, `Z`,
  `Shift+Z`. The matching branches are removed from `useKeyboardShortcuts`. `Cmd+Y`
  stays in JS: no menu item carries it, so no double-fire is possible.
- **Section-title editing is out of scope.** A menu-driven cut/paste has no special
  lock handling here.
- **Save As / title independence already landed** (PR #8, in `development`). Saving no
  longer rewrites `doc.title`. This spec must not re-test that, and must not assume the
  old coupling.
- **Transition tests are deliberately absent.** No sentence asserts "the old status-bar
  buttons are gone"; that is a one-time diff review, not durable behaviour.

## Constraints

- **The test seam is plain data.** Tauri v1's `Menu`, `Submenu`, `CustomMenuItem` and
  `MenuItem` are plain structures with public fields, and `Menu` exposes no getters for
  a built menu. So the menu is defined as data (`MenuNode` values) and a builder
  consumes it. Rust tests assert the data and the built structure.
- **S-007's observable proxy.** `tauri::Builder`'s menu field is private, so no test can
  prove installation directly. `app_menu()` is the value `run()` passes to `.menu()`;
  the test proves it carries the canonical definition. The one-line wiring in `run()` is
  a review checkpoint.
- **S-025's native items.** `MenuItem::Quit` and `MenuItem::Hide` are native: the OS
  supplies their accelerators, and a native item cannot take a custom one. The sentence
  records the expected binding (⌘Q / ⌘H); the data carries the native kind, not a
  settable accelerator.
- **Playwright cannot click a native menu.** E2E proves the event→action wiring by
  dispatching the same `menu` event the Rust side emits, and that the action runs with
  no button clicked. The menu itself is verified at the Rust layer and by hand.
- **`e2e/epub-export.spec.js` is migrated, not deleted.** It clicked the status-bar
  Export button that this feature removes. Its S-ID becomes this spec's S-023 and its
  assertions stay identical; the trigger becomes the `menu` event. This is an
  intentional migration of coverage, not a weakened test.

## Sentences

### Rust — menu data and construction

**S-001** (rust) — It should expose the File menu as ordered plain data where each node is either a separator or an item with a stable id and a label.

**S-002** (rust) — The File menu should contain, in order: `New…`, `Open…`, separator, `Save`, `Save As…`, separator, `Import…`, `Export .txt`, `Export .md`, `Export .docx`, `Export .epub`.

**S-003** (rust) — Every non-separator id should be unique within the File menu.

**S-004** (rust) — The ids should be `new`, `open`, `save`, `save_as`, `import`, `export_plain_text`, `export_markdown`, `export_docx`, `export_epub`.

**S-005** (rust) — It should attach `CmdOrCtrl+N`, `CmdOrCtrl+O`, `CmdOrCtrl+S` and `CmdOrCtrl+Shift+S` to New, Open, Save and Save As, and no accelerator to the remaining File items.

**S-006** (rust) — It should build a native menu with File, Edit and Window submenus, where the File submenu holds one entry per data node in the same order and a native separator wherever the data has one.

**S-007** (rust) — It should install that menu on the app builder, replacing the default menu.

**S-008** (rust) — It should emit one window event named `menu` carrying the item id when an app-owned item is activated.

**S-009** (rust) — It should emit no event when a separator is activated.

**S-010** (rust) — It should emit nothing and not panic when an event arrives for an id it does not own.

### Rust — Edit, Window and the application menu

**S-011** (rust) — The Edit submenu should contain `Undo`, `Redo`, separator, `Cut`, `Copy`, `Paste`, `Select All`, in that order.

**S-012** (rust) — Undo and Redo should be app-owned items with ids `undo` and `redo` and accelerators `CmdOrCtrl+Z` and `CmdOrCtrl+Shift+Z`.

**S-013** (rust) — Cut, Copy, Paste and Select All should be native predefined items that emit nothing, so the webview handles them.

**S-014** (rust) — The Window submenu should contain `Minimize`, `Fullscreen` and `Close Window`, in that order.

**S-015** (rust) — Every Window item should be native and emit nothing.

**S-025** (rust) — It should put an application submenu first, containing native `Quit rite` and `Hide rite` items that emit nothing; macOS supplies their `Cmd+Q` and `Cmd+H` accelerators.

### Frontend — unit

**S-016** (unit) — It should run the matching action when a `menu` event arrives with a known id.

**S-017** (unit) — It should ignore a `menu` event with an unknown id without throwing.

**S-018** (unit) — A `menu` event with id `undo` should call the document store's undo, and `redo` its redo.

**S-019** (unit) — A `menu` event with id `new` should show the name prompt only after the unsaved-changes guard.

**S-020** (unit) — Cancelling the name prompt should leave the document unchanged.

**S-021** (unit) — The keyboard shortcuts should no longer handle Cmd/Ctrl+S, Cmd/Ctrl+Shift+S, Cmd/Ctrl+Z or Cmd/Ctrl+Shift+Z, because the menu owns them.

### e2e

**S-022** (e2e) — A `menu` event with id `save` should save the document with no button clicked.

**S-023** (e2e) — A `menu` event with id `export_epub` should open the save dialog and invoke `export_epub` with the chosen path. *(migrated from `e2e/epub-export.spec.js`; assertions unchanged)*

**S-024** (e2e) — A `menu` event with id `save_as` should open the save dialog and write the document to the chosen path, and leave the document title unchanged.
