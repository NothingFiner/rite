# 5.17 — Notes view: story overview and per-section notes

Approved sentence list for the spec-to-tests stage. The tests are written and
red; they define what "done" means. This file is the implementer's whole
context.

## Context

### What this is

A fourth top-level view, **Notes**, reached from the toolbar like the History
view. It is a reference and outlining surface first: the default reading mode is
rendered markdown, not a text box. It holds one document-level **story
overview** note, one note per section, and a single **orphaned-notes draft** at
the bottom where notes from deleted sections are collected.

It works without an AI key. The AI only appears as an optional second layer:
the existing 4.8 per-section recaps are displayed read-only beside the note, and
the assistant gains a `Notes` scope that can read the notes.

### Where it sits in the app

- View modes are `editor`, `manuscript`, `history`; this adds `notes` and a
  fourth toolbar tab, in the order **Editor, Manuscript, Notes, History**.
- `App.vue` renders the main pane by mode. `HistoryView` already uses
  `v-if="viewMode === 'history'"`; Notes follows the same shape.
- `src/constants/drawerVisibility.js` gains a `notes` entry. Only
  `general-options` is reachable while Notes is showing, matching History.
- `useKeyboardShortcuts` and `useFocusMode` act only in `editor`, so they
  already ignore a new mode. Do not add editor-only behaviour to Notes.

### Data model

`Notes` is a document-level record, separate from `Document`:

```
{
  overview: String,
  sections: { "<sectionId>": String },   // markdown source, keyed by section id
  orphaned: String                        // one markdown draft for deleted sections
}
```

Section ids are the document's own ids. A section with no note simply has no key.

### Storage

Notes live inside the `.rite` file, not the sidecar and not localStorage. The
4.7 sidecar is a per-path cache whose module documents its contents as
derivable; notes are user-authored and must travel with the manuscript.

- `RiteFile` (in `src-tauri/src/history.rs`) gains
  `#[serde(default)] pub notes: Notes`.
- `AppState` holds `notes: Mutex<Notes>`.
- `AppState::build_rite_file` includes the notes, so the existing save and
  autosave paths persist them with no new write path.
- `open_document` loads the file's notes into state.
- Two commands: `retrieve_notes` (read) and `update_notes` (replace + mark the
  document modified).
- **Do not bump the `.rite` schema version in this change.** The field is
  additive with a default; the release pass owns the version bump and migration.
- Notes must never appear in `Document`, the text exports, the word count, or
  the embedded version-history snapshots. Version history is manuscript text.

### Editing model

Preview is the default. The pencil enters editing; while editing, a check
commits and a reset restores the last committed text. There is no create or
delete action for a section note: every section always has a note field. Reset
is deliberate and has no confirmation dialog.

Edits are a draft, not a keystroke-level autosave: the check commits the draft to
the store and marks the document modified, and the existing autosave then writes
the file. Leaving an entry or the Notes view commits a dirty draft. Cmd+Z and
Cmd+Shift+Z undo and redo the **draft** while editing.

**Undo routing is the one non-obvious part.** The macOS menu owns Undo and Redo
(`src-tauri/src/menu.rs` items `undo` / `redo`), and `useMenu`'s action map
routes them to `store.undo()` / `store.redo()` — the manuscript's model history.
A focused textarea never sees those keystrokes. To make note undo work, the
`undo` / `redo` actions must first ask the notes draft to consume the command
when an edit session is open, and only fall through to the document store
otherwise. The manuscript's history must not move while a note draft is undone.

### Markdown

`marked` and `dompurify` are already dependencies and already used by
`LlmPanel.vue`. Extract the rendering into a shared
`src/composables/useMarkdown.js` exporting `renderMarkdown(source)`, which
returns sanitized HTML (`breaks` and `gfm` on, raw HTML stripped). Use it for the
note preview. The source stays markdown in storage.

### Assistant scope

Add a `Notes` option to the Feedback Target select in `LlmPanel.vue` (sibling to
Summaries). Its context string comes from
`notesToText(notes, sections)` in `src/composables/useNotes.js`:

- a preamble that says these are the author's notes **about** the manuscript,
  not manuscript prose;
- the story overview first;
- every non-empty section note in document order, headed by the section title;
- no orphaned notes, because they describe text that no longer exists.

### Section jump and view carry-over

Opening Notes from the Editor selects the note for the section at the caret.
Opening it from the Manuscript selects the note for the section on the current
page. `DocumentRenderer` exposes `getCurrentPage()`, and `pageBreaks` are block
indices, so the section is the `sectionId` of the block at
`pageBreaks[page - 1]` (or block 0).

The section jump (a small control in the note header, immediately after the
title) behaves like clicking a section in the Sections drawer: it returns to
the text view the user came from — Editor or Manuscript — and scrolls to that
section. Remember the origin view when Notes is entered; from History default to
Editor. The list rows only select; they never navigate.

### Theme

The view and its rendered notes use the active theme the same way the editor
does: backgrounds, text and accent come from the app's theme variables. No new
palette values.

### Decisions

- The fourth tab supersedes the three-tab assertions in `Toolbar.spec.js`;
  that file is updated to the four-tab order as part of this spec.
- An open note draft is committed when the entry changes, when the check is
  used, and when the view unmounts. Reset is the only discard.
- The section jump appears immediately after `.note-title`, so the header
  reads title, jump, then the rest.

### Test selectors (the tests pin these)

| Selector | Meaning |
|---|---|
| `.notes-view` | view root |
| `.notes-list` | entry list |
| `.notes-entry` | one row; `data-entry-id` is `overview`, a section id, or `orphaned` |
| `.notes-entry.is-chapter` / `.is-section` | row kind |
| `.notes-entry.selected` | the active row |
| `.note-pane` | right-hand pane |
| `.note-head`, `.note-title`, `.note-sub` | pane header |
| `.note-jump` | section jump control, inside `.note-head` after the title |
| `.note-rendered` | default rendered markdown |
| `.note-empty` | shown when the entry has no text |
| `.note-edit` | pencil |
| `.note-save`, `.note-reset`, `.note-edit-divider` | check, reset, and the divider between them |
| `.note-source` | the markdown textarea |
| `.note-recap`, `.note-insert-recap` | read-only AI recap and its insert action |
| `.notes-orphans` | the orphaned-notes entry |

### Module and component contract (pinned by the tests)

`src/composables/useMarkdown.js`
- `renderMarkdown(source)` returns sanitized HTML.

`src/composables/useNotes.js`
- `emptyNotes()` returns the empty record.
- `noteEntries(doc)` returns `{ id, kind, title, sectionId }` rows: the story
  overview first, then every section in document order, then the orphaned
  entry last. `kind` is `overview`, `chapter`, `section` or `orphaned`.
  `sectionId` is set on section rows.
- `readNote(notes, id)` returns the stored markdown for an entry id.
- `writeNote(notes, id, text)` returns a new record; empty text removes the
  section key.
- `notesToText(notes, sections)` builds the assistant context.
- `orphanSectionNote(notes, section)` takes `{ id, title }`, appends
  `## <title>` and the note to `orphaned`, and removes the section key.
- The draft undo/redo controller that `useMenu`'s `undo` / `redo` actions ask
  first lives here; its name is the implementer's choice.

`src/components/NotesView.vue`
- Props: `store` (the document store), `theme` (the active theme's `{ bg,
  text, accent }`), `recaps` (`{ [sectionId]: summary }`), `initialEntryId`
  (default `overview`), `originView` (default `editor`).
- Emits: `select` (entry id), `jump` (section id).
- Reads `store.doc` and `store.notes`; commits through
  `store.commitNote(entryId, text)`.

`src/stores/document.js` gains a `notes` state field (the `emptyNotes` shape),
`retrieveNotes()`, and `commitNote(entryId, text)` which writes through the
`update_notes` command and calls `markModified()`. `App.vue` calls
`store.retrieveNotes()` when the app mounts and after a document is opened, so a
fresh launch shows the file's notes.

### File map

New: `src-tauri/src/notes.rs`, `src-tauri/tests/notes.rs`,
`src/composables/useMarkdown.js`, `src/composables/useNotes.js`,
`src/components/NotesView.vue`, `src/components/NotesView.spec.js`,
`src/composables/useMarkdown.test.js`, `src/composables/useNotes.test.js`,
`e2e/notes-view.spec.js`.

Edited: `src-tauri/src/{lib,history,state,commands}.rs`, `src/App.vue`,
`src/stores/document.js`, `src/components/Toolbar.vue`,
`src/components/LlmPanel.vue`, `src/constants/drawerVisibility.js`,
`e2e/helpers/tauri-ipc.mock.js`.

## Sentences

| ID | Layer | Sentence |
|---|---|---|
| S-001 | unit | it should list the story overview first and every section in document order, with chapter and section rows distinguishable |
| S-002 | unit | it should show the selected entry's note as rendered markdown in a read-only pane by default, with an empty state when the note has no text |
| S-003 | unit | it should render a markdown note to sanitized HTML, keeping headings, emphasis and lists and removing scripts and raw HTML |
| S-004 | unit | it should enter markdown editing from the rendered note with a pencil control, showing a check and a reset control while editing |
| S-005 | unit | it should commit the edited note and mark the document modified when the check control is used, so the existing autosave writes it |
| S-006 | unit | it should show the stored generated recap for the selected section read-only when one exists |
| S-007 | unit | it should append a deleted section's note to a single orphaned-notes draft at the bottom of the overview, headed by the deleted section's title |
| S-008 | unit | it should offer a Notes scope in the assistant's Feedback Target list |
| S-009 | unit | it should build the Notes context from the story overview and every non-empty section note in document order, prefixed by a statement that they are author notes rather than manuscript prose, and omit orphaned notes |
| S-010 | unit | it should expose four view tabs — Editor, Manuscript, Notes, History — keeping one tab stop and working arrow, Home and End keys |
| S-011 | rust | it should write notes into the `.rite` file and read them back unchanged |
| S-012 | rust | it should keep notes out of the document, the text export and the version-history snapshots |
| S-013 | e2e | it should open Notes as a fourth view and replace the editor pane with the notes view |
| S-014 | e2e | it should preserve a committed note across a view switch and across reopening the saved file |
| S-015 | e2e | it should select the note for the section at the caret when Notes is opened from the editor |
| S-016 | e2e | it should select the note for the section on the current page when Notes is opened from the manuscript |
| S-017 | e2e | it should return to the note's section in the text view the user came from when the section jump is used, matching the Sections drawer jump |
| S-018 | e2e | it should leave the word count and the manuscript view unchanged by note text |
| S-019 | unit | it should present the orphaned-notes draft as one entry at the bottom of the list, with no text |
| S-020 | unit | it should treat every section's note as an always-present field, with no create or delete action |
| S-021 | unit | it should place the section jump in the note header immediately after the title |
| S-022 | e2e | it should paint the notes view and its rendered notes with the active theme's colors, matching the editor surface |
| S-023 | unit | it should restore the last committed note and remain in editing when reset is used |
| S-024 | unit | it should append the recap to the note draft and enter editing when “Insert into note” is used |
| S-025 | unit | it should commit the draft when another entry or another view is chosen |
| S-026 | e2e | it should undo and redo edits to the note draft with Cmd+Z and Cmd+Shift+Z while editing, leaving the manuscript's undo stack unchanged |

## Out of scope

- `[[…]]` links, characters in chapters, and custom words with where they are
  used. Those are 5.19, with their own data model.
- Any new AI generation. The Notes scope reads notes; it does not create them.
- A `.rite` schema bump or migration. Release owns that.
- Notes in exports, word count, search, or version history.
