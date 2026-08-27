//! On-disk version history: full snapshots plus a sequence of deltas.
//!
//! For a document at `<base>` (e.g. `/novels/MyNovel.rite`), history lives in a
//! sidecar directory laid out as:
//!
//! ```text
//! /novels/MyNovel.rite.history/
//!   snapshots/
//!     2026-07-19T10-00-00-123.rite     <- full Document JSON
//!   deltas/
//!     2026-07-19T10-05-00-456.delta    <- Vec<DocOp> (forward ops)
//!     2026-07-19T10-11-00-789.delta
//! ```
//!
//! Timestamps are UTC, fixed-width `YYYY-MM-DDTHH-MM-SS-mmm`, so a plain
//! lexicographic string sort is also chronological. A historical version is
//! reconstructed by taking the newest snapshot at or before the target time
//! and applying the intervening deltas forward in order. Every `DocOp` carries
//! its old state, so `apply_doc_ops` validates each step and will refuse to
//! apply a delta whose precondition no longer matches — a corruption guard.
//!
//! This module is pure functions over `&Document` / `&Path`. The Tauri command
//! wrappers (which thread in `AppState`) live in `commands.rs`.

use crate::document::{apply_doc_ops, compute_doc_ops, DocOp, Document};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const HISTORY_SUFFIX: &str = ".history";
const SNAPSHOTS_DIR: &str = "snapshots";
const DELTAS_DIR: &str = "deltas";
const SNAPSHOT_EXT: &str = "rite";
const DELTA_EXT: &str = "delta";

/// A single row in the version-history listing, returned to the frontend.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum HistoryKind {
    Snapshot,
    Delta,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub timestamp: String,
    pub kind: HistoryKind,
    pub label: Option<String>,
}

/// A sortable, filesystem-safe UTC timestamp with millisecond precision.
/// Format: `2026-07-19T10-00-00-123`. Fixed width means `String::cmp` orders
/// timestamps chronologically, which the reconstruction algorithm relies on.
pub fn current_timestamp() -> String {
    Utc::now().format("%Y-%m-%dT%H-%M-%S-%3f").to_string()
}

/// `<base>.history` — the sidecar history directory for a document at `base`.
pub fn history_dir(base_path: &Path) -> PathBuf {
    let mut s = base_path.as_os_str().to_owned();
    s.push(HISTORY_SUFFIX);
    PathBuf::from(s)
}

fn snapshots_dir(history: &Path) -> PathBuf {
    history.join(SNAPSHOTS_DIR)
}

fn deltas_dir(history: &Path) -> PathBuf {
    history.join(DELTAS_DIR)
}

/// Write `content` to `path` via a sibling `.tmp` file then atomic rename, so a
/// crash mid-write cannot leave a half-written history file.
fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let tmp = format!("{}.tmp", path.to_string_lossy());
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Is any history entry (snapshot or delta) already using `stem` as its
/// timestamp? History is one ordered sequence, so a stem must be free in *both*
/// subdirectories — otherwise a snapshot and a delta sharing a timestamp would
/// make `reconstruct_version` ambiguous about which state that time refers to.
fn is_stem_in_use(history: &Path, stem: &str) -> bool {
    snapshots_dir(history)
        .join(format!("{}.{}", stem, SNAPSHOT_EXT))
        .exists()
        || deltas_dir(history)
            .join(format!("{}.{}", stem, DELTA_EXT))
            .exists()
}

/// Pick a globally-unique stem for a new entry in `dir`. Starts at `ts`; if
/// that stem is already taken (another write landed in the same millisecond),
/// tries `ts-1`, `ts-2`, … until a free one is found. The counter sorts right
/// after the original timestamp (`...-456` < `...-456-1` < `...-456-2` <
/// `...-457`), so chronological order survives disambiguation. Writes are
/// sequential in-process, so counter order matches the order the transitions
/// actually happened — reconstruction stays correct.
fn reserve_entry(history: &Path, dir: &Path, ts: &str, ext: &str) -> (String, PathBuf) {
    let candidates =
        std::iter::once(ts.to_string()).chain((1u32..).map(|n| format!("{}-{}", ts, n)));
    for stem in candidates {
        if !is_stem_in_use(history, &stem) {
            return (stem.clone(), dir.join(format!("{}.{}", stem, ext)));
        }
    }
    unreachable!("the candidate sequence is infinite")
}

/// Write a full snapshot of `doc` and return its timestamp stem. Creates the
/// sidecar directory tree if needed. This is the "explicit save / checkpoint"
/// path from the plan's snapshot policy.
pub fn save_snapshot(doc: &Document, base_path: &Path) -> Result<String, String> {
    let history = history_dir(base_path);
    let snaps = snapshots_dir(&history);
    fs::create_dir_all(&snaps).map_err(|e| e.to_string())?;
    let ts = current_timestamp();
    let (stem, path) = reserve_entry(&history, &snaps, &ts, SNAPSHOT_EXT);
    let json = serde_json::to_string_pretty(doc).map_err(|e| e.to_string())?;
    atomic_write(&path, &json)?;
    Ok(stem)
}

/// Write a batch of forward `DocOp`s as one delta file. Returns `Some(stem)`
/// if a file was written, or `None` if `ops` was empty (nothing to write).
pub fn write_delta(ops: &[DocOp], base_path: &Path) -> Result<Option<String>, String> {
    if ops.is_empty() {
        return Ok(None);
    }
    let history = history_dir(base_path);
    let deltas = deltas_dir(&history);
    fs::create_dir_all(&deltas).map_err(|e| e.to_string())?;
    let ts = current_timestamp();
    let (stem, path) = reserve_entry(&history, &deltas, &ts, DELTA_EXT);
    let json = serde_json::to_string(ops).map_err(|e| e.to_string())?;
    atomic_write(&path, &json)?;
    Ok(Some(stem))
}

/// Compute and write the delta between `old` and `current`. Returns true if a
/// delta file was written, false if the two states were identical (no-op). This
/// is the autosave helper: callers keep a `last_history_state` and pass it as
/// `old`, then update it to `current` when this returns true.
pub fn write_delta_since(
    old: &Document,
    current: &Document,
    base_path: &Path,
) -> Result<bool, String> {
    let ops = compute_doc_ops(old, current);
    if ops.is_empty() {
        return Ok(false);
    }
    write_delta(&ops, base_path)?;
    Ok(true)
}

/// List every snapshot and delta, oldest first. Missing directory trees yield
/// an empty list (a never-saved document has no history).
pub fn list_history(base_path: &Path) -> Result<Vec<HistoryEntry>, String> {
    let hist = history_dir(base_path);
    let mut entries = Vec::new();

    for (dir, kind) in [
        (snapshots_dir(&hist), HistoryKind::Snapshot),
        (deltas_dir(&hist), HistoryKind::Delta),
    ] {
        if let Ok(rd) = fs::read_dir(&dir) {
            for entry in rd.flatten() {
                if let Some(stem) = entry.path().file_stem().and_then(|s| s.to_str()) {
                    entries.push(HistoryEntry {
                        timestamp: stem.to_string(),
                        kind: kind.clone(),
                        label: None,
                    });
                }
            }
        }
    }

    entries.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    Ok(entries)
}

/// The newest snapshot timestamp `<= target`, or an error if there is none
/// (the target predates the first snapshot, or history is empty).
fn newest_snapshot_at_or_before(history: &Path, target: &str) -> Result<String, String> {
    let mut best: Option<String> = None;
    for entry in fs::read_dir(snapshots_dir(history))
        .map_err(|e| e.to_string())?
        .flatten()
    {
        if let Some(stem) = entry.path().file_stem().and_then(|s| s.to_str()) {
            if stem <= target && best.as_deref().map_or(true, |b| stem > b) {
                best = Some(stem.to_string());
            }
        }
    }
    best.ok_or_else(|| format!("no snapshot at or before {}", target))
}

/// Delta files with `after < timestamp <= before_inclusive`, ascending.
fn delta_files_between(
    history: &Path,
    after: &str,
    before_inclusive: &str,
) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(deltas_dir(history)) {
        for entry in rd.flatten() {
            if let Some(stem) = entry.path().file_stem().and_then(|s| s.to_str()) {
                if stem > after && stem <= before_inclusive {
                    out.push((stem.to_string(), entry.path()));
                }
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

fn load_snapshot(history: &Path, ts: &str) -> Result<Document, String> {
    let path = snapshots_dir(history).join(format!("{}.{}", ts, SNAPSHOT_EXT));
    let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

/// Reconstruct the document as it was at `target_ts`: load the newest snapshot
/// at or before `target_ts`, then apply every delta after that snapshot and up
/// to (and including) `target_ts`, in chronological order. Errors if no
/// suitable snapshot exists or a delta's precondition no longer matches.
pub fn reconstruct_version(target_ts: &str, base_path: &Path) -> Result<Document, String> {
    let hist = history_dir(base_path);
    let snapshot_ts = newest_snapshot_at_or_before(&hist, target_ts)?;
    let mut doc = load_snapshot(&hist, &snapshot_ts)?;

    for (ts, path) in delta_files_between(&hist, &snapshot_ts, target_ts) {
        let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let ops: Vec<DocOp> = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        apply_doc_ops(&mut doc, &ops).map_err(|e| format!("applying delta {}: {}", ts, e))?;
    }

    Ok(doc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Element, Paragraph, Section, SectionType, TextRun, TextStyle};
    use std::path::PathBuf;

    /// A self-cleaning temp directory. `new` creates a fresh, unique dir; `Drop`
    /// removes it, even if the test panics. This mirrors the `tempfile` crate's
    /// `TempDir` without adding a dependency.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "rite-history-test-{}-{}",
                std::process::id(),
                name
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn base(&self) -> PathBuf {
            // A pretend document path inside the temp dir.
            self.0.join("MyNovel.rite")
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn create_paragraph(id: &str, text: &str) -> Paragraph {
        Paragraph {
            id: id.to_string(),
            elements: vec![Element {
                text_run: TextRun {
                    content: text.to_string(),
                    text_style: TextStyle::default(),
                },
            }],
            left_indent: None,
            right_indent: None,
            first_line_indent: None,
        }
    }

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
                title: String::new(),
                section_type: SectionType::Section,
                paragraphs: vec![create_paragraph("p1", text)],
            }],
        }
    }

    fn para_text(doc: &Document) -> String {
        doc.sections[0].paragraphs[0]
            .elements
            .iter()
            .map(|e| e.text_run.content.as_str())
            .collect()
    }

    #[test]
    fn save_then_load_snapshot_roundtrips() {
        let tmp = TempDir::new("save_roundtrip");
        let doc = doc_text("hello world");

        let ts = save_snapshot(&doc, &tmp.base()).unwrap();
        let loaded = reconstruct_version(&ts, &tmp.base()).unwrap();

        assert_eq!(loaded, doc);
    }

    #[test]
    fn delta_reconstructs_from_snapshot() {
        let tmp = TempDir::new("delta_reconstruct");
        let v0 = doc_text("a");
        let v1 = doc_text("ab");

        let snap_ts = save_snapshot(&v0, &tmp.base()).unwrap();
        let wrote = write_delta_since(&v0, &v1, &tmp.base()).unwrap();
        assert!(wrote);

        let entries = list_history(&tmp.base()).unwrap();
        // One snapshot + one delta.
        assert_eq!(entries.len(), 2);

        // The delta's timestamp reconstructs v1.
        let delta_ts = entries
            .iter()
            .find(|e| e.kind == HistoryKind::Delta)
            .unwrap()
            .timestamp
            .clone();
        let loaded = reconstruct_version(&delta_ts, &tmp.base()).unwrap();
        assert_eq!(para_text(&loaded), "ab");

        // The snapshot's timestamp still reconstructs v0.
        let loaded_snap = reconstruct_version(&snap_ts, &tmp.base()).unwrap();
        assert_eq!(para_text(&loaded_snap), "a");
    }

    #[test]
    fn multiple_deltas_apply_in_order() {
        let tmp = TempDir::new("multi_delta");
        let v0 = doc_text("a");
        let v1 = doc_text("ab");
        let v2 = doc_text("abc");
        let v3 = doc_text("abcd");

        save_snapshot(&v0, &tmp.base()).unwrap();
        write_delta_since(&v0, &v1, &tmp.base()).unwrap();
        write_delta_since(&v1, &v2, &tmp.base()).unwrap();
        write_delta_since(&v2, &v3, &tmp.base()).unwrap();

        let entries = list_history(&tmp.base()).unwrap();
        let deltas: Vec<&HistoryEntry> = entries
            .iter()
            .filter(|e| e.kind == HistoryKind::Delta)
            .collect();
        assert_eq!(deltas.len(), 3);

        // The last delta reconstructs v3; the first reconstructs v1.
        let last = reconstruct_version(&deltas[2].timestamp, &tmp.base()).unwrap();
        assert_eq!(para_text(&last), "abcd");
        let first = reconstruct_version(&deltas[0].timestamp, &tmp.base()).unwrap();
        assert_eq!(para_text(&first), "ab");
    }

    #[test]
    fn reconstruct_version_at_snapshot_applies_no_deltas() {
        let tmp = TempDir::new("at_snapshot");
        let v0 = doc_text("a");
        let v1 = doc_text("ab");

        let snap_ts = save_snapshot(&v0, &tmp.base()).unwrap();
        write_delta_since(&v0, &v1, &tmp.base()).unwrap();

        // Asking for the snapshot's own timestamp returns the snapshot verbatim.
        let loaded = reconstruct_version(&snap_ts, &tmp.base()).unwrap();
        assert_eq!(para_text(&loaded), "a");
    }

    #[test]
    fn list_history_sorted_with_kinds() {
        let tmp = TempDir::new("list_sorted");
        let v0 = doc_text("a");
        let v1 = doc_text("ab");
        let v2 = doc_text("abc");

        save_snapshot(&v0, &tmp.base()).unwrap();
        write_delta_since(&v0, &v1, &tmp.base()).unwrap();
        write_delta_since(&v1, &v2, &tmp.base()).unwrap();

        let entries = list_history(&tmp.base()).unwrap();
        assert_eq!(entries.len(), 3);
        // Sorted ascending by timestamp.
        assert!(entries.windows(2).all(|w| w[0].timestamp < w[1].timestamp));
        // Kinds: snapshot, delta, delta.
        assert_eq!(entries[0].kind, HistoryKind::Snapshot);
        assert_eq!(entries[1].kind, HistoryKind::Delta);
        assert_eq!(entries[2].kind, HistoryKind::Delta);
    }

    #[test]
    fn write_delta_since_noop_when_unchanged() {
        let tmp = TempDir::new("noop_delta");
        let v0 = doc_text("a");
        save_snapshot(&v0, &tmp.base()).unwrap();

        let wrote = write_delta_since(&v0, &v0, &tmp.base()).unwrap();
        assert!(!wrote);

        // Still just the one snapshot.
        let entries = list_history(&tmp.base()).unwrap();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn reconstruct_version_with_no_history_errors() {
        let tmp = TempDir::new("empty_history");
        // No snapshot ever written; reconstruction must fail cleanly.
        let res = reconstruct_version("2026-01-01T00-00-00-000", &tmp.base());
        assert!(res.is_err());
    }

    #[test]
    fn reconstruct_version_before_oldest_snapshot_errors() {
        let tmp = TempDir::new("before_oldest");
        save_snapshot(&doc_text("a"), &tmp.base()).unwrap();
        // A target earlier than the only snapshot: nothing to load from.
        let res = reconstruct_version("2000-01-01T00-00-00-000", &tmp.base());
        assert!(res.is_err());
    }

    #[test]
    fn timestamp_is_lexicographically_sortable() {
        // Sanity: two successive timestamps must order chronologically as
        // strings, which is what list_history and reconstruction rely on.
        let a = current_timestamp();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let b = current_timestamp();
        assert!(a < b, "{} should sort before {}", a, b);
    }
}
