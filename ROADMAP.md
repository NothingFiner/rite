# Rite — Roadmap

Status as of **2026-11-04**, `development` at `2f43055` (word menu #17, iteration scoping #18 and writing stats #19 merged).

Tauri v1 → v2 migration landed as PR #15 — a prerequisite for 5.11's context menu, not a roadmap item of its own.

**Numbering rule:** IDs are stable. A moved item keeps a pointer at its old ID instead of being renumbered, so commit messages, branch names and old notes stay resolvable. New work takes the next free number in its phase.

---

## Phase 5 — pre-release features

The last feature phase. When this is done, Rite is feature-complete for a first release.

| ID | Item | Status |
|---|---|---|
| 5.1 | View-aware navigation / page preservation | done |
| 5.2 | Drawer / view IA restructure | done |
| 5.3 | Focus / typewriter mode | done (#1) |
| 5.4 | Writing stats: daily word target + progress graph in a sidebar item | done (#19) |
| 5.5 | Outline drag-reorder + `MoveSection` | done |
| 5.6 | Editor extraction (cursor → page-nav → readback → render) | done (PR1–4) |
| **5.7** | **Accessibility pass** | **open** |
| 5.8 / 5.8a | Spellcheck (native squiggles + context menu) | done |
| 5.9 | Subtitle-less chapters | done |
| 5.10 | Hidden sections replace epigrams | done |
| 5.11 | Thesaurus | done (#16) |
| **5.12** | **History diff next/previous change navigation** | **open — moved from 6.1** |
| **5.13** | **Move the colour/theme picker into Text Options (with font, zoom, margins)** | **open — new, 2026-11-03** |
| 5.14 | `NSSpellChecker` spelling actions | absorbed into 5.15 |
| 5.15 | Restored word menu: Cut / Copy / Paste / Select All + Learn / Ignore Spelling | done (#17) |
| **5.16** | **Word cloud of frequently used words, excluding articles and pronouns** | **open — idea, not scoped** |
| **5.17** | **Summary / outline view: per-section synopses in a navigable overview** | **open — data layer already built, needs presentation** |

### 5.15 — Restored word menu (done, #17)

5.11 replaced WKWebView's right-click menu over a single word with a one-item
`Thesaurus…` menu, which removed the standard editing items and the spell-check
actions from the place writers use them most. This restores them on the same
menu: `Thesaurus…`, a rule, native Cut / Copy / Paste / Select All, a rule, then
Learn (or Unlearn) and Ignore Spelling. Cut/Copy/Paste must stay *native* items —
`onPaste` only runs because the browser raises the paste event, and JS cannot
synthesise a paste with clipboard contents. Spelling is app-owned via
`NSSpellChecker`: learn is global, ignore is per spell-document tag and uses
WKWebView's own `_spellCheckerDocumentTag`. Look Up and Change Spelling are
WebKit's own and have no API, so they stay lost; this item absorbs 5.14.

### 5.16 — Word cloud

A word cloud of the words a manuscript uses most, minus the ones every manuscript
uses most: articles, conjunctions, pronouns, the usual stopword set. Two open
questions before a spec: does the frequency count stay in the renderer (a tokenizer
over the current document) or move to Rust (where it survives a large file without
blocking the main thread), and does the stopword list need to follow the document
language. Needs a tokenizer and a curated list — a real feature, not a garnish on
5.4's graph.

### 5.17 — Summary / outline view

The hard half of this is already built and is not in the UI where a writer would
reach for it:

- `src-tauri/src/summary.rs` — `build_summary_request`, `plan_resummarize`,
  `retrieve_summaries`, `retrieve_stale_summary_section_ids`. Summaries are
  generated per section, stored in the 4.7 sidecar, and staleness is tracked.
- `src/composables/useSummaries.js` — `refreshSummaryStatus`, `summarizeOne`,
  `generateSummaries`, `refreshStaleSummaries`.
- `LlmPanel.vue` renders them as a flat list inside the LLM panel's "Summaries" mode.

What is missing is presentation: a view that puts each section's synopsis beside its
title in document order, so the outline becomes a readable overview of the manuscript
rather than a list of headings. That pairs naturally with the drag-reorderable outline
from 5.5. Scope it around the existing data: no new generation, no new storage.

### 5.4 — Writing stats (done, #19)

A left-drawer "Stats" item: the writer sets a daily word target and sees a
hand-rolled CSS bar of today's progress against it, plus the number in words.

The open questions above were resolved in the spec. A *session* is a **calendar
day**, not launch → quit (macOS apps are not quit, so the number would be
unbounded) and not an idle-delimited stretch (a per-session target is farmable:
stop for lunch, meet the target twice). The target lives in `localStorage`
(`rite-word-target`), app-global like every other preference, not per-manuscript.
Progress is "words written today", not "words in the manuscript", so a per-document
day-start baseline is stored (`rite-word-baseline`) and `useWordCount` stays the
single source of the count. No charting dependency was added.

### 5.7 — Accessibility pass

**Platform constraint, answered up front:** Rite renders in WKWebView, so the
accessibility tree is WebKit's own and VoiceOver reads the app to exactly the
depth the markup allows — Tauri itself adds nothing and blocks nothing
(tauri-apps/tauri#207: "as accessible as the underlying web view"). One caveat
is worth writing down: native `<select>` popups stop being exposed to VoiceOver
when the app creates a tray icon (tauri-apps/tauri#15221). Rite has no tray icon
today and six `<select>` elements, so adding one later would silently break
those for screen-reader users.

The app-side gaps, in rough priority order:

1. **The editor has no accessible identity.** `editorDisplay.vue` is a bare
   `contenteditable="true"` div: no `role="textbox"`, no `aria-multiline`, no
   label. It should announce as a multi-line field named after the document,
   and the manuscript's sections should be reachable as headings.
2. **Formatting buttons are keyboard-unreachable.** Bold/Italic/Underline carry
   `tabindex="-1"` to keep the caret in the editor. Cmd+B/I/U mitigate this, but
   they still need a name and an announced state (`aria-pressed`).
3. **Clickable non-buttons.** Navigation rows, history rows and the settings
   section headers are `div`/`li` with `@click` — no role, no tab stop, no
   Enter/Space. Each needs to be a real `button`, or gain role + tabindex + key
   handlers.
4. **Names.** 59 `<button>` elements against 24 `aria-*` attributes in six of
   roughly fifteen components. `ActivityBar`'s icons rely on `title` alone; a
   tooltip is not an accessible name.
5. **No landmarks, no skip link, no `prefers-reduced-motion`.** The app is one
   scrolling column of divs, so the VoiceOver rotor has nothing to jump between,
   and the drawer and format animations ignore the reduced-motion setting.
6. **Focus visibility.** Eight `outline: none` rules; those inputs re-style their
   border on `:focus`, but nothing uses `:focus-visible`, so mouse and keyboard
   get the same ring. Audit while in there.

Scope note: this is a markup and CSS pass, not a redesign. No new dependency.

### 5.13 — Colour picker consolidation

The theme swatches currently live in the StatusBar (`StatusBar.vue` owns the
picker and its open/closed state), while font, zoom, margin and manuscript
format live in `TextOptionsDrawer.vue`. Move the picker into that drawer so all
text-appearance controls are in one place, and remove the status-bar copy.
Not a feature — a UI consolidation, but it touches `StatusBar.vue`,
`TextOptionsDrawer.vue`, `App.vue` and `StatusBar.spec.js`.

---

## Phase 6 — release polish

Fine-tuning for an initial release. No new product features here; if something
in this phase turns out to be a feature, it belongs in Phase 5 instead.

| ID | Item | Status |
|---|---|---|
| 6.1 | ~~History diff next/previous change~~ | **moved to 5.12** |
| 6.2 | History flow redesign (change counts, compare-then-restore) | open |
| 6.3 | PDF export | open — **blocked on a decision**: webview print vs `export_pdf.rs` in Rust |
| 6.4 | Error-handling sweep (`console.error` → user-visible reporting) | open — 14 sites remain |
| 6.5 | Release / build packaging (icons, signing, notarization, updater) | partly — `identifier: com.rite.app` set |
| 6.6 | Manuscript view unification (use the 5.6 composables) | open |
| 6.7 | Final accessibility + manual QA | blocked on 5.7 |

---

## Not on the roadmap

- **Per-change revert** — deferred when version history landed; pairs naturally
  with 5.12/6.2 if it is ever revived.
- **Segmented editor** — dropped, not deferred. 2.5 + 5.6 solved the problem a
  different way.
