# 5.20a — References: the drawer is the outline, the page is the selection

Approved sentence list for the spec-to-tests stage. The tests are written and
red; they define what "done" means. This file is the implementer's whole
context.

Supersedes part of 5.20 (`SPEC-5.20-references.md`, kept intact as the record of
what shipped). This is the same move 5.20 made against 5.17 S-013.

## Context

### Why this exists

5.20 shipped the summary data into a References view, and the view was reviewed
in the running app. Four things were wrong with it:

1. **The activity bar vanished.** `src/constants/drawerVisibility.js` lists
   `editor`, `manuscript` and `history`; `references` is absent, and
   `ActivityBar.vue` filters every icon through `isDrawerModeAllowedIn()`. An
   unlisted view resolves to "no drawer applies here", so the whole rail
   disappears and any open drawer closes on the way in.
2. **The summary could not reach the note.** `NotesView.vue` already has a
   `recaps` prop, a `.note-recap` block and an "Insert into note" button
   (`insertRecap`). `ReferencesView.vue` never binds `recaps`, so the block never
   renders. Nothing in 5.20 asked for it, so nothing caught it.
3. **"Go to section" landed a page early.** `onReferencesJump` →
   `nav.scrollToSection` → one `nextTick` → `editorDisplay.scrollToSection` →
   `focusPageStartInSheet(el, 'smooth', 'center')`. The smooth scroll starts
   before the freshly mounted sheet has finished layout, and `center` gives no
   page alignment to recover to. The tests could not see it: `references-outline`
   S-024 and `notes-view` S-017 assert only `toBeInViewport()`, which a
   page-early landing satisfies.
4. **The view was structurally confused.** An on-page tab strip (Outline |
   Notes), a second list inside the page, and unstyled browser buttons
   (`OutlineView.vue` has no `<style>` block at all).

The approved mock-up is `~/Projects/rite-mockups/reference-view.html`, with the
state coverage in `reference-view-v3.html`. This spec is that mock-up, not a
redesign of it.

### The shape

- **The drawer is the outline.** One drawer, titled References, listing Story
  overview, then the manuscript in document order with each chapter's own row
  standing as its heading, then Orphaned notes. A row selects; it never
  navigates. Group labels were removed after a review of the running app: a
  chapter name appeared twice, once as a label nothing could select.
- **The page is the selection.** One detail page per selected entry: the note
  (rendered markdown), the generated recap beneath it, the pencil, and
  "Go to text". Your note and its recap are the same page.
- **The three surfaces are a segmented control in the drawer head** — Outline
  today, Characters (5.19) and Glossary later. Only Outline is built here; the
  other two are ghosted so the shape is real and nothing pretends to work.
- **The rail stays.** References is the drawer mode for this view; Sections and
  Text Options do not apply there.
- **"Go to text"** returns to the view the writer came from and lands with the
  section's title at the top of the viewport.

### Superseded sentences

| 5.20 / 5.17 sentence | Was | Becomes |
|---|---|---|
| 5.20 S-002 | an on-page tab strip of Outline and Notes | one drawer surface control; no tab strip |
| 5.20 S-007 … S-021 | the outline list and its summaries live on the page | the list is the drawer; the page is one selection |
| 5.20 S-023 … S-028 | e2e against the on-page list and tabs | e2e against drawer rows and the detail page |
| 5.17 S-001, S-019, S-020 | the notes list lives inside `NotesView` | the same rows live in `ReferencesNavDrawer` |

5.17 S-002 … S-006, S-021 … S-026 (note reading, editing, recap label, insert,
dirty-draft commit, jump placement) survive unchanged; their tests move from clicking a row inside `NotesView` to
rendering the entry the drawer selected. What the list contains, and where it is
drawn, is the drawer's business.

### What already exists — reuse it, do not rebuild it

- **`NotesView.vue`** already renders the detail: `.note-head` with `.note-title`
  and `.note-jump`, `.note-rendered` / `.note-source`, `.note-recap` with
  `.note-recap-label` and `.note-insert-recap`, the pencil/save/reset cycle, and
  the dirty-draft commit on selection change and unmount. Its editing and recap
  behaviour is already correct — change as little of it as the sentences
  require. What it cannot keep is a *second* list: while References is open the
  drawer is the only list on screen (S-005, S-009), so the page shows the
  selection. How the shipped list markup gets reused — or where it moves to —
  is yours to decide.
- **`useNotes.js`** owns `noteEntries(store.doc)` (overview, sections, orphaned,
  in order) and `readNote`. `noteEntries` already returns the order S-005 needs;
  what it does not return is the chapter grouping.
- **`useSectionFormat.js` → `sectionDisplayTitle(section, chapterIndex)`** is the
  naming rule: a chapter's stored title is its subtitle and may be `''` (5.9), so
  an untitled chapter reads `Chapter 1`. Do not derive a title any other way.
- **`useSummaries.js`** gives `summaryEntries`, `summaryProgress`, `summarizeOne`,
  `generateSummaries` and `refreshStaleSummaries`. The view calls these; it must
  not reimplement them.
- **`retrieve_summaries` skips unsummarized sections** (`build_summary_entries`
  does `let Some(summary) = … else { continue }`). Its list is "summaries with
  their sections", not the reverse. Join from the document, never from the
  summaries.
- **`llmConfigured(settings)`** in `useLlmSettings.js` is the generation gate. A
  model, never an API key.

### DOM contract the tests pin

Only the selectors below are contract, and each one either already ships or is
this app's own convention (`.drawer-heading`, `is-*` row states). Anything not
listed here — component names, props and emits, file layout, class names not in
the table, CSS — is **not** prescribed: match the component you are touching and
the rest of the app, and do not restyle or restructure a shipped surface to fit a
shape invented by this spec. If you deviate from a suggestion in this file, say
so in the PR instead of silently following it.

| Selector | Meaning |
|---|---|
| `.references-view` | the detail surface root (keeps its theme binding) |
| `.references-drawer` | the drawer content root |
| `.notes-entry[data-entry-id]` | a drawer row (reused from the shipped list) |
| `.notes-entry.is-chapter` / `.is-section` / `.notes-orphans` | row kind |
| `.notes-entry.selected` | the selected row |
| `.notes-entry.is-anchor` | the row the writer came from (a state, like `.selected`; the dot is CSS) |
| `.notes-view` | the detail page |
| `.note-recap`, `.note-recap-label`, `.note-insert-recap` | the recap and its port |
| `.note-recap-empty` | the recap slot when there is nothing to show |
| `.note-generate`, `.note-options-link` | the two gates inside it |
| `.note-recap-stale`, `.note-regenerate` | staleness and its per-section trigger |

One caveat, stated plainly: the unit tests mount each component directly, so the
prop names they pass are pinned too — `NotesView` / `ReferencesView` take
`entryId`, the drawer takes `selectedId` and `anchorId` and emits `select`,
`ReferencesView` emits `jump`. These names are the tests' business, not a design
preference; keep them, or change both the test and this note in the same commit.

### Three traps this spec exists to avoid

1. **Do not delete the shipped note behaviour while moving the list out.** The
   dirty-draft commit on selection change and unmount is what stops a writer
   losing a paragraph by clicking a row. It stays, and it follows the new
   selection prop.
2. **The anchor is not the selection.** The anchor is the section the writer came
   from; the selection is what the page shows. They start equal and diverge as
   soon as the writer browses. The drawer marks the anchor row (`.is-anchor`);
   the selected row is the highlighted one (`.selected`). They are two states on
   the same row markup, and one row can never be mistaken for the other.
3. **A retired row has no section and no recap.** It selects the orphaned draft;
   its page shows the draft and no recap block. Do not fall back to the last
   section's summary.

## Sentences

| ID | Layer | Sentence |
|---|---|---|
| S-001 | unit | it should offer Reference, Stats and Options in the activity bar in the References view |
| S-002 | unit | it should not offer Sections or Text Options in the References view |
| S-003 | e2e | it should open the Reference drawer when References is entered, and let the Reference button close and reopen it |
| S-004 | unit | it should render the entry it is given, so the selection survives a view switch |
| S-005 | unit | it should list Story overview first, then every manuscript section in document order with each chapter's own row standing as its heading, then Orphaned notes last |
| S-006 | unit | it should indent a section row under its chapter and keep a chapter row bold |
| S-007 | unit | it should name each row with `sectionDisplayTitle`, so a chapter with no subtitle reads "Chapter 1" and never blank |
| S-008 | unit | it should mark the row of the section the writer came from as the anchor, and mark no other row |
| S-009 | unit | it should report a row as selected when it is clicked and never leave References |
| S-010 | unit | it should fall back to Story overview when the selected section is deleted |
| S-011 | unit | it should show the selected section's title and a subtitle naming its chapter and type |
| S-012 | unit | it should show the selected section's note as rendered markdown |
| S-013 | unit | it should show the story overview for the overview row and the orphaned note for the Orphaned notes row |
| S-014 | unit | it should label the generated summary "Assistant recap · read-only" and place it below the note |
| S-015 | unit | it should append the recap to the note draft when Insert into note is chosen, and not save it |
| S-016 | unit | it should show no recap block for a section with no stored summary, and none for a retired row |
| S-017 | unit | it should edit the selected note with the pencil, keeping Save and Reset, and commit a dirty draft when the selection changes or the view unmounts |
| S-018 | unit | it should offer Generate summaries in the recap slot when no summary exists and a model is configured, calling `generateSummaries` |
| S-019 | unit | it should show no generation control when no model is configured, and point at General Options instead |
| S-020 | unit | it should mark a stale recap and offer Regenerate for that section only, using `summarizeOne` |
| S-021 | unit | it should show an empty state in the drawer and the overview page for a document with no sections, and no error |
| S-022 | e2e | it should open References and show the drawer rows in document order, with the selected section's note and recap on the page |
| S-023 | e2e | it should select another chapter in the drawer and show that chapter's note without leaving References |
| S-024 | e2e | it should insert the recap into the note, save it, and keep it after reopening the file |
| S-025 | e2e | it should return to the view the writer came from on Go to text, with the section's title at the top of the viewport |
| S-026 | e2e | it should keep the rail and the drawer visible in References, and paint the detail page with the active theme |
| S-027 | e2e | it should name the anchor section in the status bar while References is open |
