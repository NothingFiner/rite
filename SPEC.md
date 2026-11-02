# SPEC — 5.3 Focus / typewriter mode

**Status:** approved. Implement exactly these behaviours; do not weaken or edit the tests.

A single mode, toggled from the editor, that hides the app chrome and keeps the
caret's paragraph vertically centred.

## Sentences

### State — unit

**S-001** (unit) — It should start inactive every time the app starts; the mode
is never restored from a previous session.

**S-002** (unit) — Toggling should activate focus mode, and toggling again
should deactivate it.

**S-003** (unit) — Changing the view from editor to manuscript or history
should deactivate focus mode.

**S-004** (unit) — Neither the toggle nor the shortcut should activate focus
mode while the manuscript or history view is showing.

### Keyboard — unit

**S-005** (unit) — `Cmd/Ctrl+Shift+F` should toggle focus mode in the editor
view, and should not insert any character into the document.

**S-006** (unit) — `Escape` should exit focus mode when the search panel is
closed and no drawer is open.

**S-007** (unit) — `Escape` should close the search panel and leave focus mode
active when both apply.

### Chrome handling — unit + e2e

**S-008** (unit) — Entering focus mode should close any drawer that is already
open.

**S-009** (unit + e2e) — While focus mode is active, an attempt to open a drawer
should leave focus mode active and the drawer closed.

**S-010** (unit) — Entering focus mode with no caret inside the editor should
focus the editor sheet.

**S-011** (e2e) — While focus mode is active, the toolbar, activity bar and
status bar should not be visible.

**S-012** (e2e) — While focus mode is active, the editor should span the full
window width, with no left-rail offset.

**S-013** (e2e) — Text should remain editable while focus mode is active.

**S-014** (e2e) — Leaving focus mode should restore the toolbar, activity bar
and status bar, with the text unchanged.

**S-015** (e2e) — `Cmd/Ctrl+F` while focus mode is active should open the search
panel and keep focus mode active.

### Caret centring — e2e

**S-016** (e2e) — Entering focus mode with the caret in a paragraph should
scroll so that paragraph's vertical centre sits at the middle of the viewport.

**S-017** (e2e) — Moving the caret to a different paragraph while focus mode is
active should centre the newly focused paragraph.

**S-018** (e2e) — At the top of the document, entering focus mode should leave
no blank space above the first paragraph (centring clamps rather than padding).

## Context

### What exists already

- The app shell is `src/App.vue`. Chrome is three fixed components: `Toolbar.vue`
  (`.toolbar`, 38 px tall, fixed top), `StatusBar.vue` (`.statusbar`, 36 px, fixed
  bottom) and `ActivityBar.vue` (`.activity-bar`, 48 px wide, left rail).
  `.scroll-layer` compensates with `padding-top: 38px; padding-bottom: 36px;
  padding-left: 48px` — hiding the bars without collapsing the left padding
  leaves the text indented, so S-012 needs that padding handled, not just
  `display: none`.
- Drawer state is `leftDrawerOpen` / `rightDrawerOpen` refs plus
  `leftDrawerMode` in `App.vue`. Left drawers: `chapters`, `general-options`,
  `text-options`, `history`. The right drawer is the Assistant panel.
- All keyboard handling lives in `src/composables/useKeyboardShortcuts.js`
  (one `keydown` listener on `document`). `Escape` currently closes the search
  panel, then an open left drawer — focus-mode exit must slot in **after** both
  (S-007).
- `getParagraphAtCursor()` in `src/composables/useEditorCursor.js` returns the
  `.paragraph` element containing the caret (or `null`). Each paragraph carries
  `data-para-id`. `editorDisplay.vue` already exposes
  `scrollToParagraph(id)`, which does
  `el.scrollIntoView({ behavior: 'smooth', block: 'center' })`.

### Decisions taken with the user

1. **No persistence.** The mode always starts off and is never written to
   localStorage. Do not add `loadPrefs`/`savePrefs` for it.
2. **One mode, not two.** Hiding chrome and centring the caret are the same
   toggle — there are no separate "focus" and "typewriter" switches.
3. **Shortcut is `Cmd/Ctrl+Shift+F`.** It must call `preventDefault()`; with
   Shift held, `e.key` may be `'F'`, so compare lower-cased.
4. **Editor-only.** The manuscript and History views are never chrome-less;
   switching to them deactivates the mode.
5. **The search panel is not chrome.** `Cmd/Ctrl+F` still works in focus mode
   and does not exit it (S-015); that is also why Esc precedence in S-007
   matters.
6. **No visible exit control.** The shortcut and Esc are the only ways out. A
   floating button would itself be chrome.
7. **Centring clamps** at the document edges (S-018). Do not add synthetic
   scroll padding to force the caret to the middle of the first and last lines.
8. **Entering with no caret focuses the sheet** and then centres the nearest
   paragraph (S-010); it is not a no-op.

### The drawer rule is a default, not a hard constraint

S-009 describes today's default: drawers cannot be opened in focus mode. A
future preference (`allowDrawersInFocusMode`, default `false`, persisted like
`rite-section-format`) may relax it — but **do not build it now**.

Shape the code for it anyway: every drawer open must go through a single gate,
so that later only the gate's condition changes. Today `leftDrawerOpen.value = true`
is assigned in six places (`App.vue` ×5, `useKeyboardShortcuts.js` ×1 for
`Cmd+Enter`) plus one inline template binding for the right drawer. Route all of
them through one helper pair (e.g. `openLeftDrawer(mode)` / `toggleRightDrawer()`)
that consults the mode, rather than scattering `if (active) return` guards.

### Implementation notes

- **Centring must scroll instantly**, not smoothly. `scrollToParagraph` uses
  `behavior: 'smooth'`, which fights the writer when it fires on every caret
  move and makes the e2e assertions depend on animation timing. Use
  `behavior: 'auto'` (or `scrollTo`) for the centring path.
- **Recentring triggers**: on entering the mode, and on caret movement while it
  is active (the existing `selectionchange` listener in
  `useKeyboardShortcuts.js` is the natural hook — it already calls
  `format.syncFormatState()`). Do not recentre on scroll: only the caret moves
  the page.
- **No caret** means `getParagraphAtCursor()` returns `null`, or the caret is
  outside the `.editor-sheet`. Focusing the sheet is enough; do not synthesize a
  selection.
- **Do not put behaviour in an `App.vue` computed** that the unit tests must
  mount around: `App.vue` is already large and only the e2e layer covers it.

### Wiring contract

The unit tests need a seam, so `src/composables/useFocusMode.js` has this shape
(it is currently an inert stub — the behaviour is what you add):

```js
useFocusMode({ viewMode, editorRef, leftDrawerOpen, rightDrawerOpen })
  -> { active, toggle(), exit(), canOpenDrawer() }
```

- `active` is a `ref` that is `false` whenever focus mode is off.
- `toggle()` flips it (and is a no-op outside the editor view, per S-004).
- `exit()` deactivates unconditionally.
- `canOpenDrawer()` answers "may a drawer open right now?" — `false` while
  focus mode is active, `true` otherwise. Every drawer open routes through it
  (see the drawer rule above).
- Focusing the editor sheet means focusing the `.editor-sheet` element inside
  `editorRef.value.$el`, which is how every other composable reaches the sheet
  (e.g. `useFormat.js`).

`useKeyboardShortcuts` takes the same object as a new `focusMode` parameter.
`App.vue` owns the instance, because it owns `viewMode` and both drawer refs.

### Test harness notes

- Unit tests are vitest + jsdom, colocated (`src/**/*.test.js`). jsdom has no
  layout: `getBoundingClientRect()` returns zeros and `scrollIntoView` is not
  implemented. **Centring is therefore covered by e2e only** (S-016–S-018); the
  unit tests cover state, keyboard routing and drawer handling.
- e2e specs run against the Vite dev server with Tauri IPC mocked by
  `window.__TAURI_IPC__` (see `e2e/search-highlight.spec.js`). `get_document`
  determines the document: rejecting it makes the store fall back to a
  one-paragraph default, so the centring tests must resolve it with a long seeded
  document (the `Document` shape is camelCase; `src/constants/DocumentModel.js`
  has the factories).
- The stub for `src/composables/useFocusMode.js` intentionally returns an inert
  object (`active` a `ref(false)`, `toggle`/`exit` no-ops, `canOpenDrawer`
  returning `true`) rather than throwing: a throw would make every new test fail
  with an error instead of an assertion, and the workflow requires assertion
  failures. S-001 is the one sentence whose test passes against the stub — there
  is no implementation that could make "starts inactive" fail except a wrong
  default.
