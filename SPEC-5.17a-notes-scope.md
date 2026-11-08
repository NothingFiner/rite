# 5.17a — Notes scope: read the notes, not the manuscript

Approved sentence list for the spec-to-tests stage. The tests are written and
red; they define what "done" means. This file is the implementer's whole
context. The 5.17 spec this follows is `SPEC-5.17-notes.md`.

Fixes `BUGS.md` **B-001** and **B-002**.

## Context

### What is broken

5.17 shipped a Notes view and an assistant **Notes** scope. The view works. The
scope does not, and the bugs are in the wiring, not in the helpers:

- **B-001.** `LlmPanel.vue` renders `<option value="notes">Notes</option>`, but
  nothing builds the context from the notes. `documentToText` (`useChat.js`)
  early-returns for `selection` and `section`, then treats **every other scope**
  as `document`. So choosing Notes sends the **whole manuscript**, labelled as
  context, and the token readout counts the manuscript.
  `notesToText` (`useNotes.js`) — the function 5.17's spec designates for this
  context — has no production caller.
- **B-002.** `orphanSectionNote` (`useNotes.js`) moves a deleted section's note
  into the orphaned draft. Only its unit test calls it. `store.deleteSection`
  invokes `delete_section` and swaps in the returned document, never touching
  `notes`, so the note survives in the `.rite` under a section id that no longer
  exists: invisible in the Notes list, never orphaned, and still sent to the
  model.

Both bugs pass their unit tests because the tests call the helpers directly. A
unit test proves a helper is correct, not that anything calls it.

### The notes record (do not change its shape)

`Notes` is document-level and **not** part of `Document`:

```
{ overview: String, sections: { "<sectionId>": String }, orphaned: String }
```

Stored in the `.rite` file beside the document and its history. Rust exposes
`retrieve_notes` (read) and `update_notes` (replace) — `src-tauri/src/notes.rs`,
`commands.rs`. Notes are markdown source. A section with no note has no key.
Notes stay out of exports, word count and version-history snapshots.

`useNotes.js` already owns the pure translations:

- `notesToText(notes, sections)` — the assistant context. The preamble line
  ("These are the author's notes about the manuscript, not manuscript prose.") is
  **unconditional**, so an empty record still explains what the text is. It
  includes the overview and every non-empty section note in document order, and
  **omits `orphaned`** by design (it describes text the manuscript no longer
  contains).
- `orphanSectionNote(notes, section, displayTitle?)` — appends one deleted
  note under a `## <displayTitle>` heading and deletes the section key.
- `writeNote(notes, id, text)` — blank text deletes the key.

### Wiring decisions (the implementer must follow these)

1. **`useChat` gains a fifth parameter**, `notesRef`: a ref-like `{ value: Notes }`
   mirroring `docRef` (`docRef.value`). Default to an empty record when absent, so
   existing callers keep working. `useChatManager` passes it through to every
   session. `App.vue` passes a computed over `store.notes`.
2. **`documentToText` must not serve the notes scope, or any scope it does not
   know.** An unknown scope currently falls through to the whole manuscript; that
   fallback is the bug. Return `''` for `notes` and for anything unrecognised.
   Keep `document` working exactly as it does today.
3. **`notesToText` builds the Notes context.** The message is pushed by the same
   code path as the other scopes, so the label convention is unchanged:
   `Here is the <label> for reference:\n\n<text>`. The label for `notes` is
   `author's notes` — not `current section` (today's accidental fallback in
   `scopeLabel`) and not `full manuscript`.
4. **`notes` joins the whole-manuscript scope set** in `effectiveScope`: a live
   editor selection must not upgrade it to `selection`. A selection is manuscript
   text; sending it under a notes question is exactly the confusion this scope
   exists to avoid. `document`, `passages`, `structure`, `summaries` already
   behave this way.
5. **Section headings in the context use `sectionDisplayTitle`**
   (`useSectionFormat.js`), the shared rule the Notes list and navigation outline
   already use: `"Chapter 3: Ash"`, `"Chapter 3"` when the subtitle is empty,
   `"Untitled Section"` when a section has no title. Never `section.title` raw —
   for a Chapter that is only the subtitle and is legitimately blank.
6. **Hidden sections keep their notes.** The Notes list keeps hidden rows so
   their notes stay reachable; the context must agree. Note the asymmetry that is
   intentional: a hidden section's *prose* reaches the model header-less (5.10),
   but its *note* is author commentary and is included under its title.
7. **Deletion orphans before the document changes.** `store.deleteSection` must
   read the note (and the section's display title) from the **pre-deletion**
   document, because after `delete_section` the section — and its title — is
   gone. Then commit the new record through `update_notes`, which also marks the
   document modified so autosave persists it. Rust is unchanged: notes are not
   part of `Document`, so `delete_section` neither knows nor should know about
   them.

### Why S-013 is worded as "write back"

The approved wording was "leave the orphaned draft unchanged when the deleted
section has no note" — true today, by accident, because deletion never touches
notes at all. As written its test passes before the fix, and this workflow
requires every new test to fail on an assertion. The sentence therefore asserts
the observable consequence that is actually missing: the notes record is written
back after *every* deletion, so the document and the notes cannot drift. It is a
stronger sentence than the one it replaces, not a weaker one.

## Sentences

| ID | Layer | Sentence | Bug |
|---|---|---|---|
| S-001 | unit | it should send the author's notes as the context when the Notes scope is chosen: the story overview, then every non-empty section note in document order | B-001 |
| S-002 | unit | it should send no manuscript prose for the Notes scope, including for a scope the context builder does not recognise | B-001 |
| S-003 | unit | it should label the Notes context as the author's notes, not as the current section or the full manuscript | B-001 |
| S-004 | unit | it should keep the Notes scope when the editor has a live selection, so a selection cannot redirect the context to manuscript text | B-001 |
| S-005 | unit | it should count the notes text in the context-size readout and not the manuscript | B-001 |
| S-006 | unit | it should still send the author-notes preamble when every note is empty, and send no manuscript text | B-001 |
| S-007 | unit | it should omit the orphaned-notes draft from the Notes context even when the draft has text | B-001 |
| S-008 | unit | it should include a hidden section's note in the Notes context, matching the Notes list, which keeps hidden rows reachable | B-001 |
| S-009 | unit | it should head an unnamed chapter's note with its derived chapter title in the Notes context, never a blank heading | B-001 |
| S-010 | e2e | it should ship the notes text to the assistant when Notes is chosen in the drawer, and ship no manuscript prose | B-001 |
| S-011 | e2e | it should send the manuscript again after the scope changes from Notes back to Whole document, with no note text left in the context | B-001 |
| S-012 | unit | it should move a deleted section's note into the orphaned draft under its display title and remove that section's key | B-002 |
| S-013 | unit | it should write the notes record back after deleting a section that had no note, leaving the orphaned draft unchanged | B-002 |
| S-014 | unit | it should omit a deleted section's note from the Notes context, because the orphaned draft is not sent | B-002 |
| S-015 | e2e | it should show a deleted section's note under Orphaned notes and keep it after saving and reopening the file | B-002 |

## Out of scope

- **Deleting the section whose note is currently open in the Notes view.** The
  draft-undo session belongs to that entry; whether the uncommitted draft is
  committed or discarded first is a separate decision. The stored note is
  orphaned either way.
- **The assistant writing notes.** No tool calling exists in `llm.rs`; 5.17's
  spec rules AI generation out. A "save reply as note" action would be new work.
- **Any Rust change.** `retrieve_notes` / `update_notes` already round-trip,
  including the `orphaned` field (`src-tauri/tests/notes.rs`).

## File map

Edited: `src/composables/useChat.js`, `src/composables/useChat.test.js`,
`src/composables/useDocument.test.js`, `src/components/LlmPanel.vue`,
`src/App.vue`, `e2e/helpers/tauri-ipc.mock.js` only if a command is unrouted.

New: `e2e/notes-scope.spec.js`.

No stubs are required: every symbol the tests touch already exists
(`useChat`, `documentToText`, `estimateContextTokens`, `useDocumentStore`,
`notesToText`), and the new `notesRef` parameter is optional in JavaScript. The
tests fail because the behaviour is missing, not because anything is undefined.
