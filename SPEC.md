# 5.18 — Indent and tab characters

Approved sentence list for the spec-to-tests stage. The tests are already written
and red; they define what "done" means. This file is the implementer's whole
context — nothing here refers to any conversation.

## Context

### What the writer gets

Word's keyboard model for a manuscript, with the two concepts kept distinct:

- **Indent** stays a *paragraph property*. A first-line indent is a number of
  inches stored beside the text, not characters in it. It applies to the first
  line of the paragraph, is invisible to word count and search, and is removed by
  a formatting action, not by Backspace.
- **Tab** is a *text character* (U+0009). It sits in a run's `content`, is one
  character long, can be selected and deleted, and advances the pen to the next
  tab stop wherever the caret is.

A paragraph may have both. A 0.5-inch first-line indent plus a leading tab puts
the first word one inch in: the indent shifts the line start, then the tab
advances to the next 48 px stop after it. This was measured in the app's real
engine (system WebKit / WKWebView 20621, Safari 26.3, macOS 15.7.4):
`text-indent: 48px` + leading tab → 96 px; `text-indent: 96px` + leading tab →
144 px; no indent + leading tab → 48 px. `tab-size: 48px` with
`white-space: pre-wrap` is honoured exactly; without `pre-wrap` the tab collapses
to a space (WebKit's default tab is 35.56 px).

### How indent works today — and what has to change

`Paragraph` (`src-tauri/src/document.rs`) already carries `left_indent`,
`right_indent` and `first_line_indent` as `Option<f32>` in inches. But
`first_line_indent` is not user data today: it is **derived on every render and
every readback** from `computeFirstLineIndent(blocks, i)` in
`src/composables/useSectionBlocks.js` (0 for the first paragraph after a section
title and after an empty paragraph, 0.5 otherwise), and the derived number is
written into the model by `fullSyncFromDOM` and the localized `syncFromDOM`. A
stored value cannot survive, and no UI sets one — `Ruler.vue`, the only component
that could, is not mounted anywhere in the app.

Exports ignore all three indent fields today: DOCX writes `<w:p>` with no
`<w:ind>`, EPUB writes a bare `<p>`. That gap becomes visible the moment a
writer can set an indent, so this feature closes it.

### The model chosen for "automatic unless overridden"

`first_line_indent` gets three meanings, using the existing field only (no new
field on `Paragraph` — protected Rust tests construct it with every field
spelled out, and a new field would break their compilation):

- `null` → **automatic**: `computeFirstLineIndent` decides, as today.
- a number → **explicit**: that value wins, including `0` (flush).

To survive a DOM→model readback, the two cases are marked in the DOM:

- A paragraph following the automatic rule renders `data-auto-indent="true"` and
  the computed inline `text-indent` as today.
- An explicit paragraph renders no marker; its value lives in the existing inline
  `style="text-indent:Npx"`, and an explicit 0 keeps the existing
  `class="paragraph no-indent"`.

Readback (`parseParagraphElement`) therefore returns `null` when the marker is
present, and otherwise parses the inline indent (`no-indent` → 0). The two sync
paths must stop overwriting `firstLineIndent` with the computed value; they keep
what the parser returned.

The baked block list passed to the renderer is unchanged in spirit: automatic
paragraphs are baked to their computed number **on the shallow copy only**
(`buildEditorHTML`, `manuscriptDisplay.vue`), and the copy carries
`autoIndent: true` so `paragraphToHTML` emits the marker. The model itself keeps
`null`. This keeps the existing protected rendering contracts intact: a block
with a numeric `firstLineIndent` and no `autoIndent` flag must render byte-identical
HTML to today.

### Migration note

Documents saved before this feature carry derived numbers (0/0.5) in every
paragraph. Under the new rule those read as explicit, so their indents freeze
where they were saved. That is acceptable: the rendering is identical until the
document structure changes. A load-time normalisation is out of scope.

## Decisions

1. **Tab at the start of a paragraph indents; elsewhere it tabs.** "Start" means
   the caret sits at offset 0 of the paragraph with no selection.
2. **Ctrl+Tab inserts a literal tab anywhere**, including at a paragraph start —
   the only way to get a real tab where plain Tab means indent.
3. **Shift+Tab removes, it does not leave.** With a tab immediately before the
   caret it deletes that tab; at a paragraph start it lowers the indent one
   0.5-inch step (to a floor of 0, where an automatic 0.5 becomes an explicit 0);
   otherwise it does nothing.
4. **Escape leaves the editor** when no search panel, drawer or focus mode wants
   the key. The existing Escape chain in `useKeyboardShortcuts.js` keeps first
   refusal; the editor is the last fall-through. Focus moves to the next
   focusable control outside the sheet — the page must never trap the keyboard
   now that Tab is captured.
5. **Tab stops are fixed at 0.5 in (48 px) from the paragraph's left content
   edge** and are not user-settable. A tab advances to the next stop past the
   current pen position.
6. **Section titles are not an editing surface for tabs.** The key handler runs
   only for body paragraphs; a Tab in a title keeps the browser's focus
   movement.
7. **The key decision lives in a pure helper.** `resolveTabAction` in
   `src/composables/useEditorTabKey.js` maps a key event plus the editor context
   to `insert-tab` / `set-indent` / `delete-tab` / `none`; `editorDisplay.vue`
   performs the action. This is the unit-test seam for the key rules.
8. **The tab-stop styling belongs in CSS, not in the paragraph's HTML.** The
   protected reconcile test pins the exact paragraph HTML string
   (`style="text-indent:48px"`), so `white-space: pre-wrap` and
   `tab-size: 48px` go on `.editor-sheet :deep(.paragraph)` and on the
   manuscript's `.ms-para` rule.
9. **Exports carry both.** DOCX: `<w:tab/>` for each tab and
   `<w:ind w:firstLine="…"/>` (twips) for an explicit indent. EPUB: the tab
   character survives and the package carries whitespace/tab-stop/indent rules
   (inline or a stylesheet — either satisfies the tests). Plain text and Markdown
   keep the tab character and cannot express indent.
10. **Undo already journals indent changes.** `compute_paragraph_ops` compares
    whole paragraphs (`old[i] != new[j]`), so an indent-only change is an
    `UpdateParagraph` and inverts correctly.

## Sentences

### Indent — a paragraph property

- **S-001** (e2e) — Tab at the start of a section's first paragraph (automatic indent 0) sets an explicit 0.5-inch first-line indent and inserts no character.
- **S-002** (e2e) — Tab at the start of a paragraph already at the automatic 0.5 inches raises the indent to 1 inch, the next 0.5-inch step.
- **S-003** (e2e) — A Tab-set indent survives further typing in the document and the `sync_document` that follows it.
- **S-004** (unit) — After a readback, a paragraph whose indent was never set keeps a `null` indent and still follows the automatic rule.
- **S-005** (unit) — After a readback, a paragraph with an explicit indent keeps that exact value, including 0, which stays flush.
- **S-006** (unit) — Shift+Tab at the start of a paragraph lowers the indent by one 0.5-inch step and stops at 0; an automatic 0.5 becomes an explicit 0.

### Literal tab — a text character

- **S-007** (e2e) — Tab in the middle of a paragraph inserts exactly one U+0009 at the caret and keeps focus in the editor.
- **S-008** (e2e) — The inserted tab reaches the model: the paragraph in the synced document contains U+0009 at that position.
- **S-009** (e2e) — Tab with text selected replaces the selection with one tab character.
- **S-010** (e2e) — Ctrl+Tab at the start of a paragraph inserts a literal tab and leaves the first-line indent unchanged.
- **S-011** (unit) — Shift+Tab immediately after a literal tab deletes that tab and nothing else; with no tab before the caret and the caret not at the paragraph start it changes nothing.
- **S-012** (e2e) — Tab with the caret in a section title inserts no character and moves focus out of the title.

### Leaving the editor

- **S-022** (e2e) — Escape with the caret in the editor, when no search panel, drawer or focus mode is open, moves focus out of the editor; typing afterwards does not change the document.

### The two stay distinct

- **S-013** (e2e) — Indent and tab are independent: after a Tab-set 0.5-inch indent, a literal tab inserted mid-line, then Backspace, the paragraph's text loses only the tab and the indent is still 0.5 inch.

### Rendering

- **S-014** (e2e) — Editor body paragraphs compute to `white-space: pre-wrap` and `tab-size: 48px`, so a tab is preserved rather than collapsed.
- **S-015** (e2e) — A literal tab advances to the next 48 px stop from the paragraph's left content edge: 48 px with no indent, 96 px under a 0.5-inch indent.
- **S-016** (e2e) — The manuscript view preserves whitespace with the same 48 px stops and renders a leading tab at the same offset as the editor.

### Exports

- **S-017** (rust) — DOCX export writes a tab as `<w:tab/>` and leaves no literal U+0009 inside `<w:t>`.
- **S-018** (rust) — DOCX export writes a first-line indent as `w:ind w:firstLine` in twips (0.5 in = 720).
- **S-019** (rust) — EPUB export preserves the tab character and applies the first-line indent in its XHTML and stylesheet.

### Undo

- **S-020** (e2e) — One undo after a Tab-set indent restores the previous indent.
- **S-021** (e2e) — One undo after a literal tab removes the tab and restores the text.

## Out of scope

No custom tab stops, no ruler markers, no leader dots, no "show formatting marks".
No indent controls besides these keys (the Ruler stays unmounted). No tab in
section titles. No multi-paragraph indent when Tab is pressed over a selection —
the selection is replaced by one tab character (S-009).

---

# Automatic first-line indent on Return — follow-up to 5.18 (S-023–S-033)

## Context

### The report

Pressing Return in the editor produces a paragraph with `text-indent: 0px` and
`class="paragraph no-indent"`, and the model stores `firstLineIndent: 0`. The
indent is therefore explicit, not automatic, and it never recovers. Measured on
`feature/5.18-tab-characters` before this work, with a two-paragraph section and
typing "Hello", Return, "World": `computeFirstLineIndent` said the new paragraph
should be `0.5`, the DOM said `no-indent`.

### Cause

`editorDisplay.vue`'s Enter branch calls `execCommand('insertParagraph')` and
then forces the caret paragraph flush:

```js
para.style.textIndent = '0px'
```

It also gives that paragraph a fresh id and pins its section id, which stay. The
`0px` is read back by `parseParagraphElement` as an **explicit 0**, so the
automatic rule never applies. The comment above it ("New paragraphs start flush
so the user controls the indent explicitly") encodes the old model and must be
reversed.

There is a second, pre-existing gap this spec closes: `paragraphToHTML` never
emits the `data-auto-indent="true"` marker, and `buildEditorHTML` does not flag
its baked copies with `autoIndent`. The 5.18 Context requires both. Without them,
the first readback after a render parses every automatic paragraph as an explicit
number, so an Enter-created automatic paragraph would lose its status on the next
full render. Existing 5.18 tests do not pin this, which is why the suite was green
while the app was not.

### The 5.18 model this builds on

- `Paragraph.first_line_indent` is `Option<f32>` and carries three meanings:
  `null` = automatic, a number = explicit (including explicit `0` = flush). Do
  **not** add a field to `Paragraph`: protected Rust tests construct it with every
  field spelled out.
- The automatic rule is `computeFirstLineIndent(blocks, i)` in
  `useSectionBlocks.js`: 0 for the first block, 0 after a section title, 0 after
  an empty paragraph, 0.5 otherwise.
- The DOM distinguishes the two cases with `data-auto-indent="true"` on automatic
  paragraphs. `parseParagraphElement` returns `null` when the marker is present;
  otherwise it parses the inline `text-indent` (`no-indent` → 0).
- `buildEditorHTML` bakes the computed number onto a **shallow copy** only, so the
  store keeps `null`. Per 5.18, the copy must also carry `autoIndent: true` so
  `paragraphToHTML` can emit the marker. An explicit paragraph must keep rendering
  byte-identical HTML to today (no marker).
- The readback paths (`fullSyncFromDOM`, `syncFromDOM`) stamp the marker and the
  computed display indent on automatic paragraphs, but must never overwrite the
  parsed value.

### Browser behaviour measured for this spec

Measured in Chromium through the project's Playwright harness:

- Return at the **end** of a paragraph leaves the original intact and inserts a
  new empty paragraph after it.
- Return at **offset 0** keeps the original paragraph's id on an **empty**
  paragraph above, and moves the original text into a **new** paragraph below it.
  S-030 is written against this measured behaviour, not against the intuitive
  "text stays put" wording.
- The browser copies the previous paragraph's inline `text-indent` (and sometimes
  its `data-para-id`) onto the new paragraph. The existing handler already
  replaces the id; this feature replaces the copied indent with the automatic
  rule's result.

### Scope and layers

S-032 is `unit` because `buildEditorHTML` is pure. Every other sentence is `e2e`:
caret position, key default actions and computed indent need a real viewport.
There is no `rust` sentence — `Option<f32>` already serialises `null` to `None`.
The manuscript view needs no sentence of its own: it already bakes
`computeFirstLineIndent` from the model, so a `null` model value flows through.

Out of scope: inheriting an explicit indent into the next paragraph (the approved
default is that Return always produces an automatic paragraph), any Rust change,
and any UI for setting indents beyond the 5.18 Tab rules.

## Sentences

### Automatic indent on Return — `e2e`

- **S-023** — Pressing Return at the end of a non-empty body paragraph that is not a section's first paragraph gives the new paragraph a 0.5-inch (48 px) first-line indent as soon as it appears, before any typing.
- **S-024** — Pressing Return at the end of a section's first body paragraph makes the new second paragraph indent 0.5 inch.
- **S-025** — Pressing Return inside a non-empty paragraph splits it: the text after the caret moves to the new paragraph, which gets a 0.5-inch indent, while the original keeps its id and the text before the caret.
- **S-026** — Pressing Return in an empty body paragraph gives the new paragraph no first-line indent, and the new paragraph is automatic, because the automatic rule gives 0 after an empty paragraph.
- **S-027** — The paragraph created by Return is automatic in the model: after the sync that follows it, `firstLineIndent` is `null` and the element carries `data-auto-indent="true"`.
- **S-028** — Typing into the paragraph created by Return does not turn its indent into an explicit 0: it stays `null` and keeps the 0.5-inch render.
- **S-029** — An automatic paragraph created by Return keeps its automatic indent after a later edit elsewhere in the document triggers a sync.
- **S-030** — Pressing Return at the very start of a paragraph leaves an empty paragraph holding the original paragraph's id and moves the text into a new paragraph; both follow the automatic rule, so the text paragraph, now after an empty paragraph, is flush and stays automatic.
- **S-031** — A paragraph created by Return after a paragraph with an explicit Tab-set indent shows the automatic 0.5 inch, not the explicit value.

### Automatic marker on render — `unit` + `e2e`

- **S-032** *(unit)* — `buildEditorHTML` marks a paragraph whose model `firstLineIndent` is `null` with `data-auto-indent="true"` and the computed `text-indent`; a paragraph with a numeric explicit indent renders without the marker and byte-identical HTML to today.
- **S-033** *(e2e)* — On load, an automatic paragraph carries `data-auto-indent="true"`, and typing in it then syncing leaves its model `firstLineIndent` `null`.
