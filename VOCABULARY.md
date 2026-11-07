# Rite — Vocabulary

Term drift is a correctness problem, not a style preference. In this codebase a
wrong word has already hidden two bugs: 5.17 was marked done while its assistant
scope was never wired, and a roadmap row was marked done because a *view* could
display a summary, which is not the same as the summary/outline feature.

Read this before naming anything in a spec, a PR, a commit or a UI string. New
terms get added here **before** they are used elsewhere.

## The one rule: source vs cache

> **The writer writes source. The model writes cache. A human commits anything
> that becomes source.**

- **Source** is authored, permanent and never regenerated. It travels inside the
  `.rite` file. Losing it loses work. Notes, and any future characters or
  glossary entries, are source.
- **Cache** is derived, disposable and rebuildable. It lives outside the
  `.rite` (the 4.7 sidecar). Losing it costs one regeneration. Sections'
  summaries are cache.

If a sentence cannot say which of the two a thing is, the sentence is not ready.

There is no third category. In particular there is **no such thing as an AI
draft**: the model has no write path (`llm.rs` has no tool calling), so text it
produces is either chat output or a summary. Text only becomes source when a
person edits and commits it.

## The reference concepts

| Term | Means | Lives in | Derived or source |
|---|---|---|---|
| **Outline** | the manuscript's own structure: sections in order, with chapters' derived numbers | computed at render (`flattenSections`); nothing stored | derived |
| **Notes** | the writer's markdown about the manuscript: one story overview, one per section, one orphaned draft | `.rite` → `Notes { overview, sections, orphaned }` (`notes.rs`) | source |
| **Summary** | the model's 2–3 sentence neutral recap of one section's prose | sidecar → `AppState.summaries` (`summary.rs`) | cache |
| **Character** | an authored entity and its description (not built) | would be a `.rite` record alongside `Notes` | source |
| **Glossary** | an authored term and its definition (not built) | **undecided** — see below | source |

### Glossary is the open decision

`document.rs`'s `SectionType` comment imagines a glossary as a *section type in
the manuscript*; a reference panel implies an *entry beside* the manuscript.
These are different features: a glossary chapter is exported and word-counted, a
reference entry is not. 5.19 must pick one before anything is built, and the word
"glossary" must not be used for "custom word with where it is used" — that is a
word list, not a glossary.

## Words that must not be used

| Never say | Say instead | Why |
|---|---|---|
| "AI notes", "AI draft", "generated note" | **summary**, or **summary** + "Insert into note" (the user action) | there is no model→note write path; the note field only changes when a writer commits it |
| "recap" in new code or UI | **summary** | one concept, two names. `recap` survives only as the local prop name in `NotesView.vue` and in 5.17's shipped spec prose; do not propagate it |
| "synopsis" | **summary** | a third name for the same string. A synopsis is a summary shown in context, not a different artifact |
| "revision", "save point" | **version** (what a writer restores), **snapshot** / **delta** (how it is stored), **entry** (a row in the history list) | history already has four precise words |
| "checkpoint" as a noun for a stored thing | **checkpoint** = the *action*; the record it produces is a **snapshot** | after 6.8 a checkpoint may record nothing at all, so it cannot name a record |
| "sidebar" | **drawer** (left/right), **panel** (content inside a drawer), **view** (Editor / Manuscript / Notes / History) | four different surfaces, one vague word |
| "tab" alone | **view tab** for the toolbar, **conversation tab** for an assistant session | the toolbar's `view-tab` and the assistant's chat sessions both call themselves tabs |
| "document" for the writer's text | **manuscript** for the text; **document** for the data object and the file | the UI tab says Manuscript, the model says `Document` — keep them apart in copy |
| "AI", "the AI" in UI or code | **Assistant** (the feature), **model** (what generates), **LLM** (the integration, `llm_*`) | "AI" is a design-prose word; it is not a name for a component |
| "mode" for a context scope | **scope** (the value), **Feedback Target** (the control's label) | `viewMode` already owns "mode" in `App.vue` |

## Naming rules

1. **Anything the model wrote is labelled as such in the UI.** A generated
   summary shown beside the writer's own note without a label is a defect
   (`B-004`), because it invites exactly the misreading this page exists to
   prevent.
2. **A term is one word in the data, one word in the code, and one word in the
   UI.** If the data says `summaries`, the UI does not say "recaps".
3. **A concept gets its own word only if it has its own field, command or
   table.** Otherwise it is a display of an existing thing.
4. **Specs use these words; they do not invent synonyms in prose.** A spec that
   needs a new word adds it here first, in the same PR.
5. **Do not rename shipped history.** `SPEC-5.17-notes.md` says "recap" because
   that is what was approved and built; the vocabulary applies to new work.
