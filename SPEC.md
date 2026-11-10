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

## Sentences

| ID | Layer | Sentence |
|---|---|---|
| S-001 | rust | it should store a references record in the `.rite` file beside the notes record, and read a file without one as an empty record |
| S-002 | unit | it should keep one flat list of reference entries, each with an id, a kind, a name, a definition, aliases, tags and facts |
| S-003 | unit | it should support three kinds — term, character and place — and give a place the same shape as a term |
| S-004 | unit | it should offer Outline, Characters and Glossary in the References drawer head, with all three enabled |
| S-005 | unit | it should list character entries on the Characters surface and term and place entries on the Glossary surface |
| S-006 | unit | it should offer one add control with New term, New character and New place |
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
