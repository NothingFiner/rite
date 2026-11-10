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
| `.reference-entry[data-entry-id]` | one row on the Characters or Glossary surface |
| `.reference-empty` | the empty surface message |
| `.reference-add` | the add control |
| `[data-add-kind="term\|character\|place"]` | its three options |
| `.reference-entry-view` | the detail page root |
| `.reference-definition` | rendered markdown definition |
| `.reference-definition-empty` | the empty state when no definition exists |
| `.reference-definition-source` | the editable definition field |
| `.reference-save` | commit the definition |
| `.reference-alias` / `.reference-tag` / `.reference-fact` | detail chips and rows |
| `.reference-alias-input` / `.reference-alias-add` / `.reference-alias-remove` | add an alias, and remove one |
| `.reference-name` / `.reference-name-error` | the entry's name field, and the refusal naming the entry that owns the name |
| `.reference-entry-heading` | the entry's display name at the top of its page |
| `.reference-definition-edit` / `.reference-edit-cancel` | edit a committed definition, and abandon the edit |
| `.reference-kind-toggle` | switch an entry between term and place |
| `.reference-section-option[data-section-id]` | one section in the appears-in add picker |
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

5.19a shipped the record and the read-only half. The writer could create an entry but not name it, could not correct a mention, could not re-edit a committed definition, and got no feedback when an add landed on a surface they were not looking at. S-026 onward close that gap. They are new behaviour, not bug fixes: the earlier sentences were satisfied as written.

Decisions the implementer needs:

- **Naming is in place on the entry page**, committed the way the definition is. No `PromptModal` on create. The page heading shows the display name; a blank name reads `Untitled term` / `Untitled character` / `Untitled place` (S-026).
- **Adding an entry switches the drawer** to the surface that lists it (S-038). A term added from Characters currently lands in a list the writer cannot see, so the click reads as a no-op.
- **A committed definition keeps an edit path** (S-030–S-032): an edit control reopens the source field holding the current text, saving replaces it, cancelling discards.
- **Mentions are correctable in the UI** (S-033–S-035), and **adding a section back must clear its exclusion** (S-036). Without that last rule the control is a dead end: `deriveMentions` skips an excluded section before it looks at inclusions, so an exclusion outranks an inclusion for the same section and a removed mention can never come back.
- **Aliases are editable** (S-041–S-043). The worked example needs `Essidor Agjadoff` to trigger a mention; with aliases display-only the record cannot express it. Tags and facts stay display-only in this change.
- **`place` keeps its kind but loses its own creation button.** Glossary's single add control creates a term, and the page switches an entry between term and place (S-047). Character is not switchable — that would move the entry to another surface. The two kinds are structurally identical today; the kind survives because it is single-valued, schema-bearing, already persisted, and the only place future place-specific fields can attach. Dropping it needs a schema migration and is not this change.
- **The References panel is permanent in the References view** (S-049–S-052). It is the only navigation for entries: closing it leaves the view showing "Choose an entry in the drawer." with no drawer to choose from. It stays collapsible in every other view, where it is a tool drawer over the text. Closing another panel while in References must fall back to it, not to no panel.
- **Regenerate all belongs to the Assistant panel** (S-045–S-046). It refreshes every section summary, which is a manuscript-wide action; it was sitting in the References drawer. Moving it supersedes the 5.20a drawer sentences that pinned the control's old home: their unit tests are removed, the per-section regenerate they also guarded stays where it was, and `SPEC-5.20-references.md` records the supersession. A coder cannot resolve this class of conflict, because the old test is protected — the spec stage has to retire it.
- **Surface head and add control reuse existing chrome.** The connected tab group is `.view-tabs` in `Toolbar.vue`; the plus is `.add-btn` in `NavigationDrawer.vue`. Design directives, not testable — do not invent a third style.
- **The References rail icon is out of scope.** It draws a bookmark where a library glyph belongs; that change was deferred and must not ride on this one.
- **`VOCABULARY.md` still lacks Reference entry / Place / Glossary.** 5.19a's spec requires them in the same change. That duty was not done and carries over to this one.

The rail-icon sentence was removed from the approved list when the icon work was deferred, and it has no ID here on purpose: this file is scanned for every `S-nnn` token, and an ID with no test reads as a missing test. S-049–S-051 are tagged `e2e`, not `unit`: they are `App.vue` shell behaviour, and the repository has no `App` mount test, so a unit test would require a helper that does not exist — that would be implementation, not a sentence.

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
| S-049 | e2e | it should keep the References panel open whenever the References view is active, and refuse to close it there |
| S-050 | e2e | it should return to the References panel when the writer closes another panel while the References view is active |
| S-051 | e2e | it should keep the References panel open when the writer clicks the References rail item while it is already showing |
| S-052 | e2e | it should show the References panel on entering References and still show it after opening and closing Stats |
