# Rite — Bug log

Defects found outside the spec flow. Every entry gets a stable `B-###` ID, the
same way roadmap items get a `5.x` and spec sentences get an `S-###`, so a commit,
a branch and a sentence list can all point at the same defect.

This is **not** a second roadmap. A bug that needs product decisions is filed here
and promoted to a roadmap item, keeping its `B-ID` as the pointer — the roadmap
says where the work sits, this file says what broke and why.

**Why it exists.** 5.17 shipped with two of its sentences marked done while their
call sites were missing: `notesToText` and `orphanSectionNote` pass their unit
tests because the tests call them directly, and nothing in the app does. A unit
test proves a helper is correct, not that anything calls it. That gap has no home
in the roadmap — an item is "done" or it is not — so it goes here, with the
sentence ID it contradicts.

## Rules

- One entry per defect. An entry keeps its ID forever; closing it changes its
  status, never its number.
- Cite the layer and file where the defect lives, and the test that should have
  caught it.
- Link the spec sentence the defect breaks (`S-009`) or the roadmap item it
  belongs to (`5.17`). If it breaks no sentence, say so — that is how a missing
  sentence gets found.
- A fix commit names its `B-ID` in the subject, the way a feature commit names
  its roadmap item.
- Status is `open`, `fixed (commit)`, or `not a bug (why)`.

## Index

| ID | Bug | Status | Area |
|---|---|---|---|
| B-001 | Notes scope sends the manuscript instead of the notes | open | assistant / notes |
| B-002 | Deleting a section drops its note; the orphaned draft stays empty | open | notes / store |
| B-003 | An unnamed chapter had a blank row in the Notes list | fixed (6b20319) | notes / titles |
| B-004 | A generated summary is shown beside the note with no label saying which is which | open | notes / vocabulary |
| B-005 | The References view hides the whole activity bar | open — bundled into 5.20a | references / drawer |
| B-006 | The generated recap never reaches the note in References | open — bundled into 5.20a | references / notes |
| B-007 | "Go to text" lands one page before the section | open — bundled into 5.20a | references / jump |

---

## B-001 — Notes scope sends the manuscript instead of the notes

**Status:** open — needs a spec (breaks `S-009`).
**Layer:** unit (`src/composables/useChat.js`), plus the drawer option.

**Symptom.** Choosing Feedback Target → **Notes** and sending does not include the
author's notes at all. It includes the *whole manuscript*, labelled as context, and
the token readout in the drawer counts the manuscript. A writer who picks Notes to
ask "is my outline coherent?" gets the prose back as context and a token bill to
match.

**Root cause.** Three separate gaps, each enough to break the scope on its own:

1. `documentToText` (`useChat.js:136`) handles `selection` and `section` with
   early returns, then treats **every remaining scope** as `document`. There is no
   `notes` branch, so `notes` silently falls through to the whole-manuscript
   accumulation.
2. `notesToText` (`useNotes.js:74`) — the function 5.17's spec designates for this
   context — has **no production caller**. `LlmPanel.vue:162` renders the
   `<option value="notes">` and a comment naming `notesToText`; nothing imports it.
3. `scopeLabel` (`useChat.js:441`) has no `notes` case and returns `"current
   section"` for an unknown scope, and `effectiveScope` (`useChat.js:347`) does not
   list `notes` among the whole-manuscript scopes — so a live editor selection
   silently upgrades Notes to `selection`, and the model gets manuscript text under
   a notes question.

**Why the tests missed it.** `useNotes.test.js` asserts `notesToText` builds the
right string. No test asserts the chat path *uses* it. The gap is in the wiring,
which only an assertion on `buildContextMessages` (or an e2e send) can see.

**Fix direction.** Build the Notes context with `notesToText`, and teach
`documentToText` to refuse the `notes` scope the way it refuses an unknown one
rather than returning the manuscript. Add `notes` to the whole-manuscript scope
set so a selection cannot override it. No Rust change: `retrieve_notes` already
returns the record `notesToText` takes.

---

## B-002 — Deleting a section drops its note

**Status:** open — needs a spec (breaks `S-007`).
**Layer:** store (`src/stores/document.js`), Rust (`delete_section`).

**Symptom.** Delete a section that has a note and the note is gone. The
**Orphaned notes** entry at the bottom of the Notes list — the one place 5.17's
spec says deleted sections' notes are collected — stays empty.

**Root cause.** `orphanSectionNote` (`useNotes.js:100`) moves a note out of
`sections[id]` and appends it under a heading in `orphaned`. It is called by
exactly one caller: its unit test. `store.deleteSection` (`document.js:98`) flushes,
invokes `delete_section`, and swaps in the returned document — it never touches
`notes`. Rust's `delete_section` has no knowledge of the notes record, which is
correct: notes are not part of `Document`. So the note survives in the `.rite`
under a section id that no longer exists: invisible in the list, never orphaned,
and still shipped to the model by `notesToText`.

**Why the tests missed it.** Same shape as B-001 — `useNotes.test.js` proves the
helper works, and nothing asserts that deletion calls it.

**Fix direction.** The deletion path reads the note *before* the document changes
(it needs the section title for the heading, and the title is gone afterwards),
then commits the orphaned record through the existing `update_notes` command. The
heading should be the section's display title, not `section.title` (B-003): a
deleted unnamed chapter has no title to head the entry with.

**Open question for the spec.** `orphanSectionNote` keeps the deleted text in the
same notes record under `orphaned`. If the note is also still in `sections[id]`,
the model receives it twice. The fix must delete the key, which the helper already
does — but only if the commit actually happens.

---

## B-003 — An unnamed chapter had a blank row in the Notes list

**Status:** fixed (6b20319).
**Layer:** unit (`src/composables/useNotes.js`).

**Symptom.** A chapter with no subtitle — legitimate since 5.9 — appeared in the
Notes list as a row with no text, and opening it gave a note header with no title.
Notes on such a chapter reached the assistant under a bare `## ` heading.

**Root cause.** `noteEntries` read `section.title` raw. For a `Chapter` that field
is the **subtitle**, so it is legitimately `''`. The navigation outline had already
solved this with a derived `"Chapter 3"` label; the Notes view duplicated the
title read instead of the rule.

**Fix.** `sectionDisplayTitle` (`useSectionFormat.js`) is now the one rule for every
surface: `"Chapter 3: Ash"`, `"Chapter 3"` for a subtitle-less chapter,
`"Untitled Section"` for a blank section. Used by the outline, `noteEntries`,
`notesToText`, and (via an explicit argument) `orphanSectionNote`.

**Tests.** `useNotes.test.js` (S-001, S-009, S-007) and `NotesView.spec.js` (S-001).

---

## B-004 — A generated summary is shown beside the note with no label saying which is which

**Status:** open — needs a spec (breaks no sentence; `VOCABULARY.md` rule 1).
**Layer:** unit (`src/components/NotesView.vue`).

**Symptom.** Open a section's note in the Notes view and, when a summary exists
for that section, a second block of prose appears under the note — the generated
one. Nothing on screen says which is the writer's and which is the model's. A
writer who has not used the assistant will reasonably read the generated text as
their own note, and one who has will not know whether editing it does anything
(it does not: the summary block is read-only).

**Root cause.** `NotesView.vue:81` renders `selectedRecap` in a `.note-recap`
block inside the note pane. The prop is `recaps` and the value comes from
`useSummaries`; no label, heading, icon or attribution appears anywhere in the
markup. The CSS class names are the only thing that distinguishes it.

**Why the tests missed it.** The specs assert the recap *appears* (S-006) and
that "Insert into note" copies it (S-024). None asserts what it is *called*, and
"a block of prose appears" is satisfied by a block with no label.

**Fix direction.** Label it as what it is: the canonical word is **summary**
(`VOCABULARY.md`), so the block reads something like "AI summary" or
"Generated summary" with the section's stale state if any. The note pane's own
heading is the writer's note. Prefer a real heading element so the distinction is
carried to a screen reader, not only to the eye (5.7's rule: naming matters once
reachability is solved).

## B-005 — The References view hides the whole activity bar

**Status:** open — bundled into 5.20a (`S-001`, `S-002`).
**Layer:** unit (`src/constants/drawerVisibility.js`, `src/components/ActivityBar.vue`).

**Symptom.** Choose References and every icon on the left rail disappears. No
drawer can be opened from the rail, and any drawer that was open closes on the
way in. The view looks like a different application.

**Root cause.** `DRAWER_MODES_ALLOWED_IN_VIEW` lists `editor`, `manuscript` and
`history`. `references` is not a key, so `isDrawerModeAllowedIn()` returns false
for every mode and `ActivityBar`'s filtered `items` is empty. `onSetMode()` also
closes an open drawer when its button would vanish, so the drawer closes behind
the writer as well.

**Why the tests missed it.** 5.20 has no sentence about the rail. The 5.20 e2e
suite opens References through the toolbar and never looks at the activity bar,
and `drawerVisibility.test.js` asserted the exact key list — three views — so a
missing fourth was invisible by construction.

**Fix direction.** Add a `references` drawer mode with its own button, and allow
that mode only in its own view. The rail keeps Stats and General Options there.

## B-006 — The generated recap never reaches the note in References

**Status:** open — bundled into 5.20a (`S-014`, `S-015`).
**Layer:** unit (`src/components/ReferencesView.vue`).

**Symptom.** On the References page the generated summary appears under the note
with no way to use it. The "Insert into note" control that shipped in 5.17 is
absent, so model prose sits beside the writer's note and cannot be carried into
it.

**Root cause.** `NotesView.vue` already accepts a `recaps` prop and renders the
`.note-recap` block with `insertRecap`. `ReferencesView.vue` mounts `NotesView`
with `store`, `theme`, `initial-entry-id` and `origin-view`, and never binds
`recaps`. The prop falls back to `{}`, so `selectedRecap` is always empty and the
block never renders.

**Why the tests missed it.** Every `NotesView` test passes `recaps` directly, so
the component is proven correct and nothing proves the shell supplies it. This is
the same shape as 5.17's `notesToText` bug (see the header of this file): a unit
test proves a helper works, not that anything calls it.

**Fix direction.** Derive `{ [sectionId]: summary }` from `summaries.summaryEntries`
in `ReferencesView.vue` and bind it. Do not reimplement insertion; `NotesView`
owns it.

## B-007 — "Go to text" lands one page before the section

**Status:** open — bundled into 5.20a (`S-025`).
**Layer:** e2e (`src/App.vue` jump route, `src/composables/useEditorPageNav.js`).

**Symptom.** From a note, "Go to section" opens the editor with the section one
page above the visible area. The writer sees the end of the previous section and
has to scroll down to find the one they asked for.

**Root cause.** `onReferencesJump` calls `nav.scrollToSection`, which runs
`switchToEditor()` and then a single `nextTick` before asking
`editorDisplay.scrollToSection` to scroll. That helper calls
`focusPageStartInSheet(el, 'smooth', 'center')`: a smooth scroll to the section's
first paragraph, centred. The editor is mounting fresh, so the scroll begins
before the sheet has finished laying out its pages, and `center` leaves nothing
page-aligned to settle against.

**Why the tests missed it.** `references-outline` S-024 and `notes-view` S-017
assert `toBeInViewport()`. A landing one page early still puts the heading inside
the viewport, so both pass. No test compares the landing against the viewport's
top edge.

**Fix direction.** Land the section's title at the top of the scroll viewport,
after the page layout is stamped. The sentence is `S-025`; its e2e assertion
compares the title's y position with the scroll layer's.
