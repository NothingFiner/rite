# SPEC — EPUB export

**Status:** approved. Implement exactly these behaviours; do not weaken or edit the tests.

Export the live document as an EPUB 3 package, from the status bar, alongside the
existing `.txt` / `.md` / `.docx` exports.

## Sentences

### Package structure — rust

**S-001** (rust) — It should produce a ZIP archive whose first entry is `mimetype`,
  stored uncompressed, whose contents are exactly `application/epub+zip`.

**S-002** (rust) — It should include `META-INF/container.xml` naming `OEBPS/content.opf`
  as the rootfile.

**S-003** (rust) — It should include `OEBPS/content.opf` declaring `version="3.0"`, with
  a manifest entry for every XHTML file it emits.

**S-004** (rust) — Every manifest item should exist in the archive, and every spine
  item should reference an id declared in the manifest — no dangling references in
  either direction.

### Content — rust

**S-005** (rust) — It should emit one XHTML document per visible section, in document
  order, and the spine order should match that order.

**S-006** (rust) — It should render each paragraph of a section as a `<p>` element,
  preserving the paragraph's run text exactly.

**S-007** (rust) — It should render a Chapter heading as the derived `Chapter N: title`,
  numbering only Chapter-type sections.

**S-008** (rust) — It should render a subtitle-less chapter as `Chapter N` with no
  trailing colon.

**S-009** (rust) — It should map bold, italic and underline runs to `<strong>`, `<em>`
  and `<u>`.

**S-010** (rust) — It should XML-escape `&`, `<`, `>` and `"` in text content.

**S-011** (rust) — It should skip hidden sections entirely: no XHTML file, no manifest
  entry, no spine entry and no nav entry.

**S-012** (rust) — It should number visible chapters contiguously, so a hidden chapter
  between two visible ones leaves no gap in the numbering.

**S-013** (rust) — It should emit `OEBPS/nav.xhtml` listing every visible section in
  document order, marked as the navigation document in the manifest.

**S-014** (rust) — It should emit a title page carrying the document title and author,
  and should not include `authorContact` anywhere in the package.

**S-015** (rust) — It should set the package title and author metadata from the document,
  falling back to `Untitled` and `Author Name` when they are blank.

**S-016** (rust) — It should still produce a valid package with an empty spine when
  the document has no visible sections.

### Command — rust

**S-017** (rust) — `export_epub(path)` should write the package atomically, leaving no
  partial file at `path` when the export fails.

**S-018** (rust) — `export_epub(path)` should return `Err` when the target directory does
  not exist.

### Frontend wiring — unit

**S-019** (unit) — `exportEpub()` should open a save dialog filtered to `epub`,
  defaulting to `<title>.epub`.

**S-020** (unit) — It should invoke `export_epub` with the chosen path and nothing else.

**S-021** (unit) — It should invoke nothing when the save dialog is cancelled.

**S-022** (unit) — It should show an error dialog when the invoke rejects.

**S-023** (unit) — It should default the proposed filename to `Untitled.epub` when the
  document title is blank.

### Reachability — e2e

**S-024** (e2e) — The status bar should show an `Export .epub` button that invokes
  `export_epub` with the path the save dialog returns.

## Context

### What already exists (do not rebuild it)

- **`src-tauri/src/export_docx.rs` is the template.** It emits OPC parts by hand and
  hands the bytes to the `zip` crate (`zip = "2"`, default-features off, `deflate`).
  EPUB is the same shape: a ZIP of XML parts. Use `zip::write::SimpleFileOptions`
  the way `export_docx` does; no new dependency is needed.
- **`history::atomic_write`** is the atomic write path used by every export
  (`export_text`, `export_docx`). Use it for S-017; do not hand-roll temp-file logic.
- **The command pattern** is `export_docx(path: String, state: State<AppState>) -> Result<(), String>`:
  clone the document out of `AppState`, render, write. `export_epub` mirrors it.
  Register the command in `lib.rs`'s `tauri::generate_handler!` list — the tests cannot
  observe registration, so this is on you.
- **`src-tauri/src/lib.rs`** is the library target; integration tests import
  `rite_lib::export_epub::document_to_epub`. The module is already declared and stubbed.
- **Frontend:** `src/composables/useExport.js` holds `exportPlainText` / `exportMarkdown` /
  `exportDocx`. `exportEpub` is stubbed there. UI buttons live in
  `src/components/StatusBar.vue` (flat row of `btn-ghost` buttons), emitted up to
  `App.vue` (`@export-docx="exportComposable.exportDocx"`). Mirror that wiring exactly.

### Decisions that are intentional (do not "fix" them)

1. **Hidden sections are skipped in EPUB only.** `export_text.rs:85` deliberately keeps a
   hidden section's *body* and drops only its header. EPUB is a reader-facing artifact, so
   here a hidden section disappears completely (S-011). The two exports disagree on
   purpose; do not change `export_text`.
2. **Chapter numbering is derived positionally** among *visible* chapters (S-012). A hidden
   chapter must not consume a number, unlike `export_text`, which advances the counter for
   hidden chapters to keep manuscript numbering stable.
3. **`nav.xhtml` is always emitted**, regardless of `Document.has_toc`. That flag gates the
   *printed* manuscript TOC (`manuscriptDisplay.vue:161`), not the ebook navigation.
4. **`authorContact` is never exported** (S-014). It is manuscript-submission data
   (address, phone, email), not reader-facing metadata.
5. **`mimetype` must be the first entry and stored** (S-001). Readers use it to sniff the
   format; a deflated or misplaced `mimetype` makes an EPUB unopenable even though the
   archive is otherwise valid. `zip` needs `CompressionMethod::Stored` for that one entry.
6. **Escaping is manual.** The existing exporters escape by hand
   (`escape_html` in `useParagraphHTML.js` is the frontend counterpart). There is no XML
   library in the crate; do not add one.
7. **The title page is a manifest item but not a spine item.** S-016 requires an *empty
   spine* when nothing is visible; putting the title page in the reading order would make
   that impossible (and a reader would open an empty book at a title page with no content
   behind it). `nav.xhtml` is likewise a manifest item only.

### Explicitly out of scope

- Cover images (no image field exists on `Document`).
- `toc.ncx` (EPUB 2 fallback) — EPUB 3 `nav.xhtml` only.
- `epubcheck` validation — not installable in CI. The tests assert the structural
  invariants from S-001…S-016 instead.
- Changing `.txt` / `.md` / `.docx` behaviour.

### Test locations

- Rust: `src-tauri/tests/epub_export.rs` (integration, imports `rite_lib`).
- Unit: `src/composables/useExport.test.js`.
- E2E: `e2e/epub-export.spec.js` (mocked IPC; the dialog command is `saveDialog`).
