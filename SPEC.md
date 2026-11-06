# 5.13 — Color controls in Text Options

Approved sentence list for the spec-to-tests stage. The tests are written and red;
they define what "done" means. This file is the implementer's whole context —
nothing here refers to any conversation.

## Context

### What the writer gets

Every text-appearance control in one place, and color treated as three
independent choices instead of ten fixed bundles:

- A **Background** row of swatches, a **Text** row and an **Accent** row.
- One **preset button** per existing theme, labelled with its name, applying
  that theme's three colors together.
- A swatch applies on the click. There is no OK, Apply or Cancel for color.
- No color may be chosen twice: a swatch whose color is already chosen in
  another row is disabled.
- The chosen swatch in each row carries a visible mark, so the writer can see
  which color is live without reading the sheet. `aria-current` alone is not
  enough, because it changes nothing on screen.
- Swatches, preset buttons and the drawer's selects show a pointer cursor, like
  the zoom and margin controls beside them.

The status bar loses its swatch and its picker entirely.

### Why rows instead of hex fields

Free hex entry lets a writer set text and background to the same value and lose
the manuscript behind the sheet. A curated palette removes that failure mode,
and the per-row disabled state removes the remaining path to it (the same color
picked for two rows).

### The palette

`src/constants/themes.js` stays the single source of truth. The palette is every
distinct color it holds — ten `bg`, ten `text`, ten `accent` values, all thirty
verified distinct — in **first-appearance order**: theme order, then `bg`,
`text`, `accent` within each theme. Each of the three rows offers that same
palette, so any background can be paired with any text.

A swatch's accessible name is its row, the theme that contributed the color and
that theme's role for it, for example `Background Mist accent` or
`Text Sepia background`. Each theme contributes exactly one color per role, so
that name is unique inside its row.

### The theme model in `useTheme.js`

Today the selection is an index into `THEMES`, stored as `rite-theme`, and
`editorDisplay.vue` resolves `THEMES[props.theme]`. A mixed combination has no
index, so the model becomes three colors:

| Export | Kind | Meaning |
|---|---|---|
| `editorBg`, `editorText`, `editorAccent` | refs | the chosen hex strings |
| `currentTheme` | computed | `{ bg, text, accent, accentBg, accentHover }`, the first three from the refs and the last two derived from `accent` |
| `matchedPreset` | computed | index of the `THEMES` entry whose three colors all match, else `-1` |
| `selectBackground(hex)`, `selectText(hex)`, `selectAccent(hex)` | functions | set one color, save the prefs |
| `selectTheme(i)` | function | sets all three from `THEMES[i]`, saves the prefs |

`accentBg` and `accentHover` are derived from the chosen accent with the existing
`hexToRgba(hex, 0.25)` and `darkenHex(hex, …)` helpers. That keeps a mixed
combination visually coherent without a second palette.

Persistence moves to `rite-bg`, `rite-text` and `rite-accent`. `loadPrefs` falls
back to the legacy `rite-theme` index when those keys are absent, so an existing
install keeps its theme. A stored set that is unreadable, not a hex color, or
repeats a color falls back to `THEMES[0]`.

The three setters must refuse a color already held by another of the three
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
  S-003 replaces them with the assertion that the bar renders no color UI.
- `src/components/StatusBar.keyboard.spec.js` — its whole subject is the removed
  trigger and tooltip; the file is deleted. Swatch names, the current mark and
  keyboard operation are re-owned by S-014 and S-015 against the drawer.
- `e2e/keyboard-navigation.spec.js` S-013 and S-014 — same reason, same re-owning.
  S-019 measured the focus ring on the deleted status-bar swatch, so it measures
  the font select in this drawer instead; that control already draws an accent
  border on focus.
- `src/composables/useTheme.test.js` — cases that assert an index in
  `rite-theme` are rewritten against the three color keys. No case is dropped
  without a replacement.
- `src/components/TextOptionsDrawer.spec.js` — `makeProps().theme` grows the new
  fields; the seven existing cases keep their assertions.

## Decisions

- **Palette order**: first appearance in `THEMES` (theme order, then `bg`,
  `text`, `accent`), so the grid is deterministic and a test can name position 0.
- **Guard**: disabled, not hidden. A row keeps its full palette; the two colors
  used elsewhere are visibly disabled.
- **Current preset**: marked only on an exact three-color match. A mixed
  combination marks no preset.
- **No confirm**: color is a live preference, like zoom and margin beside it.
- **Status bar**: no swatch, no picker, no read-only indicator.
- **Corrupt prefs**: fall back to `THEMES[0]` rather than to a half-applied set.
- **Visible mark**: the chosen swatch draws a mark the plain swatches do not.
  The active preset already uses the zoom control's outline grammar, so the
  swatch follows it. `aria-current` stays for assistive tech but changes nothing
  on screen, which is why S-016 measures a computed style in a real page.

## Sentences

### Placement and immediate apply

| ID | Layer | Sentence |
|---|---|---|
| S-001 | unit | it should render Background, Text and Accent swatch rows in Text Options, each holding one swatch per distinct color in `THEMES` |
| S-002 | unit | it should render one preset button per theme, labelled with that theme's name |
| S-003 | unit | it should render no color swatch and no color picker in the status bar |
| S-004 | unit | it should apply a swatch's color on the click itself, with no confirm control anywhere for color |
| S-005 | unit | it should apply a preset's background, text and accent together on one click |
| S-006 | unit | it should mark a preset current only when all three current colors match it, and mark none for a mixed combination |
| S-007 | e2e | it should repaint the editor sheet the moment the Forest preset is clicked, with the drawer still open |
| S-008 | e2e | it should paint the sheet with a mixed background and text, and keep the background when the text swatch is picked afterwards |

### Derived color and persistence

| ID | Layer | Sentence |
|---|---|---|
| S-009 | unit | it should derive the accent background and accent hover from whichever accent is chosen |
| S-010 | unit | it should keep the chosen background, text and accent across a reload |
| S-011 | unit | it should load a stored combination that matches no preset, and mark no preset current |
| S-012 | unit | it should fall back to the first preset when the stored colors are corrupt, unreadable, or repeat a color |

### The same-color guard

| ID | Layer | Sentence |
|---|---|---|
| S-013 | unit | it should render a swatch whose color is already chosen in another row as disabled, so it cannot be selected from that row |

### Access

| ID | Layer | Sentence |
|---|---|---|
| S-014 | unit | it should name each swatch by its row, its source theme and that theme's role, and mark the chosen swatch in each row as current |
| S-015 | e2e | it should reach the swatches by Tab and apply the focused one with Enter |

### Affordance

| ID | Layer | Sentence |
|---|---|---|
| S-016 | e2e | it should give the chosen swatch in each row a visible mark that the free swatches in that row do not carry |
| S-017 | e2e | it should show a pointer cursor on every swatch, every preset button and both selects in the drawer |

## Out of scope

- No free-form hex entry and no color picker widget.
- No new palette values: the swatches are exactly the colors `THEMES` already
  holds. Adding a color is a change to `themes.js`.
- No per-document theme; the choice stays app-global, like zoom and margin.
- No contrast scoring or automatic text color.
