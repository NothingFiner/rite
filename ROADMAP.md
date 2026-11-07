# Rite — Roadmap

Status as of **2026-11-07**, `development` at `57982fb` (accessibility pass complete: 5.7a #29 and 5.7b #30 merged).

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
| 5.7 | Accessibility pass | done (#21, #29, #30) |
| 5.7a | Editor, toolbar and activity-bar semantics | done (#29) |
| 5.7b | Reduced motion, `:focus-visible`, landmarks and the `Ruler.vue` decision | done (#30) |
| 5.8 / 5.8a | Spellcheck (native squiggles + context menu) | done |
| 5.9 | Subtitle-less chapters | done |
| 5.10 | Hidden sections replace epigrams | done |
| 5.11 | Thesaurus | done (#16) |
| 5.12 | History diff next/previous change navigation | done (#25) |
| 5.13 | Color controls in Text Options: background, text and accent rows plus presets | done (#27) |
| 5.14 | `NSSpellChecker` spelling actions | absorbed into 5.15 |
| 5.15 | Restored word menu: Cut / Copy / Paste / Select All + Learn / Ignore Spelling | done (#17) |
| **5.16** | **Word cloud of frequently used words, excluding articles and pronouns** | **open — idea, not scoped** |
| **5.17** | **Summary / outline view: per-section synopses in a navigable overview** | **open — data layer already built, needs presentation** |
| 5.18 | Tab characters + fixed 0.5-inch tab stops, with a Tab-set first-line indent | done (#22) |

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

**Non-mouse navigation is the pass.** Two reasons it comes before anything else.
First, every screen-reader user on macOS drives VoiceOver from the keyboard, so a
keyboard gap *is* a screen-reader gap — reachability is the shared floor, and
naming only matters once you can get to the thing. Second, it is the only half of
accessibility this repo's test layers can hold: Playwright can Tab, Enter and
Escape and assert what happened; it cannot hear what VoiceOver says. Fix
reachability first, then naming and roles, then polish.

**Platform.** Tauri adds no accessibility layer of its own: the tree is
WKWebView's, so VoiceOver reads the app to exactly the depth the markup allows
(tauri-apps/tauri#207). One caveat to keep: creating a tray icon breaks VoiceOver
for native `<select>` popups (tauri-apps/tauri#15221) — Rite has six `<select>`
elements and no tray icon today, so adding one later would silently break them.

**Already keyboard-operable — do not regress.** The global shortcut layer is in
good shape: Cmd+B/I/U, Cmd+F, the Escape chain in `useKeyboardShortcuts.js`
(search → open drawer → focus mode, in that order), Enter/Shift+Enter in the
search panel, `PromptModal` focusing and selecting its input, Escape in the
thesaurus popover, and all four settings accordion headers being real `<button>`s.

**Mouse-only surfaces.** These carry `@click` on a `div` or `li`, so they have no
role, no tab stop, and no Enter/Space:

- ~~`NavigationDrawer.vue`~~ — done (#21): rows are real controls with a roving tabindex.
- ~~`HistoryListDrawer.vue`~~ — done (#21): entries are `li[role=button]` with `tabindex`.
- ~~`StatusBar.vue`~~ — gone: #27 deletes the picker, and the drawer's swatches are buttons.
- ~~`Ruler.vue`~~ — deleted in #30 with its spec: no component mounted it, so it was
  dead code with a live spec.

**Focus management.** Done in #21 for the drawers: opening one focuses its active
row, Escape returns focus to the opener, and Tab deliberately leaves (S-018). The
format buttons keep `tabindex="-1"` to keep the caret in the editor, with Cmd+B/I/U
as their route; #29 gives them a name and an `aria-pressed` state. `Toolbar.vue`'s
view tablist gained arrow-key navigation and a roving tabindex in #29.

**Then, naming and structure.** The editor (`editorDisplay.vue`) was a bare
`contenteditable="true"` div. #29 gives it `role="textbox"`, `aria-multiline` and
the fixed name Manuscript, and #30 turns section titles into level 1 and level 2
headings in both views, so the manuscript can be navigated by section.
`ActivityBar`'s icons now carry accessible names rather than relying on `title`
alone.

**Last, polish.** #30 adds the four landmark roles, a skip link that leads the tab
order, and a global `prefers-reduced-motion` query. It also replaces the
`outline: none` rules with a `:focus-visible` ring, so the keyboard sees focus and
a click does not.

Scope note: a markup, focus and CSS pass — not a redesign, and no new dependency.

**Split.** 5.7a is the semantics half: editor role and label, `Toolbar` tablist
behaviour, the format buttons' name and pressed state, `ActivityBar` names. 5.7b is
the CSS and structure half: `prefers-reduced-motion`, `:focus-visible`, landmarks and
skip link, and the `Ruler.vue` decision.

Both halves shipped: 5.7a in #29 and 5.7b in #30.

### 5.13 — Colour picker consolidation

The theme swatches lived in the StatusBar (`StatusBar.vue` owned the picker and
its open state), while font, zoom, margin and manuscript format lived in
`TextOptionsDrawer.vue`.

Shipped in #27, and larger than the note above: free hex entry was rejected
because a writer can set text and background to the same color and lose the
manuscript. Color is now three independent rows of swatches drawn from the
`THEMES` palette, one swatch per distinct color, plus one preset button per
theme. A color already chosen in another row is disabled, so the trap cannot be
re-entered. Persistence moved to `rite-bg` / `rite-text` / `rite-accent`, with
the old `rite-theme` index read as a fallback for existing installs.

---

## Phase 6 — release polish

Fine-tuning for an initial release. No new product features here; if something
in this phase turns out to be a feature, it belongs in Phase 5 instead.

| ID | Item | Status |
|---|---|---|
| 6.1 | ~~History diff next/previous change~~ | **moved to 5.12** |
| 6.2 | History flow redesign (change counts, compare-then-restore) | open |
| 6.3 | PDF export | open — **blocked on a decision**: webview print vs `export_pdf.rs` in Rust |
| 6.4 | Error-handling sweep (`console.error` → user-visible reporting) | open — 15 sites remain |
| 6.5 | Release / build packaging (icons, signing, notarization, updater) | partly — `identifier: com.rite.app` set |
| 6.6 | Manuscript view unification (use the 5.6 composables) | open |
| 6.7 | Final accessibility + manual QA | open — 5.7 is done, so the final pass can start |

---

## Not on the roadmap

- **Per-change revert** — deferred when version history landed; pairs naturally
  with 5.12/6.2 if it is ever revived.
- **Segmented editor** — dropped, not deferred. 2.5 + 5.6 solved the problem a
  different way.
