//! Durable persistence for Phase 4.3's in-memory RAG vector store.
//!
//! 4.3 keeps `AppState.vectors` + `AppState.section_hashes` in memory only, so
//! every app restart re-embeds the whole manuscript from scratch even if nothing
//! changed. This module persists them to a per-manuscript sidecar file in Tauri's
//! `app_data_dir/indexes/` — loaded on `open_document`, checkpointed on
//! `save_document`/`autosave_document`. On reload the EXISTING `plan_reembed`
//! differential reconciles the persisted `section_hashes` baseline against the
//! live document: unchanged sections keep their vectors, changed sections
//! re-embed. A missing/corrupt sidecar, or one from a different manuscript,
//! simply starts empty → a full rebuild (no data is lost; vectors are
//! derivable). The sidecar is a separate file (NOT embedded in the `.rite`)
//! because vectors are large (~768 floats × many chunks) and `write_rite_file`
//! rewrites the whole `.rite` on every autosave — embedding them would make
//! autosave slow for an indexed manuscript. This mirrors the `roles/` precedent
//! (`app_data_dir` + `atomic_write`) rather than the legacy `.rite.history`
//! folder the project deliberately moved away from.
//!
//! The sidecar has its OWN schema version (independent of `RiteFile`'s) so it can
//! evolve — Phase 4.8 adds a `summaries` field (`#[serde(default)]` so a
//! 4.7-written sidecar still loads) and bumps this version.

use crate::history::atomic_write;
use crate::retrieval::StoredChunk;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::hash::{DefaultHasher, Hasher};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// The sidecar schema version this build writes and understands. Independent of
/// `RiteFile`'s `.rite` schema — the sidecar is a separate file in
/// `app_data_dir`, so it can evolve without bumping the `.rite` schema. A sidecar
/// whose `schemaVersion` is higher than this is from a newer Rite and is
/// rejected (→ graceful full rebuild) rather than guessed at. Bump this only
/// when the on-disk shape changes; pair it with a migration arm in
/// `migrate_sidecar`.
pub const CURRENT_SIDECAR_SCHEMA_VERSION: u32 = 1;

/// The on-disk shape of a manuscript's vector index: the section-hash baseline
/// (`section_id → hash of the section's concatenated paragraph text`, the
/// differential signal `reembed_document` diffs against) + the vectors
/// themselves. `camelCase` on the wire to match `Chunk`/`ReembedReport`. Both
/// payload fields are `#[serde(default)]` so a truncated-but-parseable file
/// degrades to an empty index rather than failing to load.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sidecar {
    #[serde(default)]
    pub schema_version: u32,
    #[serde(default)]
    pub section_hashes: HashMap<String, u64>,
    #[serde(default)]
    pub vectors: Vec<StoredChunk>,
}

impl Sidecar {
    /// Build a sidecar snapshot from the current in-memory store, stamped with
    /// the current schema version. (`write` is the only authority that needs the
    /// version; constructing it here keeps the call site a one-liner and mirrors
    /// how `build_rite_file` carries a neutral version for the writer to stamp.)
    pub fn new(section_hashes: HashMap<String, u64>, vectors: Vec<StoredChunk>) -> Self {
        Self {
            schema_version: CURRENT_SIDECAR_SCHEMA_VERSION,
            section_hashes,
            vectors,
        }
    }
}

/// A stable, filesystem-safe hex digest of a manuscript's path, used as the
/// sidecar filename. `DefaultHasher::new()` is SipHash with a CONSTANT key, so
/// it is deterministic across processes for the same binary — the same `.rite`
/// path always maps to the same sidecar file across opens/saves. Moving or
/// renaming the `.rite` orphans the sidecar (a different digest) → graceful full
/// rebuild on next open. The digest is an internal key, never user-facing.
fn path_digest(manuscript_path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    hasher.write(manuscript_path.as_bytes());
    format!("{:016x}", hasher.finish())
}

/// The on-disk path for a manuscript's sidecar, given the resolved `indexes`
/// directory. Pure (no `AppHandle`) so it is unit-testable.
fn sidecar_file_path(indexes_dir: &Path, manuscript_path: &str) -> PathBuf {
    indexes_dir.join(format!("{}.json", path_digest(manuscript_path)))
}

/// Resolve `<app_data_dir>/indexes/` (the directory, NOT created here — reads
/// must not create empty dirs as a side effect). Mirrors `llm.rs::roles_dir`'s
/// `path_resolver().app_data_dir()` usage (Tauri v1: `Option<PathBuf>`, NOT the
/// v2-style `app.path()`; `use tauri::Manager` is NOT needed — `path_resolver`
/// resolves without it).
fn indexes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "could not resolve app data dir".to_string())?;
    Ok(base.join("indexes"))
}

/// Parse a sidecar JSON string into a `Sidecar`. A file whose `schemaVersion` is
/// higher than `CURRENT_SIDECAR_SCHEMA_VERSION` is from a newer Rite and is
/// rejected with a clear error (the caller treats any error as "no sidecar" →
/// full rebuild) rather than guessed at. Pure — the unit-testable core of
/// `load_sidecar`.
pub fn parse_sidecar(json: &str) -> Result<Sidecar, String> {
    let sidecar: Sidecar = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if sidecar.schema_version > CURRENT_SIDECAR_SCHEMA_VERSION {
        return Err(format!(
            "unsupported sidecar schema version {} (this build of rite supports up to version {})",
            sidecar.schema_version, CURRENT_SIDECAR_SCHEMA_VERSION
        ));
    }
    Ok(sidecar)
}

/// Apply any forward migrations a loaded `Sidecar` needs before it is used.
/// Structured like `history::migrate_rite_file` so Phase 4.8 can add a `1 => 2`
/// arm (adding the `summaries` field). No migrations exist yet.
pub fn migrate_sidecar(sidecar: Sidecar) -> Result<Sidecar, String> {
    match sidecar.schema_version {
        1 => Ok(sidecar),
        v if v > CURRENT_SIDECAR_SCHEMA_VERSION => Err(format!(
            "unsupported sidecar schema version {}",
            v
        )),
        _ => Err(format!(
            "unknown sidecar schema version {}",
            sidecar.schema_version
        )),
    }
}

/// Read + parse the sidecar at `path`. Missing file or corrupt/future-version
/// JSON → `None`, so the caller starts empty → a full rebuild. Never panics,
/// never returns a partial/invalid store. Pure I/O core (takes a `&Path`, no
/// `AppHandle`) so it is TempDir-testable.
fn load_sidecar_at(path: &Path) -> Option<Sidecar> {
    let json = fs::read_to_string(path).ok()?;
    parse_sidecar(&json)
        .ok()
        .and_then(|s| migrate_sidecar(s).ok())
}

/// Serialize + atomically write the sidecar to `path` (via `atomic_write`, so a
/// crash mid-write cannot leave a half-written index). Pure I/O core.
fn write_sidecar_at(path: &Path, sidecar: &Sidecar) -> Result<(), String> {
    let json = serde_json::to_string_pretty(sidecar).map_err(|e| e.to_string())?;
    atomic_write(path, &json)
}

/// Load the sidecar for `manuscript_path`. Missing/corrupt/future-version →
/// `None` (full rebuild). Does NOT create the `indexes` dir — a read that finds
/// nothing leaves the filesystem untouched. `AppHandle` is auto-injected by Tauri
/// at the command boundary.
pub fn load_sidecar(app: &AppHandle, manuscript_path: &str) -> Option<Sidecar> {
    let dir = indexes_dir(app).ok()?;
    let path = sidecar_file_path(&dir, manuscript_path);
    load_sidecar_at(&path)
}

/// Checkpoint `sidecar` for `manuscript_path`, creating the `indexes` dir on
/// first use. `AppHandle` is auto-injected by Tauri at the command boundary.
pub fn write_sidecar(
    app: &AppHandle,
    manuscript_path: &str,
    sidecar: &Sidecar,
) -> Result<(), String> {
    let dir = indexes_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create indexes dir: {}", e))?;
    let path = sidecar_file_path(&dir, manuscript_path);
    write_sidecar_at(&path, sidecar)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::retrieval::Chunk;

    /// Build a `StoredChunk` with a couple of vector dims for round-trip tests.
    fn stored_chunk(section_id: &str, ordinal: usize, text: &str, vector: &[f32]) -> StoredChunk {
        StoredChunk {
            chunk: Chunk {
                id: format!("{}:{}", section_id, ordinal),
                section_id: section_id.to_string(),
                chapter_index: Some(1),
                text: text.to_string(),
            },
            vector: vector.to_vec(),
        }
    }

    #[test]
    fn path_digest_is_stable_and_distinguishing() {
        // Same path → same digest.
        assert_eq!(path_digest("/Users/x/novel.rite"), path_digest("/Users/x/novel.rite"));
        // Different paths → different digests (so two manuscripts don't collide).
        assert_ne!(path_digest("/Users/x/novel.rite"), path_digest("/Users/x/novel2.rite"));
        // 16-char hex.
        assert_eq!(path_digest("/x/y.rite").len(), 16);
        assert!(path_digest("/x/y.rite").chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn sidecar_file_path_is_keyed_by_path_digest() {
        let dir = Path::new("/tmp/rite-indexes");
        let a = sidecar_file_path(dir, "/Users/x/novel.rite");
        let b = sidecar_file_path(dir, "/Users/x/novel.rite");
        let c = sidecar_file_path(dir, "/Users/x/novel2.rite");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(a.starts_with(dir));
        assert_eq!(a.extension().unwrap(), "json");
    }

    #[test]
    fn sidecar_round_trips_vectors_and_hashes() {
        let sidecar = Sidecar::new(
            HashMap::from([("s1".to_string(), 111), ("s2".to_string(), 222)]),
            vec![stored_chunk("s1", 0, "hello world", &[0.1, 0.2, 0.3])],
        );
        let json = serde_json::to_string_pretty(&sidecar).unwrap();
        let back = parse_sidecar(&json).unwrap();
        assert_eq!(back, sidecar);
        assert_eq!(back.schema_version, CURRENT_SIDECAR_SCHEMA_VERSION);
        assert_eq!(back.vectors.len(), 1);
        assert_eq!(back.vectors[0].vector, vec![0.1, 0.2, 0.3]);
        assert_eq!(back.section_hashes.get("s2"), Some(&222));
    }

    #[test]
    fn parse_sidecar_rejects_future_schema() {
        let json = format!(
            "{{\"schemaVersion\":{},\"sectionHashes\":{{}},\"vectors\":[]}}",
            CURRENT_SIDECAR_SCHEMA_VERSION + 1
        );
        assert!(parse_sidecar(&json).is_err());
    }

    #[test]
    fn parse_sidecar_accepts_current_schema() {
        let json = format!(
            "{{\"schemaVersion\":{},\"sectionHashes\":{{}},\"vectors\":[]}}",
            CURRENT_SIDECAR_SCHEMA_VERSION
        );
        let back = parse_sidecar(&json).unwrap();
        assert!(back.vectors.is_empty());
        assert!(back.section_hashes.is_empty());
    }

    #[test]
    fn parse_sidecar_defaults_missing_payload_fields() {
        // A parseable file with just the version still loads (empty index) —
        // truncated payloads degrade to empty rather than failing.
        let json = format!(
            "{{\"schemaVersion\":{}}}",
            CURRENT_SIDECAR_SCHEMA_VERSION
        );
        let back = parse_sidecar(&json).unwrap();
        assert!(back.vectors.is_empty());
        assert!(back.section_hashes.is_empty());
    }

    #[test]
    fn load_sidecar_at_returns_none_for_missing_file() {
        let tmp = std::env::temp_dir().join(format!(
            "rite-sidecar-test-missing-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let path = tmp.join("nope.json");
        assert!(load_sidecar_at(&path).is_none());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn load_sidecar_at_returns_none_for_corrupt_json() {
        let tmp = std::env::temp_dir().join(format!(
            "rite-sidecar-test-corrupt-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let path = tmp.join("bad.json");
        std::fs::write(&path, "not json at all {{{").unwrap();
        assert!(load_sidecar_at(&path).is_none());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn write_then_load_round_trips_on_disk() {
        let tmp = std::env::temp_dir().join(format!(
            "rite-sidecar-test-roundtrip-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let path = tmp.join("index.json");

        let sidecar = Sidecar::new(
            HashMap::from([("s1".to_string(), 999)]),
            vec![
                stored_chunk("s1", 0, "first chunk", &[0.5, -0.5]),
                stored_chunk("s1", 1, "second chunk", &[1.0, 0.0]),
            ],
        );
        write_sidecar_at(&path, &sidecar).unwrap();
        let back = load_sidecar_at(&path).unwrap();
        assert_eq!(back, sidecar);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn migrate_sidecar_accepts_current_rejects_future() {
        let current = Sidecar::new(HashMap::new(), Vec::new());
        assert!(migrate_sidecar(current.clone()).is_ok());

        let mut future = current;
        future.schema_version = CURRENT_SIDECAR_SCHEMA_VERSION + 1;
        assert!(migrate_sidecar(future).is_err());
    }
}