# Save As and document title independence

## Context

**The bug.** `saveDocument()` in `src/stores/document.js` derives the document title
from the file path on every save:

```js
this.doc.title = path.split(/[\\/]/).pop().replace(/\.(fwd|rite)$/, '')
```

That runs for quick Save as well as Save As. Consequences today:

- The title stored inside a `.rite` file is discarded on the first save. Open a file
  whose stored title is "Chapter One", press Cmd+S, and the title becomes the filename.
- The Title field in **General Options → Document Info** (`GeneralOptionsDrawer.vue`,
  bound to `store.doc.title` with `store.markModified()`) accepts edits that the next
  save silently throws away.
- So the document title is not a property of the document; it is a rendering of the
  last filename used.

**The change.** The title becomes independent of the filename. It is set by the New
prompt, by opening a file, or by editing it in Document Info. Saving never rewrites it.
The status bar shows the title *and* the current filename so both remain visible.

### Decisions (already agreed; do not re-litigate in the implementation)

1. Title is independent of filename. Save and Save As never change it.
2. On the first save of a document with no path, the save dialog proposes the title as
   the filename. This is a convenience default only — it does not couple the two.
3. Save As proposes the **current filename** when the document has a path, and the
   title only when it does not. (After the split, seeding from the title would propose
   a misleading name.)
4. Save As **always writes** to the chosen path: modified or not, and whether or not the
   target exists. There is no app-level "file already exists" confirmation — the native
   save dialog already confirms replacement, and asking twice is worse than not asking.
5. Save As to the path the document already has is a plain rewrite. No special case.
6. The status bar shows the basename **including the extension** (`novel.rite`), which
   is what Word and Pages show. The full path is not shown.
7. The status bar shows no filename at all for a document that has never been saved.

### Constraints

- **No Rust change is needed.** `Document.title` is a serialised field of the `.rite`
  file (`src-tauri/src/document.rs`) and `open_document` returns it verbatim. Making the
  title independent makes it round-trip correctly; the Rust side already behaves.
- **Existing tests inverted, not weakened.** `src/composables/useFileIO.test.js` holds
  two assertions that encode the old coupling, and both are reversed on purpose:
  - the title assertion expects `novel-copy` after Save As; under this spec it expects
    the title to be unchanged.
  - the Save As dialog assertion expects `defaultPath: 'Novel.rite'` for a document
    titled "Novel" already saved as `novel.rite`; under decision 3 it expects
    `'novel.rite'`, because the proposal is the current filename when a path exists.

  Both reversals are intentional, dated decisions, not loosened tests. Anything else in
  these files stays as it is.
- The status bar receives the filename as a new `fileName` prop. `App.vue` wiring is
  implementation, not fixture.
- Do not touch the native menu: that is the next feature, and it depends on the rules
  decided here.

### Out of scope

- Any native menu / bottom-bar restructuring.
- Renaming a document from the status bar (Document Info already does it).
- Changing how `open` seeds a document's title.

## Sentences

**Unit — save and title independence**

**S-001** (unit) — Saving to the current path should write the document without changing
its title.

**S-002** (unit) — Save As should write the document to the chosen path and make
subsequent quick saves use that path.

**S-003** (unit) — Save As should not change the document title.

**S-004** (unit) — Save As should write over a path that already exists without an
additional confirmation.

**S-005** (unit) — Save As on an unmodified document should still write to the chosen
path.

**S-006** (unit) — Save As to the path the document already has should still write the
document.

**S-007** (unit) — The Save As dialog should propose the current filename when the
document has a path, and the document title when it does not.

**S-008** (unit) — Opening a document should adopt the title stored in the file.

**S-009** (unit) — Cancelling the Save As dialog should leave the path and the title
unchanged.

**Rust**

**S-010** (rust) — Saving a document and reopening it should return the same title.

**Unit — Document Info**

**S-011** (unit) — Editing the title in Document Info should mark the document as
modified and keep the new title after a save.

**Unit — status bar**

**S-012** (unit) — The status bar should show the document title.

**S-013** (unit) — The status bar should show the basename of the current file,
including its extension, when the document has a path.

**S-014** (unit) — The status bar should show no filename when the document has no path.

**S-015** (unit) — The status bar should show `Untitled` when the document has no title.

**e2e**

**S-016** (e2e) — Saving a new document should show its title and the chosen filename in
the status bar.

**S-017** (e2e) — Save As to a new name should change the filename shown and leave the
title unchanged.
