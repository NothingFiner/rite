# 5.12 — History diff change navigation

Approved sentence list for the spec-to-tests stage. The tests are written and red;
they define what "done" means. This file is the implementer's whole context —
nothing here refers to any conversation.

## Context

### What the writer gets

The History view renders a side-by-side diff of a past version against the live
document. Today that diff is a read-only scroll: a long manuscript can hold a
handful of changes buried in hundreds of unchanged paragraphs, and finding them
means scrolling the whole thing. This feature adds a way to step from one change
to the next, by button or by keyboard, and shows where you are in the set.

### What already exists

`diff_against_current` (Rust, `src-tauri/src/diff.rs`) returns
`Vec<SectionDiff>`: a structural, id-matched walk that yields one block per
section, each `unchanged`, `added`, `removed` or `modified`. A `modified` section
carries `paragraphDiffs`, one per paragraph (`unchanged` / `added` / `removed` /
`modified` with word-level spans). **This feature needs no Rust change** — the
data is already enough to enumerate changes.

`DiffView.vue` renders those blocks. On this branch its structure is:

```
.diff-section
├─ .diff-title-row    .diff-title-cell.diff-left  + .diff-title-cell.diff-right
└─ .diff-row (one per paragraph)   .diff-cell.diff-left + .diff-cell.diff-right
```

The title is its own row in every case. This is a prerequisite for the feature:
a stop has to be a row so that it can be marked and scrolled to.

### The target contract

Every navigable change is a row carrying:

- `data-change-index="<n>"` — 0-based, assigned in document order across the
  whole diff.
- `data-current-change="true"` — only on the row that is current. At most one row
  in the document carries it at any time.

The header carries the controls, as siblings of the two header cells (do not add
a third `.diff-header-cell`; an existing test asserts exactly two):

```
.diff-header
├─ .diff-header-cell.diff-left    "Past version"
├─ .diff-header-cell.diff-right   "Current"
└─ .diff-nav
   ├─ button.diff-nav-prev         "Previous change"
   ├─ span.diff-nav-position       "Change 2 of 7"
   └─ button.diff-nav-next         "Next change"
```

With no changes at all, `.diff-nav` shows the text `No changes` and no buttons.

### Keyboard

`Alt+ArrowDown` / `Alt+ArrowUp` move to the next / previous change while a diff is
mounted. The listener belongs to the diff view, not to
`useKeyboardShortcuts.js`: `rite.md` reserves that file for *app-level* commands,
and this one exists only while a diff is on screen. Wiring it through App →
HistoryView → DiffView would mean lifting the current index through three
components for no gain.

### Test files already touched by this change

`src/components/DiffView.spec.js` was adapted (selector-only) when the title row
was introduced: seven assertions that read the *first* `.diff-cell` now read the
title cell or the whole column. No assertion was removed or loosened; that file is
the locked baseline and the implementer must not edit it.

The new tests are:

- `src/components/DiffView.navigation.spec.js` — S-001 … S-012, S-016.
- `e2e/history-diff-nav.spec.js` — S-013, S-014, S-015, S-017.

Neither file may be edited to make the suite pass. They read the component only
through the public contract above (`data-change-index`, `data-current-change`,
`.diff-nav*`), so the implementation is free to compute targets however it likes.

### The stub in place

`DiffView.vue` carries a stub `.diff-nav` in the header (a disabled pair of
buttons and the literal text `Change 0 of 0`), an empty `data-change-index` on
every row, and `data-current-change="true"` on the first section's title row. That
markup exists only so the tests reach their assertions instead of failing on a
missing element. All of it is placeholder: delete the stub comment and the pinned
attributes when you implement.

## Decisions

- **Granularity**: one stop per changed paragraph, per renamed section title, and
  per whole added/removed section. Five edited paragraphs in one section are five
  stops.
- **Ends**: stop, do not wrap. Previous is disabled on the first change and Next
  on the last.
- **Index base**: `data-change-index` is 0-based; the counter is 1-based.
- **Reset**: when `diffBlocks` becomes a different version's diff, the current
  change returns to the first.
- **Scroll on navigation only**: the view does not scroll on first render; it
  scrolls when the current change moves.

## Sentences

### Targets

| ID | Layer | Sentence |
|---|---|---|
| S-001 | unit | it should treat each changed paragraph in a modified section as one change target, in document order |
| S-002 | unit | it should treat an added or removed section as one change target, not each of its paragraphs |
| S-003 | unit | it should treat a renamed section title as one change target even when no paragraph in that section changed |
| S-004 | unit | it should not count unchanged sections or unchanged paragraphs as targets |

### Movement

| ID | Layer | Sentence |
|---|---|---|
| S-006 | unit | it should make the first target current when a diff with at least one target first renders |
| S-007 | unit | it should move to the next target when Next is pressed, and to the previous target when Previous is pressed |
| S-008 | unit | it should disable Previous on the first target and Next on the last target |
| S-011 | unit | it should return to the first target when `diffBlocks` changes to another version's diff |
| S-016 | unit | it should move to the next target on Alt+ArrowDown and to the previous target on Alt+ArrowUp while a diff is shown |

### Presentation

| ID | Layer | Sentence |
|---|---|---|
| S-005 | unit | it should number targets from 1 and show `Change N of M` in the diff header |
| S-009 | unit | it should mark exactly one target row with `data-current-change="true"` and remove the mark from the row that was current |
| S-010 | unit | it should bring the current target's row into view when the current target changes |
| S-012 | unit | it should hide the navigation controls and show `No changes` when no section differs |

### End to end

| ID | Layer | Sentence |
|---|---|---|
| S-013 | e2e | opening a version's diff shows `Change 1 of 3` when three paragraphs changed |
| S-014 | e2e | pressing Next marks the second changed paragraph as current and scrolls it into view |
| S-015 | e2e | Previous is disabled while the first change is current, and pressing it changes nothing |
| S-017 | e2e | pressing Alt+ArrowDown on a version diff moves the current change forward |

## Out of scope

- No Rust change. `diff_against_current` already carries everything needed.
- No change to restore, preview, or the version list.
- No navigation by word-level span: a modified paragraph is one stop, not one per
  changed word.
- No wrap-around mode, no jump-to-first/last, no minimap.
