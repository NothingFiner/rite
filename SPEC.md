# 5.4 — Writing stats: a daily word target and today's progress

Approved sentence list for the spec-to-tests stage. Tests are already written and
red; they define what "done" means. This file is the implementer's whole context —
nothing here refers to any conversation.

## Context

### The shape of the feature

A `Stats` item in the left navigation drawer. The writer sets a daily word target;
the drawer shows a bar of **today's** progress against it, plus the number in words.

### Decisions, and why

1. **"Session" means calendar day.** Not launch → quit (macOS apps are not quit, so
   the number would be unbounded and a crash would reset it) and not an idle-delimited
   stretch (a per-session target is farmable: stop for lunch, target met twice).
   Everything below measures *today*, and the UI says so.

2. **The target lives in `localStorage` under `rite-word-target`.** Consistent with
   every other preference in the app (`rite-theme`, `rite-zoom`, `rite-margin`,
   `rite-section-format`, `rite-manuscript-format`). It is therefore app-global, not
   per-manuscript — one target for every document. That is accepted for this version;
   a per-document target in the `.rite` file is a later change if it is ever wanted.

3. **Progress is "words written today", not "words in the manuscript".** Open a
   20,000-word novel, write 100 words, and the bar reads 100 / 1,000. That is why a
   day-start baseline exists, and it is the only reason the baseline exists.

4. **The bar is hand-rolled CSS.** No charting dependency is added (`vue`, `pinia`,
   `marked`, `mammoth`, `jszip`, `dompurify` are the whole list).

### The composable contract

`src/composables/useWritingStats.js` — the tests fix this shape, so implement it:

```js
useWritingStats({ docRef, docKey, now = () => new Date() })
// → {
//   target,       Ref<number|null>   null when no target is set
//   setTarget,    (value) => void    validates, persists, never throws
//   baseline,     Ref<number>        this document's word count when the day began
//   writtenToday, Ref<number>        max(0, wordCount - baseline)
//   hasTarget,    Ref<boolean>       a finite target > 0
//   ratio,        Ref<number>        0..1, capped when progress exceeds the target
// }
export function resetWritingStatsForTests()   // clear cached module state
export const TARGET_KEY = 'rite-word-target'
export const BASELINE_KEY = 'rite-word-baseline'
```

- `docRef` is the same reactive document ref the app already passes to
  `useWordCount`. Take the count from `useWordCount` — do not recount. The status bar
  and the Stats item must never disagree, and `useWordCount` is the single source.
- `docKey` identifies the document (its path). The day-start baseline is stored per
  document, because `localStorage` is shared by every manuscript: without this,
  switching documents would either zero the progress or inflate it by the other
  document's word count.
- `now` exists so the calendar-day boundary is testable without waiting for midnight.
  Default to the real clock. The composable must notice a day change while the app is
  open — no reload — so drive it from a timer as well as from document changes.
- `setTarget` accepts an integer ≥ 1. Reject negatives, fractions and non-numbers by
  leaving the stored value unchanged. `0` and a non-numeric stored value mean "no
  target set", not an error.

### Component contract

`src/components/StatsDrawer.vue`

```js
props:  { written: Number, target: [Number, null] }
emits:  ['set-target']
```

DOM the tests rely on:

- the bar is an element with `role="img"` and `aria-label="N written of M"` — the
  number has to be available without reading a drawing
- the filled portion is `.stats-bar-fill`, with an inline `width: <pct>%` equal to
  `written / target`, capped at 100%
- the target is entered in an `<input>` inside the drawer; `Enter` commits it and
  emits `set-target` with the number
- with no target (`target` null or 0) there is no `role="img"` element at all, the
  input is still offered, and the drawer shows a prompt matching
  /set a daily word target/i

### The one existing test this changes

`src/components/ActivityBar.spec.js` asserts the exact drawer-button list
(`['Sections', 'General Options', 'Text Options']`) and "all three". Adding `Stats`
makes that four, so three assertions in that file were amended as part of this spec:
the editor list, the history list, and the "defaults to the editor view" count. That
amendment is deliberate, not a weaken; no assertion was removed or relaxed, only the
expected set updated to match the sentence below.

`Stats` is allowed in the `editor` and `manuscript` views (like `chapters`) and not in
`history`, where a writing target has no meaning.

### Edge cases the tests pin down

- no target set, target `0`, and a non-numeric stored value
- deleting more words than written today (progress clamps at zero, never negative)
- progress past the target (fill caps at 100%, the number keeps climbing)
- the calendar day changing while the app is open
- two documents, one day, one target
- the very first word of a document (baseline equals the starting count)

### Test locations

Per `.workflow/TESTING.md`: unit tests colocated (`src/**/*.test.js`,
`src/components/*.spec.js`), e2e in `e2e/**/*.spec.js` with the shared IPC mock from
`e2e/helpers/tauri-ipc.js`. No Rust layer: nothing in this feature crosses the IPC
boundary.

## Approved sentences

| ID | Layer | Sentence |
|---|---|---|
| S-001 | unit | it should show a Stats item in the left navigation drawer |
| S-002 | unit | it should let the writer set a daily word target and persist it under `rite-word-target` in localStorage |
| S-003 | unit | it should load the saved target on startup |
| S-004 | unit | it should treat a missing target, a zero target and a non-numeric stored value as "no target set" |
| S-005 | unit | it should refuse a negative or fractional target and leave the stored value unchanged |
| S-006 | unit | it should count today's words as the current document count minus the count recorded when the writing day began |
| S-007 | unit | it should record that day-start count once per calendar day and not overwrite it on later reads the same day |
| S-008 | unit | it should keep the day-start count per document, so opening a different manuscript neither zeroes nor inflates progress |
| S-009 | unit | it should start a new day at zero progress when the calendar day changes, without requiring a reload |
| S-010 | unit | it should clamp displayed progress at zero when the writer deletes more words than they wrote today |
| S-011 | unit | it should take the word count from `useWordCount` rather than recounting, so the Stats item and the status bar cannot disagree |
| S-012 | unit | it should cap the bar fill at 100% when progress exceeds the target |
| S-013 | unit | it should label the graph "N written of M" so the number is available without reading the drawing |
| S-014 | unit | it should hide the graph and prompt for a target when none is set |
| S-015 | e2e | it should open the Stats item, accept a target and show progress that increases after typing |
| S-016 | e2e | it should still show the target and today's progress after a reload |
