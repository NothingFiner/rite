use crate::document::{apply_doc_ops, compute_doc_ops, DocOp, Document};
use crate::history::{self, HistoryRecord, RiteFile};
use std::sync::Mutex;

pub struct AppState {
    pub document: Mutex<Document>,
    /// In-memory undo/redo: each entry is the set of DocOps that transformed the
    /// document from state N to state N+1. Storing deltas (not full snapshots)
    /// keeps memory low for novel-length documents. Capped at `max_history`;
    /// lost when the app closes. This is DISTINCT from `version_history` below,
    /// which is the persistent, on-disk (now embedded) browse/restore history.
    pub history: Mutex<Vec<Vec<DocOp>>>,
    pub history_index: Mutex<usize>,
    pub max_history: usize,
    pub is_modified: Mutex<bool>,
    pub last_path: Mutex<Option<String>>,
    /// The document state the embedded history was last advanced from. Explicit
    /// save sets this to the saved document (after appending a snapshot);
    /// autosave computes the delta from this to the current document, then
    /// advances it. Opening a file sets it to the loaded document so the first
    /// autosave delta has a baseline.
    pub last_history_state: Mutex<Document>,
    /// The persistent version history (snapshots + deltas), embedded in the
    /// `.rite` file. Loaded on open, appended to on save/autosave, and written
    /// back to the `.rite` as part of the single `RiteFile`. Bounded by
    /// `max_snapshots` (contiguous eviction of the oldest snapshots + the
    /// deltas before the oldest survivor) and `max_deltas_per_snapshot` (a long
    /// run of deltas folds into a fresh snapshot).
    pub version_history: Mutex<Vec<HistoryRecord>>,
    pub max_snapshots: usize,
    pub max_deltas_per_snapshot: usize,
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
            version_history: Mutex::new(Vec::new()),
            max_snapshots: 4,
            max_deltas_per_snapshot: 50,
        }
    }

    /// Record the delta between `old` and the current document state as a new
    /// in-memory undo entry. If the user had undone and then mutates, discard
    /// the redo branch first.
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

    /// Reset in-memory undo/redo to an empty baseline, used when opening a file.
    pub fn reset_history(&self) {
        let mut history = self.history.lock().unwrap();
        let mut index = self.history_index.lock().unwrap();
        history.clear();
        *index = 0;
    }

    /// Set the embedded-history baseline to `doc`. Used on open so the first
    /// autosave delta is computed against the loaded document rather than the
    /// default empty document.
    pub fn set_history_baseline(&self, doc: &Document) {
        *self.last_history_state.lock().unwrap() = doc.clone();
    }

    /// Replace the embedded version history (used on open, after reading the
    /// `.rite` and migrating any legacy sidecar). Compacts immediately so a
    /// freshly migrated history (which the old sidecar never capped) is bounded
    /// right away.
    pub fn set_version_history(&self, records: Vec<HistoryRecord>) {
        let mut records = records;
        history::compact_history(&mut records, self.max_snapshots);
        *self.version_history.lock().unwrap() = records;
    }

    /// Append a full snapshot of `doc` to the embedded history and compact.
    /// Returns the snapshot's timestamp. Used by explicit save and the manual
    /// checkpoint. No disk write — the caller serializes the whole `RiteFile`
    /// after mutating, so no lock is held across I/O.
    pub fn append_history_snapshot(&self, doc: &Document) -> Result<String, String> {
        let timestamp = history::current_timestamp();
        let mut version_history = self.version_history.lock().map_err(|e| e.to_string())?;
        version_history.push(HistoryRecord::Snapshot {
            timestamp: timestamp.clone(),
            document: doc.clone(),
        });
        history::compact_history(&mut version_history, self.max_snapshots);
        Ok(timestamp)
    }

    /// Journal the delta from the last history baseline to the current document
    /// into the embedded history. If the two are identical, nothing is journaled
    /// (`Ok(false)`). Otherwise either a `Delta` is appended, or — once
    /// `max_deltas_per_snapshot` deltas have accumulated since the last snapshot
    /// — a full `Snapshot` of the current document is appended instead (the
    /// pending change is folded into it, bounding replay depth and file size
    /// across a long unsaved session). The baseline advances to the current
    /// document either way. No disk write.
    pub fn append_history_delta(&self) -> Result<bool, String> {
        let current = self.document.lock().map_err(|e| e.to_string())?.clone();
        let old = self
            .last_history_state
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        let ops = history::doc_ops_between(&old, &current);
        if ops.is_empty() {
            return Ok(false);
        }

        let timestamp = history::current_timestamp();
        {
            let mut version_history = self.version_history.lock().map_err(|e| e.to_string())?;
            let deltas_since = history::deltas_since_last_snapshot(&version_history);
            if deltas_since >= self.max_deltas_per_snapshot {
                // Fold the pending change into a fresh snapshot to bound replay
                // depth instead of appending another delta.
                version_history.push(HistoryRecord::Snapshot {
                    timestamp,
                    document: current.clone(),
                });
            } else {
                version_history.push(HistoryRecord::Delta { timestamp, ops });
            }
            history::compact_history(&mut version_history, self.max_snapshots);
        }

        *self.last_history_state.lock().map_err(|e| e.to_string())? = current;
        Ok(true)
    }

    /// Snapshot the live document + embedded history into a `RiteFile` for the
    /// caller to write to disk. Locks are held only long enough to clone.
    ///
    /// `schema_version` is set to 0 here deliberately: `write_rite_file` is the
    /// single authority that stamps the current version on the way to disk, so
    /// the in-memory value is irrelevant by the time the bytes land. Setting 0
    /// (rather than the current version) keeps `build_rite_file` honest about
    /// what it actually knows — it has not committed the file to any format
    /// generation — and means a caller that inspects the `RiteFile` before
    /// writing sees a neutral, pre-stamp value instead of one that could lie
    /// about what is on disk.
    pub fn build_rite_file(&self) -> Result<RiteFile, String> {
        let document = self.document.lock().map_err(|e| e.to_string())?.clone();
        let history = self
            .version_history
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        Ok(RiteFile {
            document,
            history,
            schema_version: 0,
        })
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
    use crate::document::{Element, Paragraph, Section, SectionType, TextRun, TextStyle};
    use crate::history::{self, HistoryRecord};

    /// A one-section, one-paragraph document whose single run contains `text`.
    /// Used as the thing we mutate between history pushes — each distinct
    /// `text` is a distinct document state, so `compute_doc_ops` emits a real
    /// change.
    fn doc_text(text: &str) -> Document {
        Document {
            title: "T".to_string(),
            author: "A".to_string(),
            author_contact: "C".to_string(),
            has_toc: false,
            has_epigram: false,
            epigram_text: String::new(),
            sections: vec![Section {
                id: "s1".to_string(),
                section_type: SectionType::Section,
                title: String::new(),
                paragraphs: vec![Paragraph {
                    id: "p1".to_string(),
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
            }],
        }
    }

    fn current_text(state: &AppState) -> String {
        let doc = state.document.lock().unwrap().clone();
        doc.sections[0].paragraphs[0]
            .elements
            .iter()
            .map(|e| e.text_run.content.as_str())
            .collect()
    }

    fn current_text_from(doc: &Document) -> String {
        doc.sections[0].paragraphs[0]
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

    // --- embedded version history wiring ---------------------------------------
    //
    // These exercise the AppState methods that thread the embedded history
    // (crate::history) through the live document and the last_history_state
    // baseline: appending snapshots/deltas, auto-snapshotting, compaction, and
    // round-tripping the whole RiteFile to disk.

    #[test]
    fn set_history_baseline_sets_state() {
        let state = AppState::new();
        state.set_history_baseline(&doc_text("hello"));
        let baseline = state.last_history_state.lock().unwrap().clone();
        assert_eq!(current_text_from(&baseline), "hello");
    }

    #[test]
    fn append_history_snapshot_adds_a_snapshot() {
        let state = AppState::new();
        *state.document.lock().unwrap() = doc_text("a");
        state.set_history_baseline(&doc_text("a"));

        state.append_history_snapshot(&doc_text("a")).unwrap();

        let vh = state.version_history.lock().unwrap();
        assert_eq!(vh.len(), 1);
        assert!(matches!(vh[0], HistoryRecord::Snapshot { .. }));
    }

    #[test]
    fn append_history_delta_journals_delta_and_advances_baseline() {
        let state = AppState::new();
        *state.document.lock().unwrap() = doc_text("a");
        state.set_history_baseline(&doc_text("a"));
        state.append_history_snapshot(&doc_text("a")).unwrap(); // baseline snapshot

        // Edit, then journal a delta from the "a" baseline.
        *state.document.lock().unwrap() = doc_text("ab");
        let journaled = state.append_history_delta().unwrap();
        assert!(journaled);

        let vh = state.version_history.lock().unwrap();
        assert_eq!(vh.len(), 2); // snapshot + delta
        assert!(matches!(vh[1], HistoryRecord::Delta { .. }));

        // Reconstructing at the delta reconstructs "ab".
        let delta_ts = vh
            .iter()
            .find(|r| matches!(r, HistoryRecord::Delta { .. }))
            .unwrap()
            .timestamp()
            .to_string();
        let reconstructed = history::reconstruct_version(&delta_ts, &vh).unwrap();
        assert_eq!(current_text_from(&reconstructed), "ab");

        // The baseline advanced to the edited document.
        let baseline = state.last_history_state.lock().unwrap().clone();
        assert_eq!(current_text_from(&baseline), "ab");
    }

    #[test]
    fn append_history_delta_auto_snapshots_after_threshold() {
        let mut state = AppState::new();
        state.max_deltas_per_snapshot = 3;
        *state.document.lock().unwrap() = doc_text("a");
        state.set_history_baseline(&doc_text("a"));
        state.append_history_snapshot(&doc_text("a")).unwrap();

        // Journal exactly the threshold number of deltas.
        for i in 1..=3 {
            *state.document.lock().unwrap() = doc_text(&format!("a{}", i));
            state.append_history_delta().unwrap();
        }
        // The next journal should fold into a snapshot, not another delta.
        *state.document.lock().unwrap() = doc_text("a4");
        state.append_history_delta().unwrap();

        let vh = state.version_history.lock().unwrap();
        let snapshots = vh
            .iter()
            .filter(|r| matches!(r, HistoryRecord::Snapshot { .. }))
            .count();
        // The baseline snapshot + one auto-snapshot.
        assert_eq!(snapshots, 2);
        // Reconstructing the latest state yields "a4".
        let latest_ts = vh.last().unwrap().timestamp().to_string();
        let reconstructed = history::reconstruct_version(&latest_ts, &vh).unwrap();
        assert_eq!(current_text_from(&reconstructed), "a4");
    }

    #[test]
    fn append_history_delta_noop_when_unchanged() {
        let state = AppState::new();
        *state.document.lock().unwrap() = doc_text("a");
        state.set_history_baseline(&doc_text("a"));
        state.append_history_snapshot(&doc_text("a")).unwrap(); // baseline == "a"

        // Document still equals the baseline → no delta to journal.
        let journaled = state.append_history_delta().unwrap();
        assert!(!journaled);

        let vh = state.version_history.lock().unwrap();
        assert_eq!(vh.len(), 1); // only the baseline snapshot
        assert!(matches!(vh[0], HistoryRecord::Snapshot { .. }));
    }

    #[test]
    fn build_rite_file_roundtrips_to_disk() {
        let state = AppState::new();
        *state.document.lock().unwrap() = doc_text("a");
        state.set_history_baseline(&doc_text("a"));
        state.append_history_snapshot(&doc_text("a")).unwrap();
        *state.document.lock().unwrap() = doc_text("ab");
        state.append_history_delta().unwrap();

        let file = state.build_rite_file().unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "rite-state-test-{}-roundtrip",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let base = tmp.join("MyNovel.rite");
        // write_rite_file takes ownership and stamps the current schema version
        // on the way to disk, so clone for the assertion and expect the stamped
        // version on read-back rather than build_rite_file's neutral 0.
        history::write_rite_file(&base, file.clone()).unwrap();

        let json = std::fs::read_to_string(&base).unwrap();
        let back = history::read_rite_file(&json).unwrap();
        assert_eq!(back.schema_version, history::CURRENT_RITE_SCHEMA_VERSION);
        assert_eq!(back.document, file.document);
        assert_eq!(back.history, file.history);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn set_version_history_compacts_on_load() {
        let mut state = AppState::new();
        state.max_snapshots = 2;
        // A migrated history with five snapshots — more than the cap.
        let mut records = Vec::new();
        for i in 0..5 {
            records.push(HistoryRecord::Snapshot {
                timestamp: format!("2026-07-19T10-{:02}-00-000", i),
                document: doc_text(&format!("v{}", i)),
            });
        }
        state.set_version_history(records);

        let vh = state.version_history.lock().unwrap();
        // Only the two newest snapshots survive.
        assert_eq!(vh.len(), 2);
        assert_eq!(vh[0].timestamp(), "2026-07-19T10-03-00-000");
        assert_eq!(vh[1].timestamp(), "2026-07-19T10-04-00-000");
    }
}