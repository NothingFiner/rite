# 5.19a — Reference entries: one flat record, three kinds

Approved sentence list for the spec-to-tests stage. The tests are written and
red; they define what "done" means. This file is the implementer's whole
context.

Part of 5.19. 5.19b (`[[…]]` links in notes) and 5.19c (spellcheck vocabulary
sync) are separate specs and are **not** in scope here.

## Context

### Why this exists

5.19 was deferred by 5.17's spec with one sentence: *"`[[…]]` links, characters
in chapters, and custom words with where they are used … their own data model."*
This spec is that data model.

The approved model collapses the three ideas into **one flat record with a
kind**:

```js
ReferenceEntry {
  id,
  kind: 'term' | 'character' | 'place',
  name,
  definition,        // markdown; '' is legal
  aliases: [],
  tags: [],          // flat organisation, all kinds
  facts: [],         // [{ label, value }]
  includedSections: [],  // source: manual "appears in" additions
  excludedSections: [],  // source: manual removals of wrong matches
}
```

A **custom word is a `term` entry**. Defining it fills `definition`; leaving it
empty is a valid, undefined glossary entry. A **place** is term-shaped: it
carries no field a term does not.

### Source vs cache — the one rule

`VOCABULARY.md` is the authority:

- **Source** is authored, permanent, lives in the `.rite`. Entries are source.
- **Cache** is derived and disposable. *Where an entry appears* is derived from
  a scan of the manuscript, and is **never stored on the entry**.

The two arrays `includedSections` / `excludedSections` are source because a
human made them. The derived list is recomputed on read.

### The worked example the tests pin

An entry `Izildar Qualen` (alias `Essidor Agjadoff`), an entry `Izildar` (a
minor character sharing the first name), and an entry `Qualen Square` (a place).
Mentions match **whole names and aliases, longest first**, so:

- `Izildar Qualen` in the text belongs to the full-name entry only.
- `Essidor Agjadoff` belongs to it through the alias.
- a bare `Izildar` belongs to the minor character.

If a bare `Izildar` is also an alias of the first entry, the match is genuinely
ambiguous; manual inclusion/exclusion is how the writer fixes it.

### Vocabulary this spec must add

`VOCABULARY.md` says new terms enter it **before** they are used. The
implementation PR must update it in the same change:

- **Reference entry** — an authored record about the manuscript's world. Source.
- **Place** — a reference entry of kind `place`, term-shaped.
- **Glossary** — rewrite: the surface listing `term` and `place` entries,
  defined or not. It is no longer "authored term and definition only", and the
  old warning against calling a custom-word list a glossary is superseded by
  this model.

### What already exists — reuse it, do not rebuild it

- **`Notes`** is the template for a new additive `.rite` record:
  `src-tauri/src/notes.rs` (struct + `serde(default)`),
  `RiteFile.notes` (`src-tauri/src/history.rs`),
  `AppState.notes` (`src-tauri/src/state.rs`),
  `retrieve_notes` / `update_notes` (`src-tauri/src/commands.rs`),
  the load in `open_document`, and `build_rite_file`.
- **`useNotes.js`** is the template for pure record helpers: it returns new
  records, never mutates.
- **`useSectionFormat.js` → `sectionDisplayTitle`** is the naming rule for
  chapters. Do not derive a chapter title any other way.
- **`search_document`** (`src-tauri/src/commands.rs`) already walks every
  paragraph's `TextRun.content`. The mention scan uses the same walk shape; it
  does not need Rust, because it is a pure function over `doc`.
- **`ReferencesNavDrawer.vue` / `ReferencesView.vue` / `NotesView.vue`** are the
  shipped References surfaces. The three-surface control exists in the mock-ups
  (`~/Projects/rite-mockups/reference-view-v3.html`) but **not in the code**;
  build it here.

### DOM contract the tests pin

Only these selectors are contract. Everything else — file layout, component
names, props, CSS — follows the component you are touching.

| Selector | Meaning |
|---|---|
| `.surface-tab[data-surface="outline\|characters\|glossary"]` | the drawer-head control; all three enabled |
| `.reference-entry[data-entry-id]` | one row on the Characters or Glossary surface; the active row carries `selected` |
| `.reference-empty` | the empty surface message |
| `.reference-add` | the add control |
| `[data-add-kind="term\|character\|place"]` | its three options |
| `.reference-entry-view` | the detail page root |
| `.reference-definition` | rendered markdown definition |
| `.reference-definition-empty` | the empty state when no definition exists |
| `.reference-definition-source` | the editable definition field |
| `.reference-save` | commit the definition, including an edit that `.reference-definition-edit` reopened |
| `.reference-alias` / `.reference-tag` / `.reference-fact` | detail chips and rows |
| `.reference-alias-input` / `.reference-alias-add` / `.reference-alias-remove` | add an alias, and remove one |
| `.reference-name` / `.reference-name-error` | the entry's name field, committed on blur or Enter, and the refusal naming the entry that owns the name. The page hides a stale refusal as soon as the field changes |
| `.reference-entry-heading` | the entry's display name at the top of its page |
| `.reference-definition-edit` / `.reference-edit-cancel` | edit a committed definition, and abandon the edit |
| `.reference-kind-toggle` | switch an entry between term and place |
| `.reference-mention-add` / `.reference-section-option[data-section-id]` | a select listing the sections the entry is not already shown in, and one option per section |
| `.surface-tabs[role="tablist"]` / `.surface-tab[role="tab"][aria-selected]` | the surface head as one connected group with exactly one selected |
| `.regenerate-all` | the bulk summary control, in the Assistant panel |
| `.reference-mention[data-section-id]` | one "Appears in / Used in" row |
| `.reference-mention-go` | its jump control |
| `.reference-mention-remove` | remove a derived mention |
| `.reference-mention-add` | add a section by hand |
| `.reference-merge` | start a merge |
| `.reference-merge-target[data-entry-id]` | choose the entry to absorb |

### Traps this spec exists to avoid

1. **Do not store derived mentions.** Storing them turns a cache into a second
   source that drifts from the manuscript on every keystroke.
2. **Longest match, whole words.** A substring match makes `Izildar` match
   `Izildar Qualen`, which is the exact false positive the example is about.
3. **Do not put entries in `Document`.** They must stay out of exports, the
   word count, search, and version-history snapshots — exactly as `Notes` does.
4. **Do not let a merge lose manual associations.** They are source the writer
   authored; move them to the survivor.
5. **Blank names are not blank rows.** A new entry shows `Untitled term` /
   `Untitled character` / `Untitled place`, the same way an unnamed chapter
   shows `Chapter N`.

### Revision 2 — completing the surfaces

5.19a shipped the record and the read-only half. The writer could create an entry but not name it, could not correct a mention, could not re-edit a committed definition, and got no feedback when an add landed on a surface they were not looking at. S-026 onward close that gap. The DOM table states the commit trigger, the picker's control type and the reuse of `.reference-save` for edits, because a test that finds no element cannot tell a missing feature from an unstated contract. They are new behaviour, not bug fixes: the earlier sentences were satisfied as written.

Decisions the implementer needs:

- **Naming is in place on the entry page**, committed the way the definition is. No `PromptModal` on create. The page heading shows the display name; a blank name reads `Untitled term` / `Untitled character` / `Untitled place` (S-026).
- **Adding an entry switches the drawer** to the surface that lists it (S-038). A term added from Characters currently lands in a list the writer cannot see, so the click reads as a no-op.
- **A committed definition keeps an edit path** (S-030–S-032): an edit control reopens the source field holding the current text, saving replaces it, cancelling discards.
- **Mentions are correctable in the UI** (S-033–S-035), and **adding a section back must clear its exclusion** (S-036). Without that last rule the control is a dead end: `deriveMentions` skips an excluded section before it looks at inclusions, so an exclusion outranks an inclusion for the same section and a removed mention can never come back.
- **Aliases are editable** (S-041–S-043). The worked example needs `Essidor Agjadoff` to trigger a mention; with aliases display-only the record cannot express it. Tags and facts stay display-only in this change.
- **`place` keeps its kind but loses its own creation button.** Glossary's single add control creates a term, and the page switches an entry between term and place (S-047). Character is not switchable — that would move the entry to another surface. The two kinds are structurally identical today; the kind survives because it is single-valued, schema-bearing, already persisted, and the only place future place-specific fields can attach. Dropping it needs a schema migration and is not this change.
- **The References panel is permanent in the References view** (retired in revision 3). One 5.20a e2e sentence that made the rail button close the drawer is retired for the same reason as the Regenerate all test: it is protected, it contradicts these sentences, and only this stage may change it. It is the only navigation for entries: closing it leaves the view showing "Choose an entry in the drawer." with no drawer to choose from. It stays collapsible in every other view, where it is a tool drawer over the text. Closing another panel while in References must fall back to it, not to no panel.
- **Regenerate all belongs to the Assistant panel** (S-045–S-046). It refreshes every section summary, which is a manuscript-wide action; it was sitting in the References drawer. Moving it supersedes the 5.20a drawer sentences that pinned the control's old home: their unit tests are removed, the per-section regenerate they also guarded stays where it was, and `SPEC-5.20-references.md` records the supersession. A coder cannot resolve this class of conflict, because the old test is protected — the spec stage has to retire it.
- **Surface head and add control reuse existing chrome.** The connected tab group is `.view-tabs` in `Toolbar.vue`; the plus is `.add-btn` in `NavigationDrawer.vue`. Design directives, not testable — do not invent a third style.
- **The References rail icon is out of scope.** It draws a bookmark where a library glyph belongs; that change was deferred and must not ride on this one.
- **`VOCABULARY.md` still lacks Reference entry / Place / Glossary.** 5.19a's spec requires them in the same change. That duty was not done and carries over to this one.

The rail-icon sentence was removed from the approved list when the icon work was deferred, and it has no ID here on purpose: this file is scanned for every `S-nnn` token, and an ID with no test reads as a missing test. The three panel-preservation sentences were tagged `e2e`, not `unit`: they are `App.vue` shell behaviour, and the repository has no `App` mount test, so a unit test would require a helper that does not exist — that would be implementation, not a sentence.

One further sentence was withdrawn after S-006 was revised. It mapped an entry kind to its drawer surface, so the shell could switch the drawer after a cross-surface add. With one add control per surface, an add always creates an entry the current surface lists: nothing to switch to, and no consumer for the helper. S-038 was reworded for the same reason, because its old text ("add a term from the Characters surface") described an action the revision removed. Neither is listed with an ID, for the reason above.

## Sentences

| ID | Layer | Sentence |
|---|---|---|
| S-001 | rust | it should store a references record in the `.rite` file beside the notes record, and read a file without one as an empty record |
| S-002 | unit | it should keep one flat list of reference entries, each with an id, a kind, a name, a definition, aliases, tags and facts |
| S-003 | unit | it should support three kinds — term, character and place — and give a place the same shape as a term |
| S-004 | unit | it should offer Outline, Characters and Glossary in the References drawer head, with all three enabled |
| S-005 | unit | it should list character entries on the Characters surface and term and place entries on the Glossary surface |
| S-006 | unit | it should show one add control on each reference surface, creating an entry of that surface's kind — a character on Characters, a term on Glossary — and show no add control on Outline |
| S-007 | unit | it should create an entry of the chosen kind, select it, and show it as `Untitled term` / `Untitled character` / `Untitled place` until it is named |
| S-008 | unit | it should render an entry's definition as markdown, and show an empty definition as an editable empty state |
| S-009 | unit | it should show an entry's aliases, tags and facts beside its definition |
| S-010 | unit | it should derive the sections an entry appears in by scanning manuscript paragraphs for its name and aliases as whole words |
| S-011 | unit | it should give a mention to the longest matching name or alias, so `Izildar Qualen` does not also count as `Izildar` |
| S-012 | unit | it should let the writer remove a derived mention from a section, and keep that exclusion in the saved record |
| S-013 | unit | it should let the writer add a section to an entry's appears-in list by hand, and keep that inclusion in the saved record |
| S-014 | unit | it should merge two entries into the chosen survivor, absorbing the other's name and aliases, unioning tags and facts, and keeping the survivor's non-empty definition |
| S-015 | unit | it should move the merged entry's inclusions and exclusions to the survivor and remove the merged entry |
| S-016 | unit | it should save and load the references record through one command pair, so a reopened file shows the same entries |
| S-017 | unit | it should refuse to create or rename an entry to a name another entry already uses, and say which entry owns it |
| S-018 | unit | it should show an empty Characters and Glossary surface for a document with no entries, with no error |
| S-019 | unit | it should keep reference entries out of the word count and out of search results |
| S-020 | rust | it should keep reference entries out of the text and DOCX exports and out of version-history snapshots |
| S-021 | e2e | it should add a term, define it, reopen the file, and show the definition |
| S-022 | e2e | it should show a character's appears-in sections and jump to one |
| S-023 | e2e | it should merge two entries and show the survivor carrying both names |
| S-024 | e2e | it should switch between Outline, Characters and Glossary without leaving References |
| S-026 | unit | it should show the selected entry's name as its page heading, and `Untitled term` / `Untitled character` / `Untitled place` while the name is blank |
| S-027 | unit | it should let the writer commit a new name for the selected entry and keep it in the saved record |
| S-028 | unit | it should refuse a name another entry already owns when the writer commits it, name the owning entry, and leave the record unchanged |
| S-029 | unit | it should clear the name error when the writer changes the field to a name no entry owns |
| S-030 | unit | it should offer an edit control on a rendered definition that reopens the source field holding the current definition |
| S-031 | unit | it should replace an entry's definition when the writer saves an edit to a rendered definition |
| S-032 | unit | it should leave the definition unchanged when the writer cancels an edit |
| S-033 | unit | it should offer a remove control on every appears-in row that excludes that section and removes the row |
| S-034 | unit | it should offer an add control listing the sections this entry is not already shown in, and no others |
| S-035 | unit | it should add the chosen section to an entry's appears-in rows even when the entry's name does not occur in that section, and keep it in the saved record |
| S-036 | unit | it should clear a section's exclusion when the writer adds that section by hand, so a removed mention can be restored |
| S-037 | e2e | it should name a character, show the sections its name appears in, and keep the name after reopening the file |
| S-038 | e2e | it should add an entry from the Characters surface, show the new row selected in the drawer, and open its page with the untitled heading |
| S-039 | e2e | it should remove a mention, then add the same section back by hand, and show the row again |
| S-040 | rust | it should keep reference entries out of the DOCX export |
| S-041 | unit | it should let the writer add an alias to the selected entry and keep it in the saved record |
| S-042 | unit | it should let the writer remove an alias from the selected entry |
| S-043 | unit | it should treat an alias as a mention trigger, so a section containing only the alias appears in the entry's appears-in rows |
| S-044 | unit | it should render Outline, Characters and Glossary as one connected tab group in which exactly one surface is marked selected |
| S-045 | unit | it should show Regenerate all in the Assistant panel and not in the References drawer |
| S-046 | e2e | it should regenerate all summaries from the Assistant panel |
| S-047 | unit | it should let the writer switch an entry between the term and place kinds on its page, and refuse any other kind change |

## Revision 3 — entry page UI and a structural References panel

Revision 1 and 2 satisfied their sentences. This revision answers what the merged
UI review found: the entry page read as an unstyled form, its fields did not
follow the paper theme, the name field was always visible beside the heading,
tags and facts existed in the record but had no way in, and the References
drawer had become a panel the writer must never close.

### What the review found

- **The page did not use the paper palette.** `useTheme.js` publishes the dark
  chrome tokens whenever the view is not `editor`. The References page paints
  `theme.bg` but its children read `--text-primary` and `--glass-bg`, so text
  washed out and fields were dark boxes on the paper.
- **The name was two things at once.** A heading and an always-visible input
  showed the same value.
- **An empty definition always showed a textarea.** A committed definition had
  an edit control, an empty one did not.
- **Aliases, tags and facts were display-only in practice.** The record stores
  all three, and `ReferenceEntryView` declares `add-alias` / `remove-alias`, but
  no control emits them. A new entry showed only heading, definition and
  appears-in.
- **The drawer was kept open by rule.** The four retired sentences forbade closing it because
  it is the only navigation for entries. A panel the view owns needs no such
  rule.

### Decisions the implementer needs

- **The page receives the theme.** `ReferenceEntryView` takes a `theme` prop and
  publishes these custom properties on its root: `--note-text`, `--note-accent`,
  `--note-field-bg`, `--note-field-border`, `--note-hover-bg`. The two field
  tokens derive from `theme.text` with an alpha suffix, because a paper theme's
  text colour is the only ink that reads on its own paper. `ReferencesView`
  passes `theme` down and sets the same `--note-text` / `--note-accent` on its
  own root, matching `NotesView.vue`.
- **Name is display first.** The heading and an `Edit name` control show until
  editing starts. Editing replaces the heading with the field. A commit returns
  to the heading only when the entry prop carries the new name; a refusal keeps
  the field open so the draft can be corrected (S-057–S-061).
- **A new untitled entry starts in name edit with focus** (S-062). Nothing else
  on the page is useful before the entry is named.
- **Empty definition reads like empty prose.** `No definition yet` plus the
  `Edit definition` control; the source field appears only while editing
  (S-063). This supersedes the empty half of S-008.
- **All three list fields are editable** (S-064–S-067). Aliases, tags and facts
  always render as labelled groups with an empty state, so a new entry shows the
  record's full shape. The page reports `add-alias`, `remove-alias`, `add-tag`,
  `remove-tag`, `add-fact` and `remove-fact`; the shell mutates the record.
  `add-fact` carries `{ label, value }`, `remove-fact` carries the row index.
- **The References navigation is a panel inside the view** (S-069, S-070).
  `ReferencesView` renders the surface head, the rows and the add control in a
  `.references-panel` column beside the page. `ReferencesNavDrawer` keeps its
  `.references-drawer` root class so the shipped 5.20a e2e selectors still find
  the rows, but the element is no longer a rail-toggled drawer.
- **The References rail item is removed** (S-071). The view tab is the only way
  into References. Supersedes the 5.20a sentences that required the rail handle
  in this view.
- **Superseded tests.** The four drawer-preservation sentences are retired; their
  behaviour no longer exists. The 5.20a e2e sentence that asserted the rail
  handle and drawer (S-003 in `references-outline.spec.js`) and the two 5.20a
  ActivityBar sentences that required a References rail item are retired for the
  same reason. Only this stage may retire them, because they are protected.
- **Amended in place.** S-008's empty-definition half becomes S-063's behaviour.
  S-026–S-029 keep their IDs but the name is a heading until `Edit name` is
  chosen. S-021, S-037 and S-038 gain the `Edit` steps that S-063 and S-062
  require.

### DOM contract added by revision 3

| Selector | Meaning |
|---|---|
| `.reference-name-edit` / `.reference-name-save` / `.reference-name-cancel` | open, commit and abandon the name edit |
| `.reference-definition-edit` | the edit control, offered on a committed and on an empty definition |
| `.reference-group[data-group="aliases\|tags\|facts"]` | one labelled list group |
| `.reference-group-empty` | the quiet empty state inside a group with no values |
| `.reference-alias-input` / `.reference-alias-add` | add an alias |
| `.reference-alias-remove[data-alias]` | remove one alias chip |
| `.reference-tag-input` / `.reference-tag-add` / `.reference-tag-remove[data-tag]` | add and remove tags |
| `.reference-fact-label-input` / `.reference-fact-value-input` / `.reference-fact-add` | add a fact |
| `.reference-fact-remove[data-index]` | remove a fact row |
| `.references-panel` | the References view's own navigation column |
| `.references-panel .surface-tabs` / `.reference-entry[data-entry-id]` | the panel's surface head and rows |
| `.activity-icons [title="References"]` | must not exist in any view |

### Sentences

| ID | Layer | Sentence |
|---|---|---|
| S-053 | unit | the entry page should paint its text with the active theme's text colour and its controls with the theme's accent, not the dark chrome palette |
| S-054 | unit | the name field, definition field and section picker should use a field surface and text colour derived from the active theme, so both stay legible on every preset |
| S-055 | unit | the entry page should stack naming, kind switch, definition, aliases, tags, facts and appears-in in one column with consistent spacing, and never place appears-in beside the definition editor |
| S-056 | e2e | on a light theme (Cream), the entry heading, definition prose, fields and appears-in rows should all be legible against the paper background |
| S-057 | unit | the entry page should show the name as a heading with an Edit name control, and no name field until editing starts |
| S-058 | unit | choosing Edit name should replace the heading with a name field seeded with the committed name, focused so the writer can type immediately, plus Save name and Cancel |
| S-059 | unit | Save name should emit the rename and return the page to the heading |
| S-060 | unit | Cancel should discard the draft and return the page to the committed name |
| S-061 | unit | a name-taken refusal should appear beside the name field, keep the page in edit mode, and keep the writer's draft |
| S-062 | unit | a newly created untitled entry should open with the name field in edit mode and focused, so the first keystroke names it |
| S-063 | unit | an empty definition should read as "No definition yet" with an Edit definition control, and show the source field only while editing |
| S-064 | unit | the page should show aliases, tags and facts as labelled groups, each with a quiet empty state when it has no values, so the record's structure is always visible |
| S-065 | unit | the page should let the writer add an alias and remove an alias chip, reporting each change upward for saving |
| S-066 | unit | the page should let the writer add a tag and remove a tag chip, reporting each change upward for saving |
| S-067 | unit | the page should let the writer add a fact with a label and a value, and remove a fact row, reporting each change upward for saving |
| S-068 | e2e | it should add an alias on the entry page, reopen the file, and still show the alias chip and its appears-in trigger |
| S-069 | unit | the References view should render the surface tabs, entry rows and add control in its own layout, so the panel is visible whenever the References view is active without a rail click |
| S-070 | unit | the References panel should paint with the active theme's text and accent, matching the page beside it |
| S-071 | unit | the activity bar should not offer a References rail item; the References view tab is the only way into References |
| S-072 | e2e | opening References should show the panel immediately, with no drawer toggle involved |
| S-073 | e2e | a Stats round trip while in References should leave the panel visible and unchanged |
| S-074 | e2e | switching from References to the editor should leave no References panel in the editor layout |

## Revision 4 — no history checkpoint without a delta (ROADMAP 6.8)

### Context

A row in the version history must mean the manuscript changed. Three paths write
history: `save_document` (explicit save), `save_snapshot` (manual checkpoint) and
`autosave_document`. Only autosave tests for a change. `AppState::append_history_delta`
compares the document with `last_history_state` and returns `Ok(false)` when
`doc_ops_between` yields no ops, so it records nothing and rewrites nothing.

`AppState::append_history_snapshot` compares nothing. It pushes a full `Document`
into the embedded history and compacts, so a save with no edit stores a duplicate
document in the `.rite`. The cost: the file grows by a document per no-op save,
`compact_history` evicts real history to stay under `max_snapshots`, and the
history list fills with rows a writer cannot tell apart.

**The rule.** Record a row only when the document differs from the baseline.
`last_history_state` is the state the history was last advanced from.
`open_document` and `save_document` set it to the loaded document, and
`append_history_delta` advances it after journalling. It already holds the newest
recorded state, so the comparison needs no replay of the embedded history. Compare
against the baseline rather than against the newest snapshot: a delta run past that
snapshot can already hold the current state, and the correct answer there is no new
row, not a fresh snapshot.

Two cases keep a record:

- **Empty history.** The first save of a document has no prior state to compare
  against, so its snapshot is the file's only restore point. That first save
  records even when the content equals `Document::default()`, which is where
  `AppState::new` starts the baseline.
- **A different target path.** A Save As must write a complete document to the new
  path. Only the history row is skipped.

`save_snapshot` changes shape so the caller can tell the two outcomes apart:

```rust
pub fn save_snapshot(state: State<AppState>) -> Result<Option<String>, String>
```

`Some(timestamp)` means a row was recorded. `None` means there was nothing to
record. No frontend caller invokes `save_snapshot` in this build, so the command can
change shape without a frontend change. An unchanged save still clears
`is_modified` and still reports success: the writer asked to save, and the file on
disk already matches the document.

`append_history_delta` keeps its guard unchanged. That guard is the model the two
other paths now follow.

The history table has no `unit` or `e2e` sentence in this revision. The whole
change sits behind the Tauri commands, and the tests drive those commands through
the mock app.

### Sentences

| ID | Layer | Sentence |
|---|---|---|
| S-075 | rust | saving a document that has never been saved should record exactly one history row, and a repeated save of that same content should leave the count at one |
| S-076 | rust | saving a document that was just opened, with no edit since, should record no history row |
| S-077 | rust | saving an unchanged document to the path already open should not touch the file on disk at all |
| S-078 | rust | saving a changed document should add exactly one row, and reconstructing from that row's timestamp should return the saved content |
| S-079 | rust | an explicit manual checkpoint of a changed document should add exactly one row and return that row's timestamp |
| S-080 | rust | an explicit manual checkpoint with nothing new to record should write nothing and return no timestamp |
| S-081 | rust | a save to a different path should write a complete document there, with no additional history row, even when the content is unchanged |
| S-082 | rust | after an autosave journals a change, a save of that same state should record no history row |
| S-083 | rust | after a manual checkpoint records a snapshot, a save of that same state should record no history row |


## Revision 5 — reference links in notes, and lookup from the word menu (ROADMAP 5.19b, 5.19d)

### Context

Two features over one record: a `[[Name]]` link inside a note, and a lookup from
a word in the text. They are deliberately different in what they store, and that
difference is the whole design.

**A note link stores nothing new.** The brackets live inside the note string,
which is already source (`Notes` in `notes.rs`). There is no new field, no
`.rite` change and no migration. Notes are structurally outside `Document`, so
brackets in a note cannot reach the word count, search, exports, version
history or the history diff — nothing has to be excluded, because nothing sees
them.

**The lookup stores nothing at all.** It is a way to reach an entry from the
manuscript; it writes no text, marks no word and changes no `Paragraph`.

**Why the manuscript stays clean.** `Paragraph` is `elements: Vec<Element>`, and
each element is `text_run.content` plus `textStyle`. `paragraphToHTML` escapes
every character. There is no markdown and no link type on that path, and this
revision adds none: `[[Name]]` typed into the manuscript stays literal
characters and is counted, searched and exported as text. S-107 pins that.

**No router.** `viewMode` (`App.vue`), `referencesTab` and `referenceEntryId` are
refs; a link is code that assigns them. There is no browser history, so a link
has no return path — a writer gets back with the view tabs. Accepted, not fixed
in this revision.

**The word menu is native and its payload is fixed.** `useThesaurus.test.js`
(protected) asserts `invoke('show_word_menu', { x, y, word })` by deep equality,
and `menu.rs` states the split: "Rust decides what the menu holds; the
frontend's whole job is to hand it the right word". So the match is computed in
**Rust**, where `state.references` already lives, and the frontend asks Rust for
the list through a `reference_matches_for_word` command. Do not add a field to
that payload, and do not write a second matcher in JavaScript — two
implementations of one rule drift, and when they disagree the menu offers a
lookup with an empty list.

### Two matching rules, on purpose

They answer different questions and must not be merged.

| Rule | Where | Test |
|---|---|---|
| **Link resolution**: the whole bracketed text equals an entry's name or one of its aliases, ignoring case | resolving `[[…]]` in a note or a definition | `equals` |
| **Word lookup**: the clicked word occurs as a whole word inside an entry's name or one of its aliases, ignoring case | the word menu | `contains a word` |

So `[[Izildar]]` resolves only to an entry literally named or aliased
`Izildar`, while a right-click on `Qualen` offers both `Izildar Qualen` and
`Qualen Square`. The first is attribution — the app decided the entry is meant.
The second is a question — the writer asked what a word might be. 5.19a's
mention scan (whole names, longest first) is a third rule and is untouched.

### Layers moved from the approved draft

Eight sentences changed layer. Both changes are structural, not preference:

- **S-097 … S-101: unit → rust.** The matcher must run where the menu can reach
  it, and the menu is built in Rust from `state.references`. A JS matcher would
  duplicate the rule, and the protected `show_word_menu` payload cannot carry the
  result of a JS match.
- **S-091, S-094, S-105: unit → e2e.** Each sentence ends in "open the References
  view … with that entry selected", which is `App.vue` shell state. There is no
  test harness that mounts `App`, and building one is a fixture that fakes the
  whole application — a setup error waiting to look like a red test. This follows
  revision 2, which put the References panel sentences in e2e for the same
  reason.

### DOM contract added by this revision

| Selector | Meaning |
|---|---|
| `.reference-link[data-entry-id]` | a resolved `[[…]]` link, inside `.note-rendered` or `.reference-definition`. Text is exactly what the writer typed between the brackets |
| `.reference-lookup` | the chooser the Look Up Reference item opens |
| `.reference-lookup-item[data-entry-id]` | one matching entry in the chooser, showing its name and kind |

Without the last two rows a test that looks for the chooser cannot tell a
missing feature from an unstated contract.

### Tests that assert an absence carry a positive control

S-087, S-088, S-089, S-101, S-103, S-096 and S-107 each assert that something
does **not** happen. A do-nothing stub satisfies those for free, so each test
holds a positive control in the same test: a resolvable link that is a link, or
a word that does produce the item, or the same name linking in a note while it
does not link in the manuscript. Do not delete a control to make a test simpler —
the control is what makes the absence mean something.

### Traps

1. **Do not put links in the manuscript.** No anchor, no `data-entry-id`, no
   markdown parse on `paragraphToHTML`. S-107 fails if the note renderer is
   reused there.
2. **Do not resolve by prefix or substring.** `[[Izi]]` resolves through an
   alias, not because `Izi` starts `Izildar`.
3. **Do not rewrite note text.** A rename leaves `[[Old Name]]` literal; there is
   no pass that edits the writer's notes.
4. **Do not store the resolution.** The entry a link points at is computed at
   render time from the current record; nothing is written down.
5. **Do not put the entry list in the native menu.** Labels are `&'static str`
   and the list is dynamic, so the menu carries one static item and the chooser
   is HTML — the same split the thesaurus already uses (native item, then
   `.thesaurus-popover`).
6. **The item is offered only when there is a match.** A menu item that opens an
   empty chooser is worse than no item.

### Sentences

| ID | Layer | Sentence |
|---|---|---|
| S-084 | unit | it should turn `[[Name]]` in a note into a link to the entry whose name or alias equals Name, ignoring case |
| S-085 | unit | it should display a link as exactly the text between the brackets, not the entry's canonical name |
| S-086 | unit | it should resolve `[[Izi]]` to the entry that owns `Izi` as an alias and display it as `Izi` |
| S-087 | unit | it should leave `[[Name]]` as literal text, brackets included, when no entry has that name or alias |
| S-088 | unit | it should leave `[[Old Name]]` as literal text after the entry it named is renamed, since resolution matches the current name and aliases only |
| S-089 | unit | it should leave escaped or unclosed brackets as literal text, and not throw |
| S-090 | unit | it should render a note containing links without letting the link markup into the raw note text that is stored |
| S-091 | e2e | it should open the References view on the entry's own surface with that entry selected when a link in a note is clicked |
| S-092 | unit | it should keep resolving links in the story overview, a section note and the orphaned draft alike |
| S-093 | unit | it should render `[[Name]]` in an entry's definition as a link to the matching entry, on the same terms as a note |
| S-094 | e2e | it should select the linked entry and switch to that entry's surface when a link in a definition is clicked, including when the two entries sit on different surfaces |
| S-095 | e2e | it should show a note link as its name, and open the linked entry's page when it is clicked |
| S-096 | e2e | it should not change the manuscript, the word count or the manuscript view when a note holds a link |
| S-097 | rust | it should find every entry whose name or alias contains the clicked word as a whole word, ignoring case |
| S-098 | rust | it should return both `Izildar Qualen` and `Qualen Square` for the word `Qualen` |
| S-099 | rust | it should return the entry for `Izi` when `Izi` is one of its aliases |
| S-100 | rust | it should report each match with its entry's name and kind, so two entries sharing a word are distinguishable |
| S-101 | rust | it should find no match for a word that only resembles a name, such as a word containing the name as a fragment |
| S-102 | rust | it should offer a Look Up Reference item in the word menu when the clicked word matches at least one entry |
| S-103 | rust | it should omit the Look Up Reference item when the clicked word matches no entry |
| S-104 | rust | it should relay the Look Up Reference item to the frontend as a menu event under its own id, leaving thesaurus and spelling routes unchanged |
| S-105 | e2e | it should open the References view on the chosen entry's surface with that entry selected when a match is chosen |
| S-106 | e2e | it should offer the reference lookup on a name in the manuscript and open the chosen entry's page |
| S-107 | unit | it should treat `[[Name]]` typed in the manuscript as ordinary text, with no link and no change to the paragraph's stored content |

### Out of scope

- Rewriting existing `[[old]]` links when an entry is renamed. A rename leaves
  them literal, and a bulk rewrite is a separate item.
- Any link target stored in `Document`, or any markdown in the editor.
- A note link counting as a mention. Mentions stay derived from manuscript
  paragraphs; a link is the writer pointing at the record.
- `[[Name|display]]` syntax. The bracketed text *is* the display text, so the
  writer chooses it by choosing which name or alias to type.
- Back navigation from a link. There is no history stack to push onto.
- The lookup restricted to the manuscript. It follows the word menu, wherever
  the menu appears.


## Revision 6 — the lookup list lives in the native menu (ROADMAP 5.19d)

Supersedes trap 5 and the `.reference-lookup` rows of revision 5. Everything
else in revision 5 stands.

### Context

Revision 5 offered one static menu item and showed the matches in an HTML
popover fed by a second IPC call. That split was justified by two things that
turn out to be wrong:

- **`&'static str` is our seam, not Tauri's.** `MenuItem::with_id` takes
  `I: Into<MenuId>` and `T: AsRef<str>`, so an owned id and an owned label are
  supported. Only `MenuNode::Item` insists on `&'static str`, because the
  static menu is assertable plain data with no runtime.
- **The match list never needed to reach JavaScript.** `show_word_menu` already
  computes it in Rust. Round-tripping it through a command, a reactive store and
  a positioned popover added a second matcher call, a second window, and a
  second place to position after a menu had just dismissed.

So the menu carries the entries. One click instead of two, and nothing is
looked up a second time.

### Shape

The word menu grows one node when the clicked word matches:

```
Thesaurus…
References ▸   Izildar Qualen (Character)
               Qualen Square (Place)
──────────
Cut / Copy / Paste / Select All
[…spelling section when flagged]
```

- The node is a submenu labelled `References`, inserted directly after the
  Thesaurus item. One node however many entries match, so the popup does not
  grow a row per match and the edit items stay where the writer expects them.
- Each item's label is `Name (Kind)`: `Term`, `Character` or `Place`. A bare
  name cannot distinguish two entries the word belongs to.
- Each item's id is `look_up_reference:<entry id>`. The id names its entry, so
  activating it needs no lookup: `lookup_item_id` builds it and
  `lookup_entry_id` parses it back.
- Matches keep the record's order, so the same click yields the same menu.

### Routing

`menu_event` stays the authority for ids with a fixed route. A lookup id is not
one of those: `menu_event("look_up_reference:e-queln")` is `None` and
`lookup_entry_id` recognises it instead. The app-wide handler in `lib.rs` emits
the id verbatim when either says the app owns it, so the frontend still receives
one `menu` window event whose payload is the id.

`runMenuAction` parses the prefix before the id map runs, and passes the entry
id to the `look_up_reference` action. That action calls `openEntry`, which is
the same shell move a reference link makes (S-091): References, the entry's
surface, the entry selected. A prefix with no entry behind it is not an action.

### Deleted by this revision

| Removed | Why |
|---|---|
| `ReferenceLookupPopover.vue` | the entries are in the menu, so there is no list to draw |
| `useReferenceLookup.js` | no state, no invoke, no positioning |
| `reference_matches_for_word` command | Rust computes the list where it builds the menu |
| `useThesaurus.currentCapture` | only the chooser read the capture; the menu does not need it |

`.reference-lookup` and `.reference-lookup-item` leave the DOM contract; a test
that finds one is finding leftover code.

### Sentences

S-102 … S-106 keep their ids and are restated below; their revision 5 wording
described the popover. S-107 and below are unchanged.

| ID | Layer | Sentence |
|---|---|---|
| S-102 | rust | it should offer a `References` submenu in the word menu when the clicked word matches at least one entry |
| S-103 | rust | it should omit that submenu when the clicked word matches no entry |
| S-104 | rust | it should relay a lookup id to the frontend under that same id, leaving the thesaurus and spelling routes unchanged |
| S-105 | e2e | it should open the References view on the chosen entry's surface with that entry selected when a menu item naming it is chosen |
| S-106 | e2e | it should offer the reference lookup on a name in the manuscript and open the chosen entry's page |
| S-108 | rust | it should group the matching entries under one submenu node, so the popup does not gain a row per match |
| S-109 | rust | it should label each submenu item with its entry's name and kind, so two entries sharing the word are distinguishable |
| S-110 | rust | it should give each submenu item an id that names the entry it opens, and parse that id back to the same entry |
| S-111 | unit | it should open the entry a lookup id names, and treat an id that names no entry as not an action |
| S-112 | e2e | it should open the entry straight from the menu item, with no chooser between the menu and the entry |

### Traps

1. **Do not keep a popover as a fallback.** Two ways to choose a match is two
   behaviours to test and one to leave stale.
2. **Do not invent a second matcher for the labels.** The submenu is built from
   `entries_for_word`'s output, the same call that decides whether the submenu
   exists at all.
3. **Do not widen `MenuNode::Item`.** Its `&'static str` fields are what make the
   static menu assertable. The dynamic nodes are their own variants.
4. **Do not route a lookup id through `menu_event`.** It returns `None` on
   purpose: one id, one recogniser, and `lookup_entry_id` owns the prefix.
5. **Do not let a prefix with no entry behind it act.** `look_up_reference:` is
   not an entry id.
6. **Do not reorder the word menu.** Thesaurus, then `References`, then the
   separator and the native edit items.


## Revision 7 — theme-painted pages own their colours (palette bug in 5.19a)

### Context

The References pages paint themselves with the writer's editor theme
(`App.vue` passes `theme.currentTheme`), but a dozen rules fell back to the
chrome tokens. Those tokens are not neutral: `useTheme.js` answers `#f0f0f5`
for text and `rgba(20, 20, 25, 0.78)` for surfaces whenever `viewMode` is not
`editor`. So the entry page drew near-white text on light paper:

| Preset paper | Theme ink | Chrome text `#f0f0f5` |
|---|---|---|
| Cream `#FFFFE3` | 4.50:1 | **1.12:1** |
| Sky `#DBE1F1` | 8.35:1 | **1.15:1** |
| Mist `#D8D3D6` (the default) | 5.20:1 | **1.30:1** |
| Midnight `#030027` | 8.75:1 | 17.89:1 |

The default theme is Mist, so a fresh install shipped the failure.

**The chrome palette is correct where it is used.** The rail, drawers and
popovers sit on the dark app base. `useTheme.js` is not changed by this
revision and its pinned values stay. What changes is that a theme-painted page
may no longer name a chrome token at all.

### The palette

`src/composables/paperPalette.js` is the single owner. It takes
`{ bg, text, accent }` and returns the custom properties a page spreads onto
its root:

| Token | Derived from |
|---|---|
| `--note-text` | `theme.text` |
| `--note-text-muted` | `theme.text`, alpha raised until it clears 4.5:1 on `theme.bg` |
| `--note-accent` | `theme.accent` |
| `--note-accent-bg` | `theme.accent` at 25% |
| `--note-border`, `--note-field-border` | `theme.text` + `59` |
| `--note-field-bg` | `theme.text` + `14` |
| `--note-hover-bg` | `theme.text` + `1f` |

Muted ink is searched upward from 60% in 2% steps, so hierarchy costs nothing
in legibility. A preset whose own ink is exactly at the floor (Cream, 4.50:1)
gets its ink back for the muted token: nothing fainter clears 4.5:1 there, and
hierarchy on that theme has to come from size and weight instead.

`ReferencesView.vue`, `ReferenceEntryView.vue`, `ReferencesNavDrawer.vue` and
`NotesView.vue` each spread `paperPalette(theme)` and read only `--note-*`. The
fallbacks that remain are neutral (`currentColor`, `transparent`,
`var(--note-text)`), never a chrome colour, so a missing token cannot silently
become dark chrome again. `ReferencesView` and `NotesView` keep painting
`backgroundColor: theme.bg`; the entry page inherits the paper.

### Why a source guard, not just a contrast test

A contrast test cannot see a rule that resolves to a readable value on the
themes it tries. The bug was a rule, not a value, so the recurrence is a rule
too: a new page rule copies a nearby one. S-115 reads the four style blocks and
fails on any chrome token, which is the only check that catches the *next*
offender before it ships.

### Sentences

| ID | Layer | Sentence |
|---|---|---|
| S-113 | unit | it should derive every page colour from the writer's theme, so no page token comes from the dark chrome palette |
| S-114 | unit | it should keep every preset theme's page text and muted text at or above the 4.5:1 AA floor on its own paper |
| S-115 | unit | it should fail when a theme-painted page's style block names a chrome colour token |
| S-116 | e2e | it should paint the entry page's definition in the theme ink on the default light theme |

### Traps

1. **Do not darken the chrome palette to make a page readable.** It is correct
   on the dark app base and its values are pinned by `useTheme.test.js`.
2. **Do not add a fallback to a chrome token.** A neutral fallback fails
   visibly; a chrome fallback fails invisibly, which is how this shipped.
3. **Do not fix the contrast by changing a preset.** The presets are the
   writer's paper; the page adapts to them.
4. **Do not give the page its own copy of the derivation.** Four partial owners
   is what produced four slightly different palettes.

### Out of scope

- The four button kinds, bordered-set unification, chips vs buttons, segmented
  controls, navigable rows, the accordion, disabled format buttons, theme-tinted
  glass, and the entry page's padding rhythm. Those are the design-system pass
  (queue items 3–6); this revision only guarantees that whatever a page draws
  is drawn in the writer's colours.


## Revision 8 — one owner per chrome colour

### Context

The chrome colours had three homes: `:root` in `src/style.css` (the first
paint), the `ui*` computeds in `useTheme.js` (the runtime values), and 39
`var(--token, #hex)` fallbacks restated inside components. Two of those copies
had already drifted:

| Where | Declared | What actually painted |
|---|---|---|
| `--text-secondary` | `#a0a0b0` (opaque) in the stylesheet | `#a0a0b099` (60%) at runtime |
| `.glass` fallback | `rgba(255, 255, 255, 0.04)` | `rgba(20, 20, 25, 0.78)` |

Both are the same failure as revision 7's: a second copy of a colour that no
one reads until the first one is missing, and then reads wrong.

### The rule

One colour, one owner.

- `src/constants/palette.js` publishes `CHROME_PALETTE` and `CHROME_BASE`, the
  colours the chrome paints outside the editor.
- `style.css` declares them for the first paint and takes the runtime values as
  authoritative; the stylesheet's `--text-secondary` now matches.
- `useTheme.js` reads the constants instead of restating them. Inside the
  editor it still derives from `currentTheme`, which is the point of that mode.
- Components name a token with no colour fallback. A neutral fallback
  (`currentColor`, `transparent`) stays allowed: it fails visibly, never with a
  different colour.

This is groundwork for the design pass, not a visual change. The only pixels
that move are the first paint of `--text-secondary` and any element that was
painting `.glass` before the token loaded.

### Sentences

| ID | Layer | Sentence |
|---|---|---|
| S-117 | unit | it should declare the chrome colours identically in the stylesheet and in the runtime palette |
| S-118 | unit | it should restate no colour as a `var()` fallback anywhere in the app's source |
| S-119 | unit | it should publish the chrome palette outside the editor and the writer's theme inside it |

### Traps

1. **Do not add a colour fallback "for safety".** The safe fallback is the
   token; a colour copy is what drifts.
2. **Do not move a theme value into `:root`.** That block is the dark chrome
   before mount, not the editor's paper.
3. **Do not delete `CHROME_BASE`.** `--bg-base`, `--bg-editor` and `--bg-glass`
   are stylesheet-only, and `--bg-base` is what the scroll layer stands on.
