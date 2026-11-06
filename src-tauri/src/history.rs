//! Version history, embedded in the single `.rite` file.
//!
//! A `.rite` file is a JSON object `{ document, history }` where `history` is
//! an ordered list of records — full `Snapshot`s (a `Document` at a point in
//! time) and `Delta`s (a `Vec<DocOp>` forward ops from the preceding state).
//! Reconstructing a past version = take the newest snapshot at or before the
//! target timestamp, then replay the intervening deltas forward. Every `DocOp`
//! carries its old state, so `apply_doc_ops` validates each step and refuses a
//! delta whose precondition no longer matches — a corruption guard.
//!
//! Previously history lived in a sidecar `<base>.rite.history/` directory of
//! snapshot/delta files. Embedding it makes a document a single self-contained
//! file (no separate folder visible in Finder, portable, shareable). Existing
//! sidecars are migrated into the embedded list on open and then deleted; bare
//! pre-embedding `.rite` files (a top-level `Document` with no wrapper) are
//! read via a deserialization fallback.
//!
//! Timestamps are UTC, fixed-width `YYYY-MM-DDTHH-MM-SS-mmm`, so a plain
//! lexicographic string sort is also chronological — which reconstruction
//! relies on. This module is pure functions over `&Document` / `&[HistoryRecord]`
//! / `&Path`; the Tauri command wrappers (which thread in `AppState`) live in
//! `commands.rs`, and the in-memory history + compaction policy live in
//! `state.rs`.

use crate::document::{apply_doc_ops, compute_doc_ops, DocOp, Document};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Suffix of the legacy sidecar directory. Kept only for one-time migration of
/// pre-embedding `.rite.history/` folders into the embedded record list.
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

/// One entry in the embedded history list. A `Snapshot` is a full `Document` at
/// `timestamp`; a `Delta` is the forward `DocOp`s that transformed the state
/// just before it into the state at `timestamp`. Tagged by `kind` on the wire.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum HistoryRecord {
    Snapshot { timestamp: String, document: Document },
    Delta { timestamp: String, ops: Vec<DocOp> },
}

impl HistoryRecord {
    pub fn timestamp(&self) -> &str {
        match self {
            HistoryRecord::Snapshot { timestamp, .. } => timestamp,
            HistoryRecord::Delta { timestamp, .. } => timestamp,
        }
    }

    fn kind(&self) -> HistoryKind {
        match self {
            HistoryRecord::Snapshot { .. } => HistoryKind::Snapshot,
            HistoryRecord::Delta { .. } => HistoryKind::Delta,
        }
    }
}

/// The on-disk `.rite` file: the live document plus its embedded history.
/// `history` defaults to empty so a hand-written or partially-migrated file
/// without a history array still deserializes.
///
/// `schema_version` tags the on-disk format generation the file was written
/// with. It is stamped on every write (see `write_rite_file`) and checked on
/// every read so a future breaking format change can be detected and migrated
/// rather than silently misread. `#[serde(default)]` makes the field default to
/// `0` when it is absent from the JSON — every `.rite` written before this field
/// existed is a legacy version-0 file, and must still open. `CURRENT_RITE_SCHEMA_VERSION`
/// is what a freshly written file is stamped with today; bump it the moment the
/// on-disk shape changes in a way old builds can't understand.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RiteFile {
    pub document: Document,
    #[serde(default)]
    pub history: Vec<HistoryRecord>,
    #[serde(default)]
    pub schema_version: u32,
}

/// The `.rite` schema version this build writes and understands. A file whose
/// `schemaVersion` is higher than this is from a newer Rite and is rejected on
/// read (see `read_rite_file` / `migrate_rite_file`) rather than parsed as if
/// it were today's shape — guessing at an unknown format would silently
/// corrupt the user's document. Bump this only when the on-disk structure
/// changes; pair it with a migration step in `migrate_rite_file`.
pub const CURRENT_RITE_SCHEMA_VERSION: u32 = 2;

/// A sortable, filesystem-safe UTC timestamp with millisecond precision.
/// Format: `2026-07-19T10-00-00-123`. Fixed width means `String::cmp` orders
/// timestamps chronologically, which reconstruction relies on.
pub fn current_timestamp() -> String {
    Utc::now().format("%Y-%m-%dT%H-%M-%S-%3f").to_string()
}

/// Write `content` to `path` via a sibling `.tmp` file then atomic rename, so a
/// crash mid-write cannot leave a half-written file. Generic over `AsRef<[u8]>`
/// so it serves both the text exports (a `&str` / `&String`) and the binary DOCX
/// export (a `&[u8]`); `&str` satisfies `AsRef<[u8]>` via its byte view, so the
/// existing text callers are unchanged.
pub(crate) fn atomic_write(path: &Path, content: impl AsRef<[u8]>) -> Result<(), String> {
    let tmp = format!("{}.tmp", path.to_string_lossy());
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Serialize a `RiteFile` to pretty JSON and atomically write it to `path`.
///
/// This is the single authority that stamps `schema_version` on every written
/// file: it takes ownership of the `RiteFile`, overwrites `schema_version`
/// with `CURRENT_RITE_SCHEMA_VERSION`, and only then serializes. Making the
/// writer the authority — rather than stamping in `build_rite_file` — means
/// nothing can bypass the stamp on the way to disk. Every call site that
/// constructs a `RiteFile` and hands it to `write_rite_file` is covered
/// automatically, and a caller that builds a `RiteFile` for some other purpose
/// (a test, an in-memory clone) is not forced to remember the stamp. The
/// `mut`/move signature makes the overwrite intentional and visible.
pub fn write_rite_file(path: &Path, mut file: RiteFile) -> Result<(), String> {
    file.schema_version = CURRENT_RITE_SCHEMA_VERSION;
    let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    atomic_write(path, &json)
}

/// Parse a `.rite` file's JSON into a `RiteFile`. Tries the embedded
/// `{ document, history }` shape first; if that fails, falls back to the
/// pre-embedding bare-`Document` shape (a top-level `Document` with no
/// wrapper) and wraps it with empty history. Either way the result is a
/// self-contained `RiteFile`.
///
/// A file whose parsed `schema_version` is *higher* than
/// `CURRENT_RITE_SCHEMA_VERSION` is from a newer build of Rite than this one,
/// and is rejected with a clear error rather than parsed as if it were today's
/// shape — reading an unknown format by guesswork would silently corrupt the
/// user's document. The bare-`Document` fallback path predates the field
/// entirely, so it is constructed as a version-0 (legacy) file and is allowed.
pub fn read_rite_file(json: &str) -> Result<RiteFile, String> {
    if let Ok(file) = serde_json::from_str::<RiteFile>(json) {
        if file.schema_version > CURRENT_RITE_SCHEMA_VERSION {
            return Err(format!(
                "unsupported .rite schema version {} (this build of rite supports up to version {}); update rite to open this file",
                file.schema_version, CURRENT_RITE_SCHEMA_VERSION
            ));
        }
        return Ok(file);
    }
    // Pre-embedding `.rite`: a top-level `Document` with no wrapper. It
    // predates `schema_version` too, so it is a legacy version-0 file.
    let document: Document = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok(RiteFile {
        document,
        history: Vec::new(),
        schema_version: 0,
    })
}

/// Apply any forward migrations a loaded `RiteFile` needs before it is handed
/// to the app. Intended to be called immediately after `read_rite_file` on the
/// open path (see `commands::open_document`), so the rest of the app only ever
/// sees a file at the current schema.
///
/// v2 (5.10) removed the document-level epigram fields and added
/// `Section.hidden`. Neither needs a data migration: serde ignores the stale
/// `hasEpigram`/`epigramText` keys in old files, `hidden` defaults to `false`
/// for sections written before the field, and old files whose embedded
/// history contained epigram metadata deltas already failed deserialization
/// in `read_rite_file` (the epigram feature removal is a deliberate break —
/// the user re-imports affected documents fresh). A version *higher* than
/// this build knows about is a hard error for the same reason as in
/// `read_rite_file`: an unknown format must not be guessed at.
pub fn migrate_rite_file(mut file: RiteFile) -> Result<RiteFile, String> {
    match file.schema_version {
        0 => {
            // Legacy: no migration needed, the v0 shape already deserializes
            // into the current `RiteFile`. Leave the version as-is so a
            // subsequent save stamps the current version via `write_rite_file`.
            Ok(file)
        }
        1 => {
            // v1 deserializes directly into the v2 shape (see the doc
            // comment); a resave stamps the current version via
            // `write_rite_file`.
            let _ = &mut file; // no migration steps needed; keep the binding
                               // mutable so future arms can mutate in place.
            Ok(file)
        }
        2 => {
            // Current: nothing to do.
            let _ = &mut file;
            Ok(file)
        }
        v if v > CURRENT_RITE_SCHEMA_VERSION => Err(format!(
            "unsupported .rite schema version {} (this build of rite supports up to version {}); update rite to open this file",
            v, CURRENT_RITE_SCHEMA_VERSION
        )),
        _ => Err(format!(
            "unsupported .rite schema version {} (this build of rite supports up to version {}); update rite to open this file",
            file.schema_version, CURRENT_RITE_SCHEMA_VERSION
        )),
    }
}

// --- Legacy sidecar migration ----------------------------------------------

/// `<base>.history` — the legacy sidecar history directory for a document at
/// `base`. Used only to migrate pre-embedding sidecars into embedded records.
fn history_dir(base_path: &Path) -> PathBuf {
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

/// Read a legacy `<base>.rite.history/` sidecar (snapshots + deltas) into an
/// ordered list of embedded `HistoryRecord`s, then delete the sidecar
/// directory. Returns an empty list (and deletes nothing) when no sidecar
/// exists. The one-time migration on open: after this the document's history
/// lives inside its `.rite` and the separate folder is gone.
pub fn migrate_sidecar(base_path: &Path) -> Result<Vec<HistoryRecord>, String> {
    let hist = history_dir(base_path);
    if !hist.exists() {
        return Ok(Vec::new());
    }

    let mut records = Vec::new();

    if let Ok(rd) = fs::read_dir(snapshots_dir(&hist)) {
        for entry in rd.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some(SNAPSHOT_EXT) {
                continue;
            }
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let document: Document = serde_json::from_str(&json).map_err(|e| e.to_string())?;
            records.push(HistoryRecord::Snapshot {
                timestamp: stem,
                document,
            });
        }
    }

    if let Ok(rd) = fs::read_dir(deltas_dir(&hist)) {
        for entry in rd.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some(DELTA_EXT) {
                continue;
            }
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let ops: Vec<DocOp> = serde_json::from_str(&json).map_err(|e| e.to_string())?;
            records.push(HistoryRecord::Delta {
                timestamp: stem,
                ops,
            });
        }
    }

    records.sort_by(|a, b| a.timestamp().cmp(b.timestamp()));

    // The sidecar's contents are now embedded; remove the folder so it stops
    // appearing alongside the `.rite` in Finder.
    fs::remove_dir_all(&hist).map_err(|e| e.to_string())?;

    Ok(records)
}

// --- Reconstruction & listing (pure, over the in-memory record list) --------

/// Reconstruct the document as it was at `target_ts`: take the newest snapshot
/// at or before `target_ts`, then apply every delta after that snapshot and up
/// to (and including) `target_ts`, in chronological order. Errors if no
/// suitable snapshot exists or a delta's precondition no longer matches.
pub fn reconstruct_version(target_ts: &str, history: &[HistoryRecord]) -> Result<Document, String> {
    // Newest snapshot with timestamp <= target. Timestamps can collide (two
    // saves within the same millisecond); the history list is appended in
    // chronological order, so on an equal timestamp a later index is the more
    // recent state — prefer it. `>=` (rather than `>`) makes the tie-break pick
    // the later of two equal-timestamp snapshots.
    let mut best: Option<usize> = None;
    for (i, record) in history.iter().enumerate() {
        if matches!(record, HistoryRecord::Snapshot { .. }) && record.timestamp() <= target_ts {
            if best.map_or(true, |b| record.timestamp() >= history[b].timestamp()) {
                best = Some(i);
            }
        }
    }
    let snap_idx = best.ok_or_else(|| format!("no snapshot at or before {}", target_ts))?;

    let mut doc = match &history[snap_idx] {
        HistoryRecord::Snapshot { document, .. } => document.clone(),
        HistoryRecord::Delta { .. } => unreachable!("best is always a snapshot index"),
    };

    // We picked the NEWEST snapshot <= target, so every record between it and
    // the target is a delta — replay them in order.
    for record in history.iter().skip(snap_idx + 1) {
        if record.timestamp() > target_ts {
            break;
        }
        if let HistoryRecord::Delta { ops, .. } = record {
            apply_doc_ops(&mut doc, ops)
                .map_err(|e| format!("applying delta {}: {}", record.timestamp(), e))?;
        }
    }

    Ok(doc)
}

/// List every snapshot and delta, oldest first, as frontend rows.
pub fn list_history(history: &[HistoryRecord]) -> Vec<HistoryEntry> {
    let mut entries: Vec<HistoryEntry> = history
        .iter()
        .map(|record| HistoryEntry {
            timestamp: record.timestamp().to_string(),
            kind: record.kind(),
            label: None,
        })
        .collect();
    entries.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    entries
}

// --- Compaction (pure) ------------------------------------------------------

/// Bound the history by keeping only the `max_snapshots` most recent snapshots
/// and the contiguous deltas after the oldest surviving one. Eviction is
/// contiguous from the front — the oldest snapshot and everything before the
/// oldest *surviving* snapshot are dropped together — so reconstruction of any
/// timestamp at or after the oldest surviving snapshot stays correct. Dropping
/// a delta from the middle would break replay, which is why we evict in one
/// contiguous slice rather than picking off individual deltas.
pub fn compact_history(history: &mut Vec<HistoryRecord>, max_snapshots: usize) {
    let snapshot_indices: Vec<usize> = history
        .iter()
        .enumerate()
        .filter(|(_, record)| matches!(record, HistoryRecord::Snapshot { .. }))
        .map(|(index, _)| index)
        .collect();

    if snapshot_indices.len() > max_snapshots {
        // Keep from the (len - max_snapshots)-th snapshot onward.
        let keep_from = snapshot_indices[snapshot_indices.len() - max_snapshots];
        history.drain(0..keep_from);
    }
}

/// Count the deltas after the most recent snapshot — used by the auto-snapshot
/// policy to decide when a run of deltas has grown long enough that the next
/// autosave should record a full snapshot instead of another delta (keeping
/// replay depth and file size bounded across a long unsaved session).
pub fn deltas_since_last_snapshot(history: &[HistoryRecord]) -> usize {
    let last_snapshot = history
        .iter()
        .rposition(|record| matches!(record, HistoryRecord::Snapshot { .. }));
    match last_snapshot {
        Some(idx) => history[idx + 1..]
            .iter()
            .filter(|record| matches!(record, HistoryRecord::Delta { .. }))
            .count(),
        None => history
            .iter()
            .filter(|record| matches!(record, HistoryRecord::Delta { .. }))
            .count(),
    }
}

/// Compute the forward `DocOp`s from `old` to `current`. Empty when the two are
/// identical (the caller treats an empty op list as "nothing to journal").
pub fn doc_ops_between(old: &Document, current: &Document) -> Vec<DocOp> {
    compute_doc_ops(old, current)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Element, Paragraph, Section, SectionType, TextRun, TextStyle};
    use std::path::PathBuf;

    /// A self-cleaning temp directory. `new` creates a fresh, unique dir; `Drop`
    /// removes it, even if the test panics.
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
            sections: vec![Section {
                id: "s1".to_string(),
                title: String::new(),
                section_type: SectionType::Section,
                hidden: false,
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

    // A tiny chronological timestamp helper for deterministic records. Real
    // timestamps come from `current_timestamp()`; tests need stable ordering
    // without depending on wall-clock timing.
    fn ts(minute: u32) -> String {
        format!("2026-07-19T10-{:02}-00-000", minute)
    }

    fn snapshot(minute: u32, text: &str) -> HistoryRecord {
        HistoryRecord::Snapshot {
            timestamp: ts(minute),
            document: doc_text(text),
        }
    }

    fn delta(minute: u32, old: &str, new: &str) -> HistoryRecord {
        HistoryRecord::Delta {
            timestamp: ts(minute),
            ops: compute_doc_ops(&doc_text(old), &doc_text(new)),
        }
    }

    #[test]
    fn rite_file_roundtrips_through_json() {
        let file = RiteFile {
            document: doc_text("hello"),
            history: vec![snapshot(0, "hello"), delta(5, "hello", "hello world")],
            schema_version: CURRENT_RITE_SCHEMA_VERSION,
        };
        let json = serde_json::to_string_pretty(&file).unwrap();
        let back: RiteFile = serde_json::from_str(&json).unwrap();
        assert_eq!(back, file);
    }

    #[test]
    fn write_then_read_rite_file_roundtrips() {
        let tmp = TempDir::new("write_read");
        // Build a file with a stale version (0); write_rite_file is the
        // authority and must stamp the current version on the way to disk.
        let file = RiteFile {
            document: doc_text("hello"),
            history: vec![snapshot(0, "hello")],
            schema_version: 0,
        };
        write_rite_file(&tmp.base(), file.clone()).unwrap();
        let json = fs::read_to_string(&tmp.base()).unwrap();
        let back = read_rite_file(&json).unwrap();
        assert_eq!(back.schema_version, CURRENT_RITE_SCHEMA_VERSION);
        assert_eq!(back.document, file.document);
        assert_eq!(back.history, file.history);
    }

    #[test]
    fn read_rite_file_falls_back_to_bare_document() {
        // A pre-embedding .rite is a bare Document (no `document`/`history`
        // wrapper). read_rite_file must accept it and wrap it with empty
        // history so old files still open. It also predates `schema_version`,
        // so the result is a legacy version-0 file.
        let bare = serde_json::to_string_pretty(&doc_text("legacy")).unwrap();
        let file = read_rite_file(&bare).unwrap();
        assert_eq!(para_text(&file.document), "legacy");
        assert!(file.history.is_empty());
        assert_eq!(file.schema_version, 0);
    }

    #[test]
    fn reconstruct_at_snapshot_returns_snapshot_verbatim() {
        let history = vec![snapshot(0, "a"), delta(5, "a", "ab")];
        let loaded = reconstruct_version(&ts(0), &history).unwrap();
        assert_eq!(para_text(&loaded), "a");
    }

    #[test]
    fn reconstruct_replays_deltas_forward() {
        let history = vec![
            snapshot(0, "a"),
            delta(5, "a", "ab"),
            delta(10, "ab", "abc"),
        ];
        assert_eq!(para_text(&reconstruct_version(&ts(5), &history).unwrap()), "ab");
        assert_eq!(
            para_text(&reconstruct_version(&ts(10), &history).unwrap()),
            "abc"
        );
    }

    #[test]
    fn reconstruct_prefers_later_snapshot_on_equal_timestamps() {
        // Two snapshots share a timestamp (e.g. a save and an autosave within
        // the same millisecond). The later-appended one represents the more
        // recent state, so reconstructing at that timestamp must pick it — not
        // the older snapshot with the same timestamp.
        let same = ts(10);
        let history = vec![
            HistoryRecord::Snapshot {
                timestamp: same.clone(),
                document: doc_text("older"),
            },
            HistoryRecord::Snapshot {
                timestamp: same.clone(),
                document: doc_text("newer"),
            },
        ];
        assert_eq!(
            para_text(&reconstruct_version(&same, &history).unwrap()),
            "newer"
        );
    }

    #[test]
    fn reconstruct_uses_newest_snapshot_at_or_before_target() {
        // Two snapshots; a target after the second must NOT replay the first
        // snapshot's deltas.
        let history = vec![
            snapshot(0, "a"),
            delta(5, "a", "ab"),
            snapshot(10, "xy"), // a fresh baseline
            delta(15, "xy", "xyz"),
        ];
        assert_eq!(
            para_text(&reconstruct_version(&ts(15), &history).unwrap()),
            "xyz"
        );
    }

    #[test]
    fn reconstruct_before_oldest_snapshot_errors() {
        let history = vec![snapshot(10, "a")];
        let res = reconstruct_version(&ts(0), &history);
        assert!(res.is_err());
    }

    #[test]
    fn reconstruct_with_empty_history_errors() {
        let res = reconstruct_version(&ts(0), &[]);
        assert!(res.is_err());
    }

    #[test]
    fn list_history_is_sorted_oldest_first_with_kinds() {
        let history = vec![
            snapshot(0, "a"),
            delta(5, "a", "ab"),
            delta(10, "ab", "abc"),
        ];
        let entries = list_history(&history);
        assert_eq!(entries.len(), 3);
        assert!(entries.windows(2).all(|w| w[0].timestamp < w[1].timestamp));
        assert_eq!(entries[0].kind, HistoryKind::Snapshot);
        assert_eq!(entries[1].kind, HistoryKind::Delta);
        assert_eq!(entries[2].kind, HistoryKind::Delta);
    }

    #[test]
    fn compact_keeps_only_most_recent_snapshots() {
        let mut history = vec![
            snapshot(0, "a"),
            delta(5, "a", "ab"),
            snapshot(10, "ab"),
            delta(15, "ab", "abc"),
            snapshot(20, "abc"),
        ];
        compact_history(&mut history, 2);
        // The first snapshot + its delta are evicted; the two newest snapshots
        // (and the delta between them) survive.
        assert_eq!(history.len(), 3);
        assert_eq!(history[0], snapshot(10, "ab"));
        assert_eq!(history[1], delta(15, "ab", "abc"));
        assert_eq!(history[2], snapshot(20, "abc"));
    }

    #[test]
    fn compact_preserves_reconstruction_of_surviving_range() {
        let mut history = vec![
            snapshot(0, "a"),
            delta(5, "a", "ab"),
            snapshot(10, "ab"),
            delta(15, "ab", "abc"),
            snapshot(20, "abc"),
            delta(25, "abc", "abcd"),
        ];
        compact_history(&mut history, 2);
        // The oldest surviving snapshot is at minute 10; anything before it is
        // gone, but everything from minute 10 on reconstructs correctly.
        assert!(reconstruct_version(&ts(0), &history).is_err());
        assert_eq!(para_text(&reconstruct_version(&ts(10), &history).unwrap()), "ab");
        assert_eq!(
            para_text(&reconstruct_version(&ts(25), &history).unwrap()),
            "abcd"
        );
    }

    #[test]
    fn compact_is_noop_when_at_or_under_cap() {
        let mut history = vec![snapshot(0, "a"), delta(5, "a", "ab")];
        compact_history(&mut history, 5);
        assert_eq!(history.len(), 2);
    }

    #[test]
    fn deltas_since_last_snapshot_counts_trailing_deltas() {
        let history = vec![snapshot(0, "a"), delta(5, "a", "ab"), delta(10, "ab", "abc")];
        assert_eq!(deltas_since_last_snapshot(&history), 2);

        let history2 = vec![delta(5, "a", "ab")]; // no snapshot yet
        assert_eq!(deltas_since_last_snapshot(&history2), 1);
    }

    #[test]
    fn migrate_sidecar_reads_and_removes_legacy_folder() {
        let tmp = TempDir::new("migrate");
        // Build a legacy sidecar by hand: a snapshot + a delta, the way the old
        // code wrote them (pretty Document JSON / Vec<DocOp> JSON).
        let hist = history_dir(&tmp.base());
        fs::create_dir_all(snapshots_dir(&hist)).unwrap();
        fs::create_dir_all(deltas_dir(&hist)).unwrap();
        fs::write(
            snapshots_dir(&hist).join(format!("{}.{}", ts(0), SNAPSHOT_EXT)),
            serde_json::to_string_pretty(&doc_text("a")).unwrap(),
        )
        .unwrap();
        fs::write(
            deltas_dir(&hist).join(format!("{}.{}", ts(5), DELTA_EXT)),
            serde_json::to_string(&compute_doc_ops(&doc_text("a"), &doc_text("ab"))).unwrap(),
        )
        .unwrap();

        let records = migrate_sidecar(&tmp.base()).unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].timestamp(), ts(0));
        assert_eq!(records[1].timestamp(), ts(5));

        // Reconstructing from the migrated records matches the sidecar's data.
        assert_eq!(para_text(&reconstruct_version(&ts(5), &records).unwrap()), "ab");

        // The sidecar folder is gone.
        assert!(!hist.exists());
    }

    #[test]
    fn migrate_sidecar_returns_empty_when_none_exists() {
        let tmp = TempDir::new("migrate_none");
        let records = migrate_sidecar(&tmp.base()).unwrap();
        assert!(records.is_empty());
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

    // --- schema versioning -----------------------------------------------------

    /// A helper that builds a minimal `RiteFile` with `make_`-prefixed test-only
    /// builder naming (per the user's convention). `version` lets each test
    /// pin the schema version without repeating the whole struct literal.
    fn make_rite_file(version: u32) -> RiteFile {
        RiteFile {
            document: doc_text("hello"),
            history: vec![snapshot(0, "hello")],
            schema_version: version,
        }
    }

    #[test]
    fn write_rite_file_stamps_current_schema_version() {
        // A file built with a stale/unknown version must come off disk stamped
        // with the current version — write_rite_file is the single authority.
        let tmp = TempDir::new("stamp");
        let file = make_rite_file(0);
        write_rite_file(&tmp.base(), file).unwrap();
        let json = fs::read_to_string(&tmp.base()).unwrap();
        // The on-disk JSON literally carries the stamped camelCase field.
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["schemaVersion"], CURRENT_RITE_SCHEMA_VERSION);
        // And reading it back yields the same stamped version.
        let back = read_rite_file(&json).unwrap();
        assert_eq!(back.schema_version, CURRENT_RITE_SCHEMA_VERSION);
    }

    #[test]
    fn read_rite_file_legacy_json_without_schema_version_deserializes_to_zero() {
        // A .rite written before schema_version existed has no `schemaVersion`
        // field. `#[serde(default)]` must make it deserialize to 0 (legacy)
        // and the file must still open.
        let legacy = serde_json::json!({
            "document": doc_text("legacy"),
            "history": [],
        })
        .to_string();
        let file = read_rite_file(&legacy).unwrap();
        assert_eq!(file.schema_version, 0);
        assert_eq!(para_text(&file.document), "legacy");
    }

    #[test]
    fn read_rite_file_rejects_future_schema_version() {
        // A file from a newer Rite (version 2) must be rejected with a clear
        // error naming both the file's version and the max this build supports,
        // rather than silently misreading the unknown format.
        let future = serde_json::json!({
            "document": doc_text("future"),
            "history": [],
            "schemaVersion": CURRENT_RITE_SCHEMA_VERSION + 1,
        })
        .to_string();
        let err = read_rite_file(&future).unwrap_err();
        assert!(
            err.contains(&format!("version {}", CURRENT_RITE_SCHEMA_VERSION + 1)),
            "error should name the file's version: {}",
            err
        );
        assert!(
            err.contains("update rite"),
            "error should tell the user to update: {}",
            err
        );
    }

    #[test]
    fn migrate_rite_file_passes_current_and_legacy_through_unchanged() {
        // A current (v2) file passes through migrate untouched.
        let current = make_rite_file(CURRENT_RITE_SCHEMA_VERSION);
        let migrated = migrate_rite_file(current.clone()).unwrap();
        assert_eq!(migrated, current);

        // A v1 file (pre-5.10: no Section.hidden, document-level epigram
        // fields) also passes through — it deserializes directly into the
        // current shape (`hidden` defaults to false; stale epigram keys are
        // ignored), and a resave stamps v2 via write_rite_file.
        let v1 = make_rite_file(1);
        let migrated = migrate_rite_file(v1.clone()).unwrap();
        assert_eq!(migrated, v1);

        // A legacy (v0) file also passes through — v0 already deserializes
        // into the current shape.
        let legacy = make_rite_file(0);
        let migrated = migrate_rite_file(legacy.clone()).unwrap();
        assert_eq!(migrated, legacy);
    }

    #[test]
    fn v1_file_without_epigram_history_deltas_still_reads() {
        // The deliberate 5.10 break is narrower than "all old files": only v1
        // files whose EMBEDDED HISTORY holds epigram metadata deltas fail (the
        // MetadataField variants are gone). A v1 file with ordinary deltas —
        // and stale `hasEpigram`/`epigramText` keys inside `document`, plus
        // sections with no `hidden` key — must still open.
        let v1_json = serde_json::json!({
            "document": {
                "title": "T",
                "author": "A",
                "authorContact": "C",
                "hasTOC": false,
                "hasEpigram": true,
                "epigramText": "stale",
                "sections": [{
                    "id": "s1",
                    "title": "One",
                    "sectionType": "section",
                    "paragraphs": [{
                        "id": "p1",
                        "elements": [{ "textRun": {
                            "content": "hello",
                            "textStyle": {},
                        }}],
                        "leftIndent": null,
                        "rightIndent": null,
                        "firstLineIndent": null,
                    }],
                }],
            },
            "history": [
                { "kind": "delta",
                  "timestamp": "2026-01-01T00-00-00-000",
                  "ops": [{ "type": "rename_section",
                            "id": "s1", "old_title": "Old", "new_title": "One" }] },
            ],
            "schemaVersion": 1,
        })
        .to_string();
        let file = read_rite_file(&v1_json).unwrap();
        let file = migrate_rite_file(file).unwrap();
        assert_eq!(file.document.sections[0].hidden, false);
        assert_eq!(file.document.sections[0].title, "One");
        let migrated = migrate_rite_file(file).unwrap();
        assert_eq!(migrated.schema_version, 1);
    }

    #[test]
    fn migrate_rite_file_errors_on_future_version() {
        // A file from a newer Rite must not be migrated by guesswork; it errors
        // with the same clear message as read_rite_file.
        let future = make_rite_file(CURRENT_RITE_SCHEMA_VERSION + 1);
        let err = migrate_rite_file(future).unwrap_err();
        assert!(
            err.contains(&format!("version {}", CURRENT_RITE_SCHEMA_VERSION + 1)),
            "error should name the file's version: {}",
            err
        );
    }
}