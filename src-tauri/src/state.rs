use crate::document::{apply_doc_ops, compute_doc_ops, DocOp, Document};
use crate::history;
use std::path::Path;
use std::sync::Mutex;

pub struct AppState {
    pub document: Mutex<Document>,
    /// History of change batches. Each entry is the set of DocOps that transformed
    /// the document from state N to state N+1. Storing deltas instead of full
    /// snapshots keeps memory usage low for novel-length documents.
    pub history: Mutex<Vec<Vec<DocOp>>>,
    pub history_index: Mutex<usize>,
    pub max_history: usize,
    pub is_modified: Mutex<bool>,
    pub last_path: Mutex<Option<String>>,
    /// The document state the on-disk history was last advanced from. Explicit save
    /// sets this to the saved document (after writing a snapshot); autosave computes
    /// the delta from this to the current document, then advances it. Opening a file
    /// sets it to the loaded document so the first autosave delta has a baseline.
    pub last_history_state: Mutex<Document>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            document: Mutex::new(Document::default()),
            history: Mutex::new(Vec::new()),
            history_index: Mutex::new(0),
            max_history: 30,
            is_modified: Mutex::default(),
            last_path: Mutex::default(),
            last_history_state: Mutex::new(Document::default()),
        }
    }

    /// Record the delta between `old` and the current document state as a new
    /// history entry. If the user had undone and then mutates, discard the
    /// redo branch first.
    pub fn push_history_delta(&self, old: &Document) {
        let current = self.document.lock().unwrap().clone();
        let ops = compute_doc_ops(old, &current);
        if ops.is_empty() {
            return;
        }

        let mut history = self.history.lock().unwrap();
        let mut index = self.history_index.lock().unwrap();

        if *index < history.len() {
            history.truncate(*index);
        }

        history.push(ops);
        *index += 1;

        while history.len() > self.max_history {
            history.remove(0);
            *index = index.saturating_sub(1);
        }
    }

    /// Reset history to an empty baseline, used when opening a file.
    pub fn reset_history(&self) {
        let mut history = self.history.lock().unwrap();
        let mut index = self.history_index.lock().unwrap();
        history.clear();
        *index = 0;
    }

    /// Set the on-disk history baseline to `doc`. Used on open so the first
    /// autosave delta is computed against the loaded document rather than the
    /// default empty document.
    pub fn set_history_baseline(&self, doc: &Document) {
        *self.last_history_state.lock().unwrap() = doc.clone();
    }

    /// Write a full snapshot of the current document to the history sidecar at
    /// `base_path` and advance `last_history_state` to it. Used by explicit save
    /// and the manual-checkpoint command. Returns the snapshot's timestamp stem.
    /// No lock is held across the disk write.
    pub fn write_history_snapshot(&self, base_path: &Path) -> Result<String, String> {
        let doc = self.document.lock().map_err(|e| e.to_string())?.clone();
        let stem = history::save_snapshot(&doc, base_path)?;
        *self.last_history_state.lock().map_err(|e| e.to_string())? = doc;
        Ok(stem)
    }

    /// Compute and persist the delta from `last_history_state` to the current
    /// document, then advance `last_history_state` to the current document.
    /// Returns true if a delta file was written, false if nothing changed. Used
    /// by autosave. No lock is held across the disk write.
    pub fn write_history_delta(&self, base_path: &Path) -> Result<bool, String> {
        let current = self.document.lock().map_err(|e| e.to_string())?.clone();
        let old = self
            .last_history_state
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        let wrote = history::write_delta_since(&old, &current, base_path)?;
        *self.last_history_state.lock().map_err(|e| e.to_string())? = current;
        Ok(wrote)
    }

    /// Undo the most recent change batch by inverting and applying its
    /// operations in reverse order. Returns true if an undo occurred.
    pub fn undo(&self) -> Result<bool, String> {
        let (ops, new_index) = {
            let index = self.history_index.lock().unwrap();
            let history = self.history.lock().unwrap();
            if *index == 0 || history.is_empty() {
                return Ok(false);
            }
            let ops = history[*index - 1].clone();
            (ops, *index - 1)
        };

        let mut inverted: Vec<DocOp> = ops.iter().map(|op| op.invert()).collect();
        inverted.reverse();

        let mut doc = self.document.lock().map_err(|e| e.to_string())?;
        apply_doc_ops(&mut *doc, &inverted)?;

        let mut index = self.history_index.lock().unwrap();
        *index = new_index;
        Ok(true)
    }

    /// Redo the next change batch by applying it forward. Returns true if a redo
    /// occurred.
    pub fn redo(&self) -> Result<bool, String> {
        let ops = {
            let index = self.history_index.lock().unwrap();
            let history = self.history.lock().unwrap();
            if *index >= history.len() {
                return Ok(false);
            }
            history[*index].clone()
        };

        let mut doc = self.document.lock().map_err(|e| e.to_string())?;
        apply_doc_ops(&mut *doc, &ops)?;

        let mut index = self.history_index.lock().unwrap();
        *index += 1;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Body, Element, Paragraph, ParagraphStyle, TextRun, TextStyle};
    use crate::history::{self, HistoryKind};
    use std::fs;
    use std::path::PathBuf;

    /// A one-paragraph document whose single run contains `text`. Used as the
    /// thing we mutate between history pushes — each distinct `text` is a
    /// distinct document state, so `compute_doc_ops` emits a real change.
    fn doc_text(text: &str) -> Document {
        Document {
            title: "T".to_string(),
            author: "A".to_string(),
            author_contact: "C".to_string(),
            has_toc: false,
            has_epigram: false,
            epigram_text: String::new(),
            body: Body {
                content: vec![Paragraph {
                    id: "p1".to_string(),
                    paragraph_style: ParagraphStyle::Normal,
                    elements: vec![Element {
                        text_run: TextRun {
                            content: text.to_string(),
                            text_style: TextStyle::default(),
                        },
                    }],
                    left_indent: None,
                    right_indent: None,
                    first_line_indent: None,
                }],
            },
        }
    }

    fn current_text(state: &AppState) -> String {
        let doc = state.document.lock().unwrap().clone();
        doc.body.content[0]
            .elements
            .iter()
            .map(|e| e.text_run.content.as_str())
            .collect()
    }

    /// Move the live document to `text` and record the transition in history.
    /// Mirrors what the command wrappers do: snapshot the old state, mutate,
    /// then `push_history_delta(&old)`.
    fn change_to(state: &AppState, text: &str) {
        let old = state.document.lock().unwrap().clone();
        *state.document.lock().unwrap() = doc_text(text);
        state.push_history_delta(&old);
    }

    #[test]
    fn push_history_records_a_change() {
        let state = AppState::new();
        change_to(&state, "v1");
        let history = state.history.lock().unwrap();
        let index = state.history_index.lock().unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(*index, 1);
    }

    #[test]
    fn push_history_noop_when_unchanged() {
        let state = AppState::new();
        // Snapshot the current doc, then "change" to an identical doc: the
        // computed delta is empty, so nothing is recorded.
        let old = state.document.lock().unwrap().clone();
        state.push_history_delta(&old);
        assert!(state.history.lock().unwrap().is_empty());
        assert_eq!(*state.history_index.lock().unwrap(), 0);
    }

    #[test]
    fn undo_reverts_last_change() {
        let state = AppState::new();
        change_to(&state, "v1");
        assert_eq!(current_text(&state), "v1");

        assert!(state.undo().unwrap());
        assert_eq!(current_text(&state), ""); // back to the default empty doc
    }

    #[test]
    fn undo_when_history_empty_is_noop() {
        let state = AppState::new();
        // Nothing has been recorded, so undo must report no change and leave
        // the document untouched.
        let before = current_text(&state);
        let did = state.undo().unwrap();
        assert!(!did);
        assert_eq!(current_text(&state), before);
    }

    #[test]
    fn redo_reapplies_undone_change() {
        let state = AppState::new();
        change_to(&state, "v1");
        state.undo().unwrap();
        assert_eq!(current_text(&state), "");

        assert!(state.redo().unwrap());
        assert_eq!(current_text(&state), "v1");
    }

    #[test]
    fn redo_at_top_of_history_is_noop() {
        let state = AppState::new();
        change_to(&state, "v1");
        // We are already at the newest state; there is nothing to redo.
        let did = state.redo().unwrap();
        assert!(!did);
        assert_eq!(current_text(&state), "v1");
    }

    #[test]
    fn new_edit_after_undo_truncates_redo_branch() {
        let state = AppState::new();
        change_to(&state, "v1");
        change_to(&state, "v2");
        state.undo().unwrap(); // back to v1
        assert_eq!(current_text(&state), "v1");

        // Branching off a new edit must discard the redo path to v2.
        change_to(&state, "v3");
        assert_eq!(state.history.lock().unwrap().len(), 2); // v0->v1, v1->v3
        assert_eq!(*state.history_index.lock().unwrap(), 2);

        // v2 is gone: redo can no longer reach it.
        assert!(!state.redo().unwrap());
        assert_eq!(current_text(&state), "v3");

        // Undo walks the new branch, not the old one.
        state.undo().unwrap();
        assert_eq!(current_text(&state), "v1");
    }

    #[test]
    fn max_history_cap_evicts_oldest_entries() {
        let mut state = AppState::new();
        state.max_history = 3;
        change_to(&state, "v1");
        change_to(&state, "v2");
        change_to(&state, "v3");
        change_to(&state, "v4");
        change_to(&state, "v5");

        // Only the 3 most recent transitions are retained; the index points at
        // the newest.
        assert_eq!(state.history.lock().unwrap().len(), 3);
        assert_eq!(*state.history_index.lock().unwrap(), 3);

        // We can undo back to v2 (the oldest surviving state), but no further —
        // v0 and v1's transition were evicted.
        assert!(state.undo().unwrap());
        assert_eq!(current_text(&state), "v4");
        assert!(state.undo().unwrap());
        assert_eq!(current_text(&state), "v3");
        assert!(state.undo().unwrap());
        assert_eq!(current_text(&state), "v2");
        assert!(!state.undo().unwrap()); // nothing older to undo to
    }

    #[test]
    fn reset_history_clears_everything() {
        let state = AppState::new();
        change_to(&state, "v1");
        change_to(&state, "v2");
        assert_eq!(state.history.lock().unwrap().len(), 2);

        state.reset_history();
        assert!(state.history.lock().unwrap().is_empty());
        assert_eq!(*state.history_index.lock().unwrap(), 0);
        // After reset, undo has nothing to do.
        assert!(!state.undo().unwrap());
    }

    // --- on-disk history wiring (write_history_snapshot / write_history_delta) ---
    //
    // These exercise the AppState methods that thread the on-disk history engine
    // (crate::history) through the live document and the last_history_state baseline.

    /// A self-cleaning temp directory. `new` creates a fresh, unique dir; `Drop`
    /// removes it, even if the test panics. Mirrors history.rs's TempDir without
    /// sharing test-only code across modules.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "rite-state-test-{}-{}",
                std::process::id(),
                name
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        /// A pretend document path inside the temp dir.
        fn base(&self) -> PathBuf {
            self.0.join("MyNovel.fwd")
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn history_entries(tmp: &TempDir) -> Vec<crate::history::HistoryEntry> {
        history::list_history(&tmp.base()).unwrap()
    }

    #[test]
    fn set_history_baseline_sets_state() {
        let state = AppState::new();
        state.set_history_baseline(&doc_text("hello"));
        let baseline = state.last_history_state.lock().unwrap().clone();
        assert_eq!(current_text_from(&baseline), "hello");
    }

    #[test]
    fn write_history_snapshot_writes_snapshot_and_advances_baseline() {
        let tmp = TempDir::new("snapshot_baseline");
        let state = AppState::new();
        *state.document.lock().unwrap() = doc_text("a");

        let stem = state.write_history_snapshot(&tmp.base()).unwrap();

        let entries = history_entries(&tmp);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, HistoryKind::Snapshot);
        assert_eq!(entries[0].timestamp, stem);

        // The baseline advanced to the saved document.
        let baseline = state.last_history_state.lock().unwrap().clone();
        assert_eq!(current_text_from(&baseline), "a");
    }

    #[test]
    fn write_history_delta_journals_delta_and_advances_baseline() {
        let tmp = TempDir::new("delta_journal");
        let state = AppState::new();
        *state.document.lock().unwrap() = doc_text("a");
        // Establish a base snapshot (and set the baseline to "a").
        state.write_history_snapshot(&tmp.base()).unwrap();

        // Edit, then journal a delta from the "a" baseline.
        *state.document.lock().unwrap() = doc_text("ab");
        let wrote = state.write_history_delta(&tmp.base()).unwrap();
        assert!(wrote);

        let entries = history_entries(&tmp);
        assert_eq!(entries.len(), 2); // one snapshot + one delta
        let delta_ts = entries
            .iter()
            .find(|e| e.kind == HistoryKind::Delta)
            .unwrap()
            .timestamp
            .clone();

        // Reconstructing at the delta's timestamp yields the edited document,
        // proving the delta was written against the snapshot baseline.
        let reconstructed = history::reconstruct_version(&delta_ts, &tmp.base()).unwrap();
        assert_eq!(current_text_from(&reconstructed), "ab");

        // The baseline advanced to the edited document.
        let baseline = state.last_history_state.lock().unwrap().clone();
        assert_eq!(current_text_from(&baseline), "ab");
    }

    #[test]
    fn write_history_delta_noop_when_unchanged() {
        let tmp = TempDir::new("delta_noop");
        let state = AppState::new();
        *state.document.lock().unwrap() = doc_text("a");
        state.write_history_snapshot(&tmp.base()).unwrap(); // baseline == "a"

        // Document still equals the baseline → no delta to write.
        let wrote = state.write_history_delta(&tmp.base()).unwrap();
        assert!(!wrote);

        // Only the snapshot from above is on disk.
        let entries = history_entries(&tmp);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, HistoryKind::Snapshot);
    }

    /// Read the text of the first paragraph's first run from any document. Used
    /// to compare reconstructed/baseline documents against `doc_text` inputs.
    fn current_text_from(doc: &Document) -> String {
        doc.body.content[0]
            .elements
            .iter()
            .map(|e| e.text_run.content.as_str())
            .collect()
    }
}
