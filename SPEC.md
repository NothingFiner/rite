# SPEC — Tauri v1 → v2 migration

Branch: `chore/tauri-v2-migration` (from `development`).
Roadmap: this sits between 5.10 (shipped) and 5.11 (thesaurus). It is **migration
only**. Do not add features, do not change behaviour, do not touch 5.11.

## Why this is happening now

Tauri v1 (this repo is on `tauri 1.8.3` / `@tauri-apps/api 1.6.0`) has **no
popup / context-menu API at all** — verified in the installed crate
(`~/.cargo/registry/.../tauri-1.8.3/src/`): only `Builder::menu`,
`WindowBuilder::menu` and tray menus exist. Roadmap item 5.11 (thesaurus) wants a
one-item right-click menu, which requires `Menu::popup()` at the cursor — a v2
API. So the migration is a prerequisite, not a nice-to-have.

The second reason: `@tauri-apps/plugin-clipboard-manager` (needed to make Paste
work from our own context menu, since `execCommand('paste')` is not implemented
for WKWebView web content) is **v2 only**. v1 ships `@tauri-apps/api/clipboard.js`
but the allowlist has no `clipboard` block, so it is disabled.

## Context the implementer needs

### What the app actually does with Tauri

- 42 `#[tauri::command]`s, all listed in `src-tauri/src/lib.rs::run()`.
- **All document IO is Rust-side `std::fs`** (`commands.rs`, `history.rs`,
  `sidecar.rs`, `export_*`). Rust is not gated by the capability/allowlist
  system. Open, save, autosave and export never went through Tauri's `fs`
  allowlist, and must not start doing so.
- The *only* frontend file read was `readBinaryFile` in
  `src/composables/useFileIO.js:126`, used solely to hand bytes to the JS
  `docx`/`odt` unzipper. **Decision: that read becomes a Rust command.** The
  fs capability is dropped entirely; the permission surface is dialogs + window
  dragging. (This app has one user; do not build compatibility fallbacks.)
- Frontend module surface on v1: `@tauri-apps/api/tauri` (21 files),
  `@tauri-apps/api/dialog` (5), `@tauri-apps/api/event` (5),
  `@tauri-apps/api/fs` (1). Window dragging is the `data-tauri-drag-region`
  attribute on `src/components/Toolbar.vue:2` — no JS call, but it needs the
  `core:window:allow-start-dragging` permission in v2.
- No Tauri plugins are installed on v1. v2 needs `dialog` (and only `dialog`).

### The one v1 API that is genuinely rewritten

`src-tauri/src/menu.rs` touches Tauri menu types in exactly three places:
`build_menu`, `node_entry`, `menu_item` (+ `app_menu`). Everything else — the
`MenuNode` / `MenuDefinition` / `MenuEvent` plain-data seam and the 16 existing
tests in `src-tauri/tests/menu.rs` — **must survive untouched**. Those 16 tests
are the regression net for this migration: if they still pass, the menu contract
is unchanged.

v1 → v2 mapping this must express:

| v1 | v2 |
|---|---|
| `Menu::with_items([...])` | `MenuBuilder::new(manager)` … `.build()` |
| `Submenu::new(label, menu)` | `SubmenuBuilder::new(manager, label)` … `.build()` |
| `CustomMenuItem::new(id, label)` | `MenuItem::with_id(manager, id, label, enabled, accelerator)` |
| `MenuItem::Separator` | `PredefinedMenuItem::separator(manager)` |
| `MenuItem::Cut/Copy/Paste/SelectAll` | `PredefinedMenuItem::cut/copy/paste/select_all` |
| `MenuItem::Quit/Hide` | `PredefinedMenuItem::quit/hide` |
| `MenuItem::Minimize/CloseWindow` | `PredefinedMenuItem::minimize/close_window` |
| `MenuItem::EnterFullScreen` | `PredefinedMenuItem::fullscreen` |
| `Builder::menu(m)` | `Builder::menu(|app| …)` (closure) |
| `.on_menu_event(\|event\| … event.menu_item_id(), event.window().emit(..))` | `app.on_menu_event(\|app, event\| … event.id(), app.emit_to("main", ..))` |
| `Window` (command param) | `WebviewWindow` |
| `Manager` for `emit` | `Emitter` |

Accelerators: v1 used strings like `"CmdOrCtrl+S"`; v2 parses the same string
via `MenuItem::with_id(..., Some("CmdOrCtrl+S"))`. Keep the exact accelerator
strings from `definition()`.

### App data directory

`path_resolver().app_data_dir()` returns `Option<PathBuf>` on v1 and is called in
three places: `llm.rs:274` (`roles_dir`), `llm.rs:292` (`list_roles`), and
`sidecar.rs:111` (`indexes_dir`). On v2 it is `app.path().app_data_dir()` →
`Result<PathBuf, tauri::Error>` and needs `use tauri::Manager`.

Today two of those silently swallow failure (`list_roles` → built-ins only,
`indexes_dir`'s callers → "no sidecar, rebuild"). **Decision: surface it.** An
unresolvable app-data dir returns an error whose message names the app data
directory, rather than quietly writing to / reading from a fallback. There is no
compatibility requirement and no fallback path should survive this migration.

`list_roles` keeps its *feature* behaviour: user roles merged over built-ins, a
user role winning on a name collision, and built-ins alone when the user roles
directory does not exist yet (fresh install — absence of the dir is not an
error; failure to resolve the base dir is).

### Config and capabilities

v1 `tauri.conf.json` → v2 shape:

- `build.devPath` → `build.devUrl`, `build.distDir` → `build.frontendDist`.
- `tauri.bundle.identifier` → `bundle.identifier`; the package/product name
  moves to a top-level `productName`.
- `tauri.macOSPrivateApi` → top-level `app.macOSPrivateApi`.
- `tauri.windows` → `app.windows`. Window chrome must be byte-identical in
  behaviour: 960×720, resizable, decorations, not transparent,
  `titleBarStyle: "Overlay"`, `hiddenTitle: true`, centered.
- `tauri.allowlist` → `src-tauri/capabilities/*.json` + `app.security`.
- `tauri.security.csp: null` stays (no CSP).
- `src-tauri/Cargo.toml`: `tauri` and `tauri-build` to 2.x, both the normal and
  the `[dev-dependencies]` entry (`features = ["test"]` still gates
  `tauri::test`).
- `package.json`: `@tauri-apps/api` and `@tauri-apps/cli` at v2, plus
  `@tauri-apps/plugin-dialog`.

Expected permission set (nothing more):
`dialog:default` (or the four explicit `dialog:allow-open/save/ask/message`),
`core:window:allow-start-dragging`.

`tauri migrate` is the recommended starting point — let it rewrite config,
`Cargo.toml`, `package.json` and the import paths, scaffold capabilities, then
tidy. Anything it gets wrong, the sentences below will catch.

### The IPC envelope, which changed shape

v1: `invoke(cmd, args)` → `window.__TAURI_IPC__({ cmd, callback, error, ...args })`,
args spread at the top level, result delivered later through
`window['_' + callback](result)`.

v2: `invoke(cmd, args, options)` → `window.__TAURI_INTERNALS__.invoke(cmd, args, options)`,
which **returns a Promise**. `listen(event, handler)` is
`invoke('plugin:event|listen', { event, target, handler })` where `handler` is an
id minted by `window.__TAURI_INTERNALS__.transformCallback`. Dialog calls are
`invoke('plugin:dialog|save', { options })` / `plugin:dialog|open` /
`plugin:dialog|message` (note: `ask` is a `message` with `buttons: 'YesNo'` and
returns the pressed **label**).

The e2e harness vendors this envelope in `e2e/helpers/tauri-ipc.mock.js`
(protected path — the coder must not edit it). It has been rewritten for the v2
envelope as part of this spec.

### The expected intermediate red state — READ THIS BEFORE PANICKING

A module-path major bump is atomic: `@tauri-apps/api` v2 has no `tauri`,
`dialog` or `fs` entry point, so **every colocated test that imports a source
module still importing v1 paths fails at import resolution** until those imports
are renamed. That is the task, not a broken harness.

- The 11 colocated test files already mock the **v2** paths
  (`@tauri-apps/api/core`, `@tauri-apps/plugin-dialog`). Do not edit them.
- Rename the source imports; do not add shims, re-export modules or aliases.
- Pre-existing unit tests must pass unchanged once the rename lands (none of
  them asserts on an import path).
- Pre-existing e2e specs likewise go green only once the app speaks v2.

## Sentences

Layers: **unit** = `npx vitest run`, **rust** = `cargo test`, **e2e** =
`npx playwright test`.

### Config and dependencies — unit

- **S-001**: the build config points `devUrl` at `http://localhost:1420` and
  `frontendDist` at `../dist`, keeping the existing `beforeDevCommand` and
  `beforeBuildCommand`.
- **S-002**: the bundle identifier stays `com.rite.app` and the product name
  stays `rite`.
- **S-003**: the one window keeps its v1 chrome — 960×720, resizable,
  decorations on, transparent off, `titleBarStyle` Overlay, hidden title,
  centered.
- **S-004**: macOS private API stays enabled in its v2 location, so continuous
  WKWebView spellchecking is still on.
- **S-005**: `package.json` depends on `@tauri-apps/api` and `@tauri-apps/cli`
  at v2, with no `^1.` tauri entry left.
- **S-006**: `src-tauri/Cargo.toml` uses tauri 2.x for both the normal and the
  test dependency and tauri-build 2.x, with no 1.x tauri entry left.

### Frontend import surface — unit

- **S-007**: every module that invokes a Rust command imports `invoke` from
  `@tauri-apps/api/core`; no source module imports from `@tauri-apps/api/tauri`.
- **S-008**: dialogs import from `@tauri-apps/plugin-dialog`; no source module
  imports from `@tauri-apps/api/dialog`.
- **S-009**: no source module imports from `@tauri-apps/api/fs`.
- **S-010**: importing a `.docx` or `.odt` gets the file's bytes from a Rust
  command, not from the frontend fs API.
- **S-011**: event listening still goes through `listen` from
  `@tauri-apps/api/event`, and the menu event name is still `menu`.

### Capabilities — unit

- **S-012**: a capability file exists and is applied to the main window.
- **S-013**: the granted set includes dialog open/save/ask/message and window
  start-dragging.
- **S-014**: the granted set contains nothing else — no fs, shell or http
  permissions and no unrestricted `**` scope.
- **S-015**: no Rust source imports a v1 menu type (`CustomMenuItem`,
  `MenuEntry`, `Submenu::new`, `Menu::with_items`).

### App data directory — rust

- **S-016**: resolving the roles directory returns an error naming the app data
  directory when it cannot be resolved, instead of falling back.
- **S-017**: resolving the index sidecar directory behaves the same way.
- **S-018**: `list_roles` still merges user roles over built-ins, and returns
  built-ins alone when the user roles directory is absent without erroring.

### End to end — e2e

- **S-019**: the vendored IPC mock answers v2's
  `window.__TAURI_INTERNALS__.invoke`, so no spec needs to know the envelope.
- **S-020**: the conventions guard fails the suite if any spec or helper
  references the v1 global `window.__TAURI_IPC__` or the v1 callback envelope.
- **S-021**: a menu event with id `save_as` still writes to the chosen path and
  keeps the title.
- **S-022**: an open → edit → save flow completes with no IPC error surfaced,
  proving the migrated `invoke` imports reach the mock.

### Menu regression (no new sentence)

The 16 tests in `src-tauri/tests/menu.rs` are the contract for `definition()`
and `menu_event()`. They must pass **unmodified**. Do not rewrite them to fit the
new API — if they fail, the migration changed behaviour.

## Manual QA checklist

Every v2 failure mode that matters fails at **runtime only** — a missing
capability, an unregistered plugin, a menu not wired to the builder, or an
app-data dir resolving to the wrong place all pass the three test layers. Run
`npm run tauri dev` and check:

1. App launches; no white screen; no console error about a blocked permission.
2. `rite` menu: About, Hide, Quit work.
3. Window drags by the toolbar (this is the `start-dragging` permission).
4. File → Open a `.rite` document; title and content load.
5. Edit a paragraph; File → Save; no dialog appears (quick save to last path).
6. File → Save As; dialog appears; save; title unchanged; file on disk updated.
7. File → New; name prompt; empty document.
8. File → Import; open a `.docx`; content appears (this is the Rust
   `read_import_bytes` path, the only formerly-frontend file read).
9. File → Export plain text, Markdown, DOCX, EPUB — all four dialogs appear and
   write files.
10. Edit → Undo / Redo work; ⌘Z / ⇧⌘Z work.
11. ⌘X / ⌘C / ⌘V work in the editor; ⌘A selects all.
12. Right-click a misspelled word: red squiggle exists, and Learn / Ignore
    Spelling are still offered by WebKit.
13. Window → Minimize, Enter Full Screen, Close Window work.
14. LLM panel: a chat with a role streams; the role list shows user roles from
    `app_data_dir/roles/`. Save a new role, quit, relaunch — it is still there.
    (This is the `app_data_dir` path.)
15. Open a document, edit, and check history: snapshots list and diff against
    current. (This is the index-sidecar `app_data_dir` path.)
16. Quit and relaunch; window geometry and titlebar style unchanged.

## Definition of done

- All four layers green: `npx vitest run`, `cargo test` (in `src-tauri`),
  `npx playwright test`.
- Every S-ID above appears in at least one test name.
- The 16 `src-tauri/tests/menu.rs` tests and all pre-existing unit/e2e tests
  pass unmodified (apart from the mock path rename already committed).
- The manual QA checklist passes, recorded in the PR description.
