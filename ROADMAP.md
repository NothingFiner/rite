# Rite — Roadmap

Status as of **2026-11-07**. Phase 5's most recent shipped item is **5.17** (Notes view, #32); 5.16, 5.19 and 5.20 remain open, and Phase 6 is release polish. This line names no commit or `development` hash on purpose: it was stale three times in one day, because a hash in a file goes out of date on the next merge.

Tauri v1 → v2 migration landed as PR #15 — a prerequisite for 5.11's context menu, not a roadmap item of its own.

**Numbering rule:** IDs are stable. A moved item keeps a pointer at its old ID instead of being renumbered, so commit messages, branch names and old notes stay resolvable. New work takes the next free number in its phase.

**Bugs** live in `BUGS.md` under `B-###` IDs, not in this table. A bug needing product decisions is promoted to a roadmap item and keeps its `B-ID` as the pointer — this file says where the work sits, `BUGS.md` says what broke and why. A fix commit names its `B-ID`.

**Words** have one meaning each. `VOCABULARY.md` is the authority: the source/cache split, the reference concepts, and the synonyms that are banned. Read it before naming anything in a spec, a PR title or a UI string.

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
| 5.17 | Notes view: story overview and per-section notes | done (#32) |
| 5.18 | Tab characters + fixed 0.5-inch tab stops, with a Tab-set first-line indent | done (#22) |
| **5.19** | **`[[…]]` links, characters in chapters, and custom words with where they are used** | **open — own data model; deferred by 5.17's spec** |
| **5.20** | **References view: an Outline tab with each section's summary beside its title, and the notes as a second tab (was 5.17)** | **open — specced (#40), tests written and red** |

**Renumbered 2026-11-07.** The Notes view shipped under the ID **5.17** — its spec,
its commit (`7468024`) and `src-tauri/src/notes.rs` all say 5.17 — which collided
with the summary/outline item that had held that number, still listed as open here.
The shipped item keeps 5.17, because three artifacts already name it; summary/outline
moves to 5.20 and keeps its pointer; and the `[[…]]` links / characters / custom-words
work that 5.17's spec deferred takes the 5.19 its spec already named. No commit message
or branch name was wrong — only this table was behind.

### 5.17 — Notes view (done, #32)

A fourth top-level view — **Editor, Manuscript, Notes, History** — holding one
document-level story overview, one note per section, and a single orphaned-notes
draft for deleted sections. Notes are a document-level record stored beside the
document in the `.rite` file and deliberately **not** part of `Document`, so they
stay out of the text exports, the word count and the version-history snapshots.
Rendered markdown is the default reading mode; the pencil edits, and the macOS
menu's Undo unwinds the draft without moving the manuscript's undo stack.

The assistant gains a **Notes** scope that *reads* notes as context. It does not
create them: `llm.rs` has no tool calling, and 5.17's spec rules AI generation out
of scope. Anything that lets the assistant write a note is new work, not a
follow-on.

Section names in the list and in note headings come from `sectionDisplayTitle`
(`useSectionFormat.js`), the rule the navigation outline already used:
"Chapter 3: Ash", "Chapter 3" for a subtitle-less chapter, "Untitled Section" for
a blank section. Never render `section.title` raw — for a Chapter it is only the
subtitle and is legitimately blank (5.9).

Where the proof lives: sentences **S-001–S-026** in `SPEC-5.17-notes.md`; unit
tests beside the code (`useNotes.test.js`, `NotesView.spec.js`), the notes record's
Rust integration tests in `src-tauri/tests/notes.rs`, and `e2e/notes-view.spec.js`
end to end. Two of those sentences were not wired when 5.17 shipped: S-007 and
S-009 pass their unit tests because the tests call the helpers directly, and
nothing in the app did. They are **B-001** and **B-002** in `BUGS.md`; the wiring
is specced in #38.

### 5.19 — `[[…]]` links, characters in chapters, custom words (open)

Deferred by 5.17's spec because it needs its own data model rather than an
extension of the notes record: inline `[[…]]` links, a cast of characters attached
to chapters, and a custom-word list that records where each word is used.

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

### 5.20 — References view (was 5.17)

The top-level views are **Editor, Manuscript, References, History**. References
holds the notes' material as tabs, and the notes are not a view of their own:
**Outline** and **Notes** are the first two, and Characters joins them in 5.19.
The glossary's home is still undecided.

Outline puts each section's summary beside its title in document order, so the
outline reads as an overview of the manuscript rather than a list of headings.
Its rows come from the document rather than from `retrieve_summaries`, because
that command leaves out every section with no summary, and an outline with holes
is not an outline.

The hard half of this is already built and is not in the UI where a writer would
reach for it:

- `src-tauri/src/summary.rs` — `build_summary_request`, `plan_resummarize`,
  `retrieve_summaries`, `retrieve_stale_summary_section_ids`. Summaries are
  generated per section, stored in the 4.7 sidecar, and staleness is tracked.
- `src/composables/useSummaries.js` — `refreshSummaryStatus`, `summarizeOne`,
  `generateSummaries`, `refreshStaleSummaries`.
- `LlmPanel.vue` renders them as a flat list inside the LLM panel's "Summaries" mode.

What is missing is presentation. Scope it around the existing data: no new
generation, no new storage, no Rust change. `retrieve_summaries`'s empty-store
error stays, because the Summaries feedback target depends on it. A view reads
that error as "nothing generated yet". The view may trigger generation, so the
empty state offers "Generate summaries" and a stale summary offers "Refresh
stale", but only when a model is configured. That is the gate the assistant panel
already uses. The Sections drawer and 5.5's drag-reorder are untouched.

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
| **6.8** | **Never record a history checkpoint that has no delta** | **open** |
| 6.9 | Bug log (`BUGS.md`): stable `B-###` IDs, cross-referenced from commits and specs | done |

### 6.8 — No checkpoint without a delta

A version in the history must mean the manuscript *changed*. Today it does not:
`state.rs::append_history_snapshot` pushes a full `Snapshot` and compacts without
comparing anything, and it is the path behind both explicit save
(`commands.rs::save_document`) and the manual checkpoint
(`commands.rs::save_snapshot`). Only autosave (`append_history_delta`) is guarded —
`doc_ops_between` returning empty makes it `Ok(false)` and it writes nothing.

So Cmd+S on an untouched manuscript, or a checkpoint taken twice, files a whole
duplicate `Document` into the embedded history. Consequences: the `.rite` grows by
a full document per no-op save; the history list shows rows a writer cannot tell
apart; 5.12's next/previous-change navigation has nothing to land on; and
`compact_history` pays for it by evicting real history to stay under `max_snapshots`.

**Rule:** a checkpoint or save records a version only if the document differs from
the newest recorded state. If it does not, record nothing — no snapshot, no delta,
no duplicate row — and do not rewrite the `.rite` for it. This applies to save and
manual checkpoint alike; "I asked for a checkpoint" is not a reason to store a
version that is byte-identical to the one before it.

The comparison source is the newest recorded state, which is the newest snapshot
plus the deltas after it — or equivalently `last_history_state`, the baseline
autosave already maintains, when it is valid. Do not compare against "the last
snapshot": a delta run since then may already hold this state, and the correct
answer in that case is *no new record*, not a fresh snapshot.

Two cases must keep a record, and they are not exceptions to the rule — they are
deltas from nothing:

- **Empty history** (first save of a document): there is no prior state, so the
  first snapshot is the only restore point there will ever be. Record it.
- **A different target path** (Save As): the new file needs its own complete
  document, so it is written even when the content is unchanged. Only the history
  record is skipped.

Interacts with 5.12 (change navigation) and 6.2 (history flow redesign: change
counts, compare-then-restore) — both assume a row in the list is a real change.
Lands as a Rust unit-level change in `AppState`, with the frontend only learning
that a checkpoint may report "no change" instead of a new timestamp.

---

## Not on the roadmap

- **Per-change revert** — deferred when version history landed; pairs naturally
  with 5.12/6.2 if it is ever revived.
- **Segmented editor** — dropped, not deferred. 2.5 + 5.6 solved the problem a
  different way.
