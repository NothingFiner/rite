# 5.20 — References view: the outline, with each section's summary beside it

Approved sentence list for the spec-to-tests stage. The tests are written and
red; they define what "done" means. This file is the implementer's whole
context.

Supersedes one shipped sentence of 5.17 (see *What this changes*). The 5.17 spec
is `SPEC-5.17-notes.md` and is left intact as the record of what shipped.

## Context

### What this is

The summary data layer is built and nothing in the UI uses it. `src-tauri/src/summary.rs`
generates one neutral recap per section and stores it in the 4.7 sidecar;
`retrieve_summaries` reads it back for free; staleness is tracked per summary.
`LlmPanel.vue` shows the recaps as a flat list inside the assistant's
"Summaries" mode — not where a writer drafting a novel looks.

5.20 puts them beside the headings, in document order, so the outline reads as an
overview of the manuscript. **No new generation, no new storage, no Rust change.**
Every sentence below is satisfied by reading what already exists and presenting
it.

### The References IA (decided in review, recorded here for the first time)

The top-level views become **Editor | Manuscript | References | History**. Notes
is no longer a top-level view: it is a tab inside References, beside Outline.
`Characters` joins the same view in 5.19; the glossary's home is still undecided
and this spec does not settle it.

That makes one 5.17 sentence false — "opens Notes as a fourth view" (5.17 S-013)
— and its test, `e2e/notes-view.spec.js`, must be updated to the new path. Its
assertions about the notes surface are unchanged. Likewise 5.17 S-010 in
`src/components/Toolbar.spec.js` ("renders Editor, Manuscript, Notes and History
in that order") becomes Editor / Manuscript / **References** / History.

### What already exists (read it before writing code)

- **`src/composables/useSummaries.js`** — `summaryStatus`, `summaryProgress`
  (`{ done, total, stale }`), `summaryError`, `summariesBusy`, and the four
  triggers `refreshSummaryStatus`, `summarizeOne`, `generateSummaries`,
  `refreshStaleSummaries`. Generation is user-triggered and one LLM call per
  section. **The view calls these; it must not reimplement them.**
- **`summary.rs` → `retrieve_summaries`** returns `SummaryEntry[]`:
  `{ sectionId, chapterIndex, title, sectionType, summary, stale }`, already in
  manuscript order.
- **`src/composables/useSectionFormat.js`** — `sectionDisplayTitle(section,
  chapterIndex)` is the single naming rule: a Chapter's stored `title` is only
  its subtitle and may legitimately be `''` (5.9), so an untitled chapter
  displays as `Chapter 1`, never blank. `chapterPrefix(index)` exists too.
  Do **not** derive a title any other way.

### Three traps this spec exists to avoid

1. **`retrieve_summaries` skips sections that have no summary.**
   `build_summary_entries` does `let Some(summary) = … else { continue }`. Its
   list is "summaries with their sections", not "sections with their summaries".
   Rendering it directly would silently drop every unsummarized section — the
   same class of bug as B-003's blank chapter rows (a map with invisible holes).
   **So the rows come from the document**, and each row looks its summary up by
   `sectionId`. Sections with no summary still get a row.
2. **An empty summary store is an `Err` by design.** `retrieve_summaries`
   returns an error when nothing has been generated, because the *Summaries*
   feedback target must not send an empty context that pretends to be summaries.
   For a *view*, empty is a normal first-run state. Treat it as "nothing
   generated yet" — do not surface it as a failure, and **do not change the Rust
   command** (the chat path depends on that error).
3. **Model output must be labelled.** `VOCABULARY.md`: the writer writes source,
   the model writes cache, and model output is labelled where it appears in the
   UI. A summary sitting beside a section title — or beside a writer's note —
   with no label is B-004, which this spec also fixes.

### The generation gate: a configured model, not a key

The roadmap's reachability complaint is that summaries are somewhere a writer
would not look. So the view may trigger generation — but only where generation
can work.

The gate is **`settings.model` non-empty**, matching the rule the assistant
panel already uses (`LlmPanel.vue:57` gates on `!settings.settings.model`, and its
input placeholder says "Configure a model in General Options…"). It is *not* the
API key: `useLlmSettings` defaults to `http://localhost:11434` with an empty key,
local Ollama needs no auth, and `summarizeOne` already sends `apiKey: '' ||
null` for exactly that case. A key-only gate would hide generation from the
default install.

Expose the predicate as `llmConfigured(settings)` from `useLlmSettings.js` so the
view and the panel read one rule.

### Vocabulary (from `VOCABULARY.md`)

- The tab is **Outline**: derived structure — headings and their order.
- The model's text is a **summary** — not a "recap", "synopsis", "AI note" or
  "checkpoint".
- The writer's text is a **note**. A summary is never a note and never becomes
  one: there is no "insert into note" action here.
- Nothing in this view writes to `Document` or to the notes record.

## Wiring decisions

1. **Modes.** `viewMode` values become `editor | manuscript | references |
   history`. `Toolbar.vue`'s `VIEW_MODES`, its tab list and `App.vue`'s branches
   move `notes` → `references`, keeping four tabs in the same order and
   Cmd+1–4 unchanged.
2. **`ReferencesView.vue`** owns the tab strip. Props: `store`, `theme`,
   `tab` (String, default `'outline'`), `notesEntryId`, `notesOriginView`.
   Emits: `update:tab`, `jump`. It is a *controlled* component — it renders the
   tab it is given and reports clicks with `update:tab`, so `App.vue` holds the
   selection and it survives a view switch (S-004, S-005).
3. **`OutlineView.vue`** renders the rows. Props: `store`, `summaries` (the
   `useSummaries` object), `settings` (the raw llm-settings composable).
   Emits: `jump` (a section id). It calls `summaries.generateSummaries()` /
   `summaries.refreshStaleSummaries()`; it never calls `invoke` itself.
   **`useSummaries` gains `summaryEntries`** — the `retrieve_summaries` array,
   kept by `refreshSummaryStatus` from the read it already does (no extra
   `invoke`, and its existing catch already turns the empty-store error into
   "nothing here yet"). The view reads text from `summaryEntries` and calls
   `refreshSummaryStatus()` once on mount so the tab is current when opened.
4. **`outlineRows(doc, entries)`** in `src/composables/useOutlineRows.js` is the
   pure join: every section of `doc`, in document order, with
   `{ sectionId, title, chapterIndex, hidden, summary, hasSummary, stale }`.
   `title` uses `sectionDisplayTitle`. `entries` is `retrieve_summaries`'s
   array; a row with no matching entry has `summary: ''`, `hasSummary: false`,
   `stale: false`.
5. **Class hooks the tests use** (do not rename):
   - `ReferencesView`: `.references-view`, `.references-tabs`, `.references-tab`
     with `data-tab="outline" | "notes"`, plus the mounted child's own root
     (`.outline-view` or `.notes-view`).
   - `OutlineView`: `.outline-row` with `data-section-id`, `.outline-title`,
     `.outline-summary`, `.outline-summary-label`, `.outline-stale`,
     `.outline-hidden`, `.outline-empty` (no sections),
     `.outline-awaiting` (store empty), `.outline-generate`,
     `.outline-refresh-stale`.
6. **Read-only.** No `<input>`, `<textarea>` or `contenteditable` in the
   outline, and no action that writes a summary into the document or the notes
   record. A row click only emits `jump`; `App.vue` opens that section in the
   editor (the same route a note's "Go to section" uses).

## Sentences

| ID | Layer | Sentence |
|---|---|---|
| S-001 | unit | it should offer **References** in the toolbar in place of **Notes**, keeping four view buttons and the same Cmd+1–4 order |
| S-002 | unit | it should open a References view with a tab strip of **Outline** and **Notes**, Outline selected by default |
| S-003 | unit | it should show the existing notes working surface unchanged on the Notes tab — same component, same editing, same jump |
| S-004 | unit | it should keep the selected tab when another view is opened and References is chosen again |
| S-005 | unit | it should return to References with the Notes tab still selected after a section jump from a note |
| S-006 | unit | it should paint the References surface with the active theme, matching the notes surface |
| S-007 | unit | it should list every section in document order, one row per section, including sections with no stored summary |
| S-008 | unit | it should name each row with `sectionDisplayTitle`, so a chapter with no subtitle reads "Chapter 1" and never blank |
| S-009 | unit | it should show each section's stored summary beside its title |
| S-010 | unit | it should show a "No summary yet" placeholder for a section with no stored summary, never an empty row |
| S-011 | unit | it should mark a row whose summary is stale and leave a current row unmarked |
| S-012 | unit | it should label every summary as model output, so it cannot be read as the writer's own text |
| S-013 | unit | it should show a hidden section's row with a hidden marker rather than omitting it |
| S-014 | unit | it should be read-only: no editable field, and no action that writes a summary into the document |
| S-015 | unit | it should follow a section being added, deleted or moved without the view being reopened |
| S-016 | unit | it should show a "nothing to outline" empty state for a document with no sections, and no error |
| S-017 | unit | it should treat an empty summary store as "nothing generated yet", not surface `retrieve_summaries`' empty-store error as a failure |
| S-018 | unit | it should open that section in the editor when a row is chosen |
| S-019 | unit | it should offer "Generate summaries" in the empty state only when a model is configured, and it should call the existing `generateSummaries` |
| S-020 | unit | it should offer "Refresh stale" only when at least one summary is stale and a model is configured, and it should call the existing `refreshStaleSummaries` |
| S-021 | unit | it should show neither generation control when no model is configured, and the empty state should point at General Options instead |
| S-022 | unit | the Notes view should label the generated summary it shows beside a note, so model text and the writer's note are distinguishable (B-004) |
| S-023 | e2e | it should open References from the toolbar and show the Outline tab with each section's title and its summary in document order |
| S-024 | e2e | it should open the section in the editor when its Outline row is chosen |
| S-025 | e2e | it should still open, edit and save a note on the Notes tab inside References |
| S-026 | e2e | it should paint the References view with the active theme's colours, matching the notes surface |
| S-027 | e2e | it should show a subtitle-less chapter's Outline row as "Chapter 1" with its summary labelled, so neither is blank or unattributed |
| S-028 | e2e | it should show the generation controls only when a model is configured |

S-004 and S-005 are covered at both layers: the unit test pins the controlled
`tab` prop and the `update:tab` event that make persistence possible, and the e2e
tests pin the round trip through a real view switch.

S-028 is superseded in part. The whole-manuscript Regenerate all control moved
from this drawer to the Assistant panel (5.19a S-045), because it refreshes the
entire manuscript rather than anything in References. The gate it described — a
control that appears only when a model is configured — still holds for the
per-section regenerate on a recap, which remains in the Notes surface. The two
unit tests that pinned the bulk control's presence in this drawer were removed
with the move; its new home is pinned in `LlmPanel.spec.js`.

One e2e sentence in `e2e/references-outline.spec.js` is also superseded. It
asserted that the References rail button closes the drawer and reopens it.
5.19a makes that panel the view's navigation, permanent while References is
active (its S-049 to S-052), so the drawer can no longer be toggled shut there.
The close-and-reopen half of the test is gone; what remains pins the two things
5.20 still owns — the drawer opens on entry, and the rail offers its handle.
The panel's new permanence is pinned in `e2e/references-entries.spec.js`.

## Out of scope

- Any Rust change. `retrieve_summaries`' empty-store error stays.
- New storage, a schema bump, or a migration.
- Generating summaries anywhere new: the view calls `useSummaries`' existing
  triggers.
- Editing a summary in place, or inserting one into the manuscript or a note.
- Characters and Glossary tabs (5.19), and the glossary's home (undecided).
- Summaries in exports, word count, search or version history.
- The Sections drawer and 5.5's drag-reorder: untouched.

## File map

| Path | Change |
|---|---|
| `src/components/Toolbar.vue` | `notes` → `references` in the tab list and `VIEW_MODES` |
| `src/App.vue` | mount `ReferencesView` for `references`; hold the tab ref; route `jump` |
| `src/components/ReferencesView.vue` | **new** — tab strip over `OutlineView` and `NotesView` |
| `src/components/OutlineView.vue` | **new** — the rows, the states, the two triggers |
| `src/composables/useOutlineRows.js` | **new** — `outlineRows(doc, entries)` |
| `src/composables/useLlmSettings.js` | add `llmConfigured(settings)` |
| `src/components/NotesView.vue` | label the summary beside a note (S-022 / B-004) |
| `src/components/Toolbar.spec.js` | 5.17 S-010 updated to References |
| `e2e/notes-view.spec.js` | 5.17 S-013 updated to the References path |
| `src/components/ReferencesView.spec.js` | **new** |
| `src/components/OutlineView.spec.js` | **new** |
| `src/composables/useOutlineRows.test.js` | **new** |
| `e2e/references-outline.spec.js` | **new** |
