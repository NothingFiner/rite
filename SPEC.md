# 5.13 — Colour controls in Text Options

Approved sentence list for the spec-to-tests stage. The tests are written and red;
they define what "done" means. This file is the implementer's whole context —
nothing here refers to any conversation.

## Context

### What the writer gets

Every text-appearance control in one place, and colour treated as three
independent choices instead of ten fixed bundles:

- A **Background** row of swatches, a **Text** row and an **Accent** row.
- One **preset button** per existing theme, labelled with its name, applying
  that theme's three colours together.
- A swatch applies on the click. There is no OK, Apply or Cancel for colour.
- No colour may be chosen twice: a swatch whose colour is already chosen in
  another row is disabled.

The status bar loses its swatch and its picker entirely.

### Why rows instead of hex fields

Free hex entry lets a writer set text and background to the same value and lose
the manuscript behind the sheet. A curated palette removes that failure mode,
and the per-row disabled state removes the remaining path to it (the same colour
picked for two rows).

### The palette

`src/constants/themes.js` stays the single source of truth. The palette is every
distinct colour it holds — ten `bg`, ten `text`, ten `accent` values, all thirty
verified distinct — in **first-appearance order**: theme order, then `bg`,
`text`, `accent` within each theme. Each of the three rows offers that same
palette, so any background can be paired with any text.

A swatch's accessible name is its row and the theme that contributed the colour,
for example `Background Mist` or `Text Sepia`. Because every colour appears in
exactly one theme, that name is unique inside its row.

### The theme model in `useTheme.js`

Today the selection is an index into `THEMES`, stored as `rite-theme`, and
`editorDisplay.vue` resolves `THEMES[props.theme]`. A mixed combination has no
index, so the model becomes three colours:

| Export | Kind | Meaning |
|---|---|---|
| `editorBg`, `editorText`, `editorAccent` | refs | the chosen hex strings |
| `currentTheme` | computed | `{ bg, text, accent, accentBg, accentHover }`, the first three from the refs and the last two derived from `accent` |
| `matchedPreset` | computed | index of the `THEMES` entry whose three colours all match, else `-1` |
| `selectBackground(hex)`, `selectText(hex)`, `selectAccent(hex)` | functions | set one colour, save the prefs |
| `selectTheme(i)` | function | sets all three from `THEMES[i]`, saves the prefs |

`accentBg` and `accentHover` are derived from the chosen accent with the existing
`hexToRgba(hex, 0.25)` and `darkenHex(hex, …)` helpers. That keeps a mixed
combination visually coherent without a second palette.

Persistence moves to `rite-bg`, `rite-text` and `rite-accent`. `loadPrefs` falls
back to the legacy `rite-theme` index when those keys are absent, so an existing
install keeps its theme. A stored set that is unreadable, not a hex colour, or
repeats a colour falls back to `THEMES[0]`.

The three setters must refuse a colour already held by another of the three
fields. The drawer disables those swatches, and the refusal keeps the rule true
for any other caller.

### Rendering the sheet

`editorDisplay.vue` (and `DocumentRenderer.vue` above it) take the theme as a
`Number` index today. They must also accept the descriptor object, resolving a
number through `THEMES[index]` and an object as itself. Numbers keep working so
the existing rendering tests and the manuscript view are unaffected.

### Existing tests this change moves

These test the status-bar picker, a surface this feature deletes. Their
guarantees are re-owned, not dropped:

- `src/components/StatusBar.spec.js` — the four theme-picker cases are removed;
  S-003 replaces them with the assertion that the bar renders no colour UI.
- `src/components/StatusBar.keyboard.spec.js` — its whole subject is the removed
  trigger and tooltip; the file is deleted. Swatch names, the current mark and
  keyboard operation are re-owned by S-014 and S-015 against the drawer.
- `e2e/keyboard-navigation.spec.js` S-013 and S-014 — same reason, same re-owning.
  S-019 measured the focus ring on the deleted status-bar swatch, so it measures
  the font select in this drawer instead; that control already draws an accent
  border on focus.
- `src/composables/useTheme.test.js` — cases that assert an index in
  `rite-theme` are rewritten against the three colour keys. No case is dropped
  without a replacement.
- `src/components/TextOptionsDrawer.spec.js` — `makeProps().theme` grows the new
  fields; the seven existing cases keep their assertions.

## Decisions

- **Palette order**: first appearance in `THEMES` (theme order, then `bg`,
  `text`, `accent`), so the grid is deterministic and a test can name position 0.
- **Guard**: disabled, not hidden. A row keeps its full palette; the two colours
  used elsewhere are visibly disabled.
- **Current preset**: marked only on an exact three-colour match. A mixed
  combination marks no preset.
- **No confirm**: colour is a live preference, like zoom and margin beside it.
- **Status bar**: no swatch, no picker, no read-only indicator.
- **Corrupt prefs**: fall back to `THEMES[0]` rather than to a half-applied set.

## Sentences

### Placement and immediate apply

| ID | Layer | Sentence |
|---|---|---|
| S-001 | unit | it should render Background, Text and Accent swatch rows in Text Options, each holding one swatch per distinct colour in `THEMES` |
| S-002 | unit | it should render one preset button per theme, labelled with that theme's name |
| S-003 | unit | it should render no colour swatch and no colour picker in the status bar |
| S-004 | unit | it should apply a swatch's colour on the click itself, with no confirm control anywhere for colour |
| S-005 | unit | it should apply a preset's background, text and accent together on one click |
| S-006 | unit | it should mark a preset current only when all three current colours match it, and mark none for a mixed combination |
| S-007 | e2e | it should repaint the editor sheet the moment the Forest preset is clicked, with the drawer still open |
| S-008 | e2e | it should paint the sheet with a mixed background and text, and keep the background when the text swatch is picked afterwards |

### Derived colour and persistence

| ID | Layer | Sentence |
|---|---|---|
| S-009 | unit | it should derive the accent background and accent hover from whichever accent is chosen |
| S-010 | unit | it should keep the chosen background, text and accent across a reload |
| S-011 | unit | it should load a stored combination that matches no preset, and mark no preset current |
| S-012 | unit | it should fall back to the first preset when the stored colours are corrupt, unreadable, or repeat a colour |

### The same-colour guard

| ID | Layer | Sentence |
|---|---|---|
| S-013 | unit | it should render a swatch whose colour is already chosen in another row as disabled, so it cannot be selected from that row |

### Access

| ID | Layer | Sentence |
|---|---|---|
| S-014 | unit | it should name each swatch by its row and theme name, and mark the chosen swatch in each row as current |
| S-015 | e2e | it should reach the swatches by Tab and apply the focused one with Enter |

## Out of scope

- No free-form hex entry and no colour picker widget.
- No new palette values: the swatches are exactly the colours `THEMES` already
  holds. Adding a colour is a change to `themes.js`.
- No per-document theme; the choice stays app-global, like zoom and margin.
- No contrast scoring or automatic text colour.
