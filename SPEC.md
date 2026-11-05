# 5.7 — Keyboard navigation (accessibility pass, part 1)

Approved sentence list for the spec-to-tests stage. The tests are already written
and red; they define what "done" means. This file is the implementer's whole
context — nothing here refers to any conversation.

## Context

### Why keyboard first

Non-mouse navigation is the accessibility pass, not a subset of it. Every
VoiceOver user on macOS drives the screen reader from the keyboard, so a keyboard
gap is also a screen-reader gap: reachability is the shared floor, and naming
only matters once a control can be reached. It is also the only half of
accessibility the test layers can hold to account — Playwright can Tab, Enter and
Escape and assert what happened; it cannot hear what VoiceOver says.

### Scope of this spec

Four surfaces that are currently mouse-only because the click lives on a `div` or
`li`, plus the focus movement that makes keyboard use coherent:

- `src/components/NavigationDrawer.vue` — section rows
- `src/components/HistoryListDrawer.vue` — history entries
- `src/components/StatusBar.vue` — the theme picker
- cross-cutting focus movement (drawer open/close, Tab, focus visibility)

Out of scope, deliberately: the Ruler (its markers are drag-only, so a keyboard
equivalent needs a slider value model — `role="slider"`, a unit, an arrow step —
and that is its own pass, 5.7b), and screen-reader naming elsewhere in the app
(ActivityBar icons, the editor's missing `role="textbox"`).

### Decisions

1. **No focus trap.** A drawer is a non-modal side panel. Tab must be able to walk
   out of it (S-018). Do not add a trap.
2. **Roving tabindex for the section list.** The list is one tab stop; Arrow
   Up/Down move between rows. This is the ARIA list pattern and it is right for a
   novel with fifty sections — plain Tab through every row would be unusable.
3. **Rows do not select on focus.** Arrows move focus only; Enter or Space
   selects (S-004, S-005, S-006).
4. **Theme names are added to `THEMES`.** `src/constants/themes.js` currently has
   only `bg` / `text` / `accent`, so a swatch has nothing to be called. Add a
   `name` to each entry (a short human name: "Sand", "Sepia", …). The names must
   be unique.
5. **The row's action buttons become siblings of the row control.** A `button`
   inside a `button` is invalid HTML and Enter would fire both. Inside the `li`,
   the row control covers the title, and rename / delete / type / hidden are
   separate siblings (S-003).
6. **Existing class hooks stay.** The tests use `.nav-section`, `.history-row`,
   `.theme-swatch`, `.theme-swatch.current` (the trigger) and `.theme-tooltip`
   (the popup). Restructure freely inside them, but do not rename them.
7. **"Marked as the current item" means `aria-current="true"`** on exactly the
   one matching element, and absent (not `"false"`) on the others.
8. **Names come from `aria-label`** for rows, history entries and swatches.
   Text-content naming is not usable here: a row's text includes its page number
   and its action glyphs.

### What already works — do not regress

The global shortcut layer (`src/composables/useKeyboardShortcuts.js`) owns
Cmd+B/I/U, Cmd+F, and the Escape chain (search → open drawer → focus mode, in
that order). Escape already closes a drawer; these sentences only add where focus
lands afterwards. `PromptModal` already focuses its input on open.

### Layers

Unit for roles, names and current-item marking (jsdom can see the DOM).
E2E for real key presses and focus movement (jsdom has no focus or layout).
No Rust: nothing here crosses the IPC boundary.

## Sentences

### Section rows — `NavigationDrawer.vue`

- **S-001** (unit) — Each section row is a focusable control named by the section's display title.
- **S-002** (unit) — Only the row for the active section is marked as the current item.
- **S-003** (unit) — The rename, delete, type and hidden controls are not descendants of the row control, so activating one cannot also select the section.
- **S-004** (e2e) — Enter on a focused row selects that section, exactly as clicking does.
- **S-005** (e2e) — Space on a focused row selects it and does not scroll the page.
- **S-006** (e2e) — Arrow Down/Up move focus to the next/previous row without selecting it; focus stops at the first and last row.

### History rows — `HistoryListDrawer.vue`

- **S-007** (unit) — Each history entry is a control whose accessible name contains its formatted timestamp and its kind (snapshot or delta).
- **S-008** (unit) — Only the selected entry is marked as the current item.
- **S-009** (e2e) — Enter on a focused entry loads that version into the preview, exactly as clicking does.

### Theme picker — `StatusBar.vue`

- **S-010** (unit) — The theme trigger is a control with an accessible name that reports whether the picker is open.
- **S-011** (unit) — Every swatch is a control named by its theme's name, and no two swatches share a name.
- **S-012** (unit) — Only the swatch matching the current theme is marked as the current item.
- **S-013** (e2e) — Enter on the focused trigger opens the picker and Tab reaches the first swatch.
- **S-014** (e2e) — Enter on a focused swatch applies that theme (the editor sheet's background becomes that theme's `bg`).
- **S-015** (e2e) — Escape closes the picker and leaves focus on the trigger.

### Focus movement

- **S-016** (e2e) — Opening the sections drawer focuses its active row, or the first row when no section is active.
- **S-017** (e2e) — Escape that closes a drawer returns focus to the ActivityBar button that opened it.
- **S-018** (e2e) — Tab from the last control in an open drawer moves to the next control in the page; the drawer does not trap focus.

### Focus visibility

- **S-019** (e2e) — A control reached with Tab shows a visible focus indicator (its computed `outline-style` or `box-shadow` differs from the unfocused control).
