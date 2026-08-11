# fineWrite Architecture Refactor Plan

## Goals

- Build a scalable, personal novel-writing app that comfortably handles 100k+ words.
- Add git-style version history and side-by-side diffing.
- Keep full control over the codebase; avoid heavy editor frameworks like ProseMirror/Lexical.
- Maintain the existing Rust + Vue + Tauri architecture.

## Guiding Principles

- Rust owns the canonical document, history, and document operations.
- The frontend owns segmented rendering and input capture.
- The diff view is read-only static rendering.
- A single delta format serves both autosave journaling and diff rendering.

---

## Phase 1: Rust Document Engine & Delta Protocol

**Foundation for everything else.** Before touching the editor surface, we solidify Rust as the document engine with explicit, invertible operations.

### 1.1 Refactor `Document` and `Paragraph` model

- Keep `document.rs` as the source of truth.
- Ensure every paragraph has a stable `id` (already true).
- Make `TextStyle` comparisons and cloning efficient (derive `PartialEq`, `Clone`).

### 1.2 Define a single `DocOp` delta format

Use paragraph IDs for stable identity rather than indices.

```rust
pub enum DocOp {
    InsertParagraph {
        after_id: Option<String>,
        paragraph: Paragraph,
    },
    DeleteParagraph {
        id: String,
        old: Paragraph,
    },
    UpdateParagraph {
        id: String,
        old: Paragraph,
        new: Paragraph,
    },
    UpdateMetadata {
        field: String,
        old: String,
        new: String,
    },
}
```

Every operation stores both old and new state so it is invertible. This enables future per-change revert.

### 1.3 Implement `compute_delta(old, new) -> Vec<DocOp>`

- Diff paragraph lists by `id`.
- For paragraphs with the same `id` but different content/style/metadata, emit `UpdateParagraph`.
- For inserted/deleted paragraphs, emit `InsertParagraph`/`DeleteParagraph`.
- For document metadata changes, emit `UpdateMetadata`.

### 1.4 Implement `apply_delta(doc, delta)`

- Apply a sequence of `DocOp`s to a `Document`.
- Validate that the `old` state matches before applying (prevents applying stale deltas).
- Return the new `Document`.

### 1.5 Add Rust commands for document operations

Move the following from ad-hoc frontend manipulation to explicit Rust commands:

```rust
pub fn apply_format(
    paragraph_id: String,
    start_offset: usize,
    end_offset: usize,
    format: TextStyleDelta,
    state: State<AppState>,
) -> Result<Document, String>

pub fn split_paragraph(
    paragraph_id: String,
    offset: usize,
    state: State<AppState>,
) -> Result<Document, String>

pub fn merge_paragraphs(
    first_id: String,
    second_id: String,
    state: State<AppState>,
) -> Result<Document, String>

pub fn set_paragraph_style(
    paragraph_id: String,
    style: ParagraphStyle,
    state: State<AppState>,
) -> Result<Document, String>

pub fn insert_heading(
    level: u8,
    after_id: Option<String>,
    state: State<AppState>,
) -> Result<Document, String>

pub fn delete_heading(
    id: String,
    state: State<AppState>,
) -> Result<Document, String>

pub fn rename_section(
    id: String,
    title: String,
    state: State<AppState>,
) -> Result<Document, String>
```

These commands already exist partially; this phase completes and unifies them under the delta model.

### 1.6 Add explicit undo/redo history in Rust

Extend `AppState` with a history stack:

```rust
pub struct AppState {
    pub document: Mutex<Document>,
    pub history: Mutex<Vec<Document>>,
    pub history_index: Mutex<usize>,
    pub max_history: usize,
    pub is_modified: Mutex<bool>,
    pub last_path: Mutex<Option<String>>,
    pub last_history_state: Mutex<Document>,
}
```

Commands that mutate the document push a snapshot before changing state. Add:

```rust
pub fn undo(state: State<AppState>) -> Result<Document, String>
pub fn redo(state: State<AppState>) -> Result<Document, String>
```

### 1.7 Delta response protocol

After mutating commands, Rust should return either:
- the full updated `Document` (simple, used initially), or
- a `Vec<DocOp>` describing exactly what changed (optimization for later).

Start with full-document responses to minimize protocol complexity; move to delta responses if performance requires it.

---

## Phase 2: Version History (Snapshots + Deltas)

**Storage-efficient versioning for arbitrary historical versions.**

### 2.1 Sidecar history directory structure

```
MyNovel.fwd
MyNovel.fwd.history/
  snapshots/
    2026-07-19T10-00-00.fwd
    2026-07-19T15-30-00.fwd
  deltas/
    2026-07-19T10-05-00.delta
    2026-07-19T10-11-00.delta
```

### 2.2 Snapshot policy

- Full snapshot on explicit save.
- Full snapshot on manual checkpoint.
- Optional daily snapshot for long-term retention.
- Retain the last N snapshots (configurable, default 50).

### 2.3 Autosave delta journal

- On autosave, compute `delta(last_history_state, current)`.
- If non-empty, append the delta to disk and update `last_history_state`.
- Delta files are named by timestamp.

### 2.4 Rust history commands

```rust
pub fn save_snapshot(state: State<AppState>) -> Result<String, String>
pub fn list_snapshots(base_path: String) -> Result<Vec<HistoryEntry>, String>
pub fn load_version(timestamp: String, base_path: String) -> Result<Document, String>
```

`load_version` reconstructs a version by:
1. finding the most recent snapshot before the target time;
2. applying deltas forward until reaching the target time.

### 2.5 Frontend history panel

- List snapshots and delta checkpoints.
- Allow selecting a version to load or diff.
- Show version timestamps and optional labels.

---

## Phase 3: Diff View

**Read-only side-by-side comparison of any two versions.**

### 3.1 Rust diff command

```rust
pub fn diff_documents(left: String, right: String) -> Result<Vec<DocOp>, String>
```

Loads both versions, computes `compute_delta(left, right)`.

### 3.2 Word-level diff inside modified paragraphs

For each `UpdateParagraph` operation, use the `similar` crate (already in dependencies) to compute a word-level diff between `old` and `new`.

Return richer diff blocks:

```rust
pub enum DiffBlock {
    Unchanged { paragraph: Paragraph },
    Added { paragraph: Paragraph },
    Deleted { paragraph: Paragraph },
    Modified {
        old: Paragraph,
        new: Paragraph,
        word_diff: Vec<WordDiff>,
    },
}
```

### 3.3 Side-by-side static renderer

- Left pane: old version.
- Right pane: new version.
- Use existing `paragraphToHTML` with `{ manuscript: true }` or a dedicated diff renderer.
- Highlight added paragraphs/words in green; deleted in red.
- Synchronized scrolling optional (future enhancement).

### 3.4 Diff interactions (Phase 1)

- Revert current document to left version.
- Revert current document to right version.
- Select and copy text from either side.

### 3.5 Per-change revert (Phase 2, future)

- Because `DocOp` is invertible, we can later add:

```rust
pub fn revert_operation(timestamp: String, op_index: usize) -> Result<Document, String>
```

This is not required for the initial diff view.

---

## Phase 4: Segmented Editor

**Replace the single full-document `contenteditable` with bounded segments.**

### 4.1 Remove editor pagination

- Remove `layoutPageBreaks()` and related editor page markers.
- Remove `data-page-start` attributes and CSS page break pseudo-elements from editor mode.
- Keep pagination strictly for manuscript mode.
- Simplify first-line indent computation to depend only on the previous paragraph.

### 4.2 Segment by paragraph count

A segment is a fixed number of paragraphs (default 10–15, configurable). Segments are computed by index, not by page breaks.

```rust
pub struct Segment {
    pub index: usize,
    pub start_para: usize, // inclusive
    pub end_para: usize,   // exclusive
}
```

### 4.3 Three segment rendering states

| State | Rendering |
|---|---|
| Active | `contenteditable="true"`, one at a time |
| Visible nearby | Static HTML, read-only |
| Far away | Placeholder or not rendered |

### 4.4 Active segment switching

- User clicks a segment to make it active, or uses a keyboard command.
- On switch:
  1. Sync current active segment to Rust.
  2. Render the new segment as `contenteditable`.
  3. Render the old segment as static HTML.
  4. Restore cursor/scroll position.
- Show a brief loading/focus indicator during switch; acceptable because switching large segments is infrequent.

### 4.5 Editor input handling

- Intercept input events within the active segment.
- Update the local paragraph model immediately.
- Send deltas/updates to Rust, either batched or debounced.
- For formatting and structural edits, send explicit Rust commands and apply the returned document state.

### 4.6 Remove full-document `innerHTML` replacement

- The segmented editor should patch only the active segment’s DOM.
- Static segments are rendered once and only updated when the underlying model changes significantly.

### 4.7 Selection constraints

- Selection is limited to the active segment.
- This is acceptable because cross-segment selection for large moves is not a required workflow.

---

## Phase 5: Status Bar Page Indicator

**Lightweight manuscript page awareness in editor mode.**

### 5.1 Compute manuscript pagination on demand

- Pagination runs when switching to manuscript mode or after an idle period in editor mode.
- Store `pageBreaks` in the frontend state for use by both modes.

### 5.2 Map cursor/selection to page number

In editor mode, track the active paragraph index. Use `getPageForParagraph(paraIndex)` from `usePagination`.

Display in the status bar:

- Single cursor: `Page 12 of 47`
- Selection spanning pages: `Pages 12–14 of 47`
- No cursor: show page of first visible paragraph or hide.

### 5.3 Stale pagination handling

- Recompute pagination in the background after a debounced idle period.
- Page numbers may lag slightly during heavy typing; acceptable.

---

## Implementation Order

1. **Phase 1: Rust document engine & delta protocol**
2. **Phase 2: Version history**
3. **Phase 3: Diff view**
4. **Phase 4: Segmented editor**
5. **Phase 5: Status bar page indicator**

This order ensures each phase builds on a stable foundation. Phases 2 and 3 can overlap somewhat once the delta protocol is in place. Phase 4 is the biggest frontend refactor and should happen after the Rust command surface is finalized.

---

## Open Questions

1. Should the delta response protocol return full documents or delta operations initially?
2. What is the default segment size? (Start with 12 paragraphs, make it configurable.)
3. Should history be embedded in the `.fwd` file or kept in a sidecar directory? (Recommend sidecar directory.)
4. How aggressively should old snapshots/deltas be pruned? (Defer pruning until Phase 2 follow-up.)
