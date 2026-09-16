//! Manuscript chunking for RAG retrieval (Phase 4.1).
//!
//! The analytical assistant's "Whole document" Feedback Target currently sends
//! the entire manuscript verbatim as one context message — expensive in tokens
//! and unfocused. Phase 4 replaces that with retrieval: chunk the manuscript,
//! embed each chunk, and at send time inject only the chunks most relevant to
//! the question. This module is the head of that chain.
//!
//! `chunk_document` is pure: it walks the document model and groups paragraphs
//! into roughly target-sized chunks. It does no I/O and holds no `State` — the
//! `retrieve_passages` Tauri command that consumes these chunks lands later
//! (4.4). The `Chunk` shape is the contract 4.2 (embedding) / 4.3 (vector
//! store) / 4.4 (retrieval + injection) build on, so it is defined here and
//! `Serialize`-derived so 4.4 can return chunks to the frontend unchanged.

use crate::document::{Document, Paragraph, Section, SectionType};
use crate::llm::{build_headers, normalize_base};
use crate::state::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::atomic::Ordering;
use tauri::State;

/// Rough target size for a chunk, in words. Chunks accumulate paragraphs until
/// adding the next would exceed this; a single paragraph longer than this
/// becomes its own over-target chunk (we never split mid-paragraph). 256 is a
/// balance: small enough to keep each embedded passage focused on one beat,
/// large enough that short paragraphs coalesce instead of fragmenting into
/// near-empty chunks. Tunable.
const TARGET_CHUNK_WORDS: u32 = 256;

/// A contiguous slice of one section's prose, ready to embed.
///
/// `id` is `"{section_id}:{ordinal}"`, where `ordinal` is the 0-based position
/// of this chunk among the chunks produced from its section. It identifies a
/// chunk within a single `chunk_document` pass; 4.3's vector store does NOT key
/// off it for the differential (inserting a paragraph mid-section shifts every
/// following ordinal), but keeps it for 4.4 to reference a passage back to its
/// source section.
///
/// `section_id` + `chapter_index` carry the chunk's structural context so
/// retrieval (4.4) can label a passage ("from Chapter 3") without re-walking
/// the document. `chapter_index` is `Option<u32>`: `Some(n)` is the 1-based
/// number of the nearest preceding `Chapter` (inclusive — a chunk inside a
/// Chapter carries that Chapter's number); `None` means the chunk comes from
/// front matter before any Chapter (an epigram section, etc.). Using `Option`
/// rather than a `0` sentinel keeps "no chapter yet" distinct from a
/// hypothetical "Chapter 0" — the Rust idiom.
///
/// A chunk never spans two sections: the buffer is flushed at every section
/// boundary, so `section_id` and `chapter_index` are unambiguous for the whole
/// chunk.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    pub id: String,
    pub section_id: String,
    pub chapter_index: Option<u32>,
    pub text: String,
}

/// Concatenate a paragraph's text runs into a plain string — no HTML, no
/// styling. This is the same one-liner `diff.rs::paragraph_text` and every
/// export module inline; it isn't worth cross-module coupling to share, so it
/// is re-implemented here. A paragraph's text is the concatenation of its
/// elements' `text_run.content` fields.
fn paragraph_text(paragraph: &Paragraph) -> String {
    paragraph
        .elements
        .iter()
        .map(|element| element.text_run.content.as_str())
        .collect()
}

/// Whitespace-delimited word count of a string. `str::split_whitespace` treats
/// any run of whitespace as a single separator and ignores leading/trailing
/// whitespace, which is what we want for a chunk-size estimate.
fn count_words(text: &str) -> u32 {
    text.split_whitespace().count() as u32
}

/// Split a document into embedding-sized chunks.
///
/// Walks `doc.sections` in order, carrying a running `chapter_index` that
/// advances only on `SectionType::Chapter` (matching the render-derived
/// chapter numbering used in `export_text` / `export_docx`: the first Chapter
/// is 1, and a `Section` between two Chapters does not advance the counter).
/// Within each section, paragraphs are greedily merged into a buffer until
/// adding the next would push the chunk over `TARGET_CHUNK_WORDS`, at which
/// point the buffer is flushed as a `Chunk` and the next paragraph starts a
/// fresh buffer. Empty paragraphs are skipped (they add embedding noise). The
/// buffer is also flushed at every section boundary, so a chunk never crosses
/// a section — keeping each chunk's `section_id` / `chapter_index` clean.
pub fn chunk_document(doc: &Document) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    // None until the first Chapter is seen; Some(n) thereafter, advancing only
    // on Chapter sections.
    let mut chapter_index: Option<u32> = None;

    for section in &doc.sections {
        // Advance the chapter counter for a Chapter (1-based, position among
        // Chapter-type sections only). Sections of type `Section` inherit the
        // nearest preceding Chapter's index (or None if none has appeared).
        if section.section_type == SectionType::Chapter {
            chapter_index = Some(chapter_index.unwrap_or(0) + 1);
        }

        let mut buffer = String::new();
        let mut buffer_words: u32 = 0;
        let mut ordinal: u32 = 0;

        for paragraph in &section.paragraphs {
            let text = paragraph_text(paragraph);
            // Skip blank paragraphs — they carry no semantic content for
            // embedding and would only dilute a chunk. Scene-break `***` / `#`
            // paragraphs are non-empty, so they survive.
            if text.trim().is_empty() {
                continue;
            }
            let words = count_words(&text);

            // Flush the in-progress chunk before adding this paragraph if doing
            // so would exceed the target. We flush BEFORE appending (not after)
            // so the new paragraph starts the next chunk rather than tipping
            // the current one over. `buffer_words > 0` guards the case of a
            // single paragraph larger than the target: with an empty buffer we
            // don't flush, so that paragraph becomes its own over-target chunk
            // rather than producing an empty leading chunk.
            if buffer_words > 0 && buffer_words + words > TARGET_CHUNK_WORDS {
                chunks.push(Chunk {
                    id: format!("{}:{}", section.id, ordinal),
                    section_id: section.id.clone(),
                    chapter_index,
                    text: std::mem::take(&mut buffer),
                });
                buffer_words = 0;
                ordinal += 1;
            }

            // Join paragraphs within a chunk with a newline. The first
            // paragraph in a buffer (after a flush or at section start) has an
            // empty buffer, so it gets no leading separator.
            if !buffer.is_empty() {
                buffer.push('\n');
            }
            buffer.push_str(&text);
            buffer_words += words;
        }

        // Flush whatever remains at the section boundary so the next section's
        // chunks carry the next section's id / chapter index (a chunk never
        // spans sections).
        if buffer_words > 0 {
            chunks.push(Chunk {
                id: format!("{}:{}", section.id, ordinal),
                section_id: section.id.clone(),
                chapter_index,
                text: buffer,
            });
        }
    }

    chunks
}

// --- Embedding (Phase 4.2) --------------------------------------------------
//
// The second link in the RAG chain: turn a chunk's text into a vector via the
// provider's embeddings endpoint. 4.3's in-memory vector store calls
// `embed_texts` directly from Rust; the General Options drawer's "Test
// embeddings" button (and 4.4's retrieval) call it as a Tauri command. Like
// the chat path, the API key is passed in per call and never stored in
// `AppState`, keeping it out of the webview's inspectable fetch headers.

/// Build the JSON body for an embeddings request. Both the OpenAI-compatible
/// `/v1/embeddings` and Ollama's native `/api/embed` accept the same shape —
/// `{ "model": …, "input": [ … ] }` — so this is shared across both paths.
/// `input` is always an array (even for a single text), which keeps the return
/// shape uniform: one vector per input text, in order.
fn embeddings_request_body(model: &str, texts: &[String]) -> Value {
    json!({ "model": model, "input": texts })
}

/// Parse the OpenAI-compatible embeddings response
/// `{ "data": [{ "embedding": [f32…] }] }` into one vector per entry, in order.
/// Errors clearly on a missing `data` array or a missing/malformed `embedding`
/// on any entry, mirroring `llm_chat`'s `"response missing …"` style. JSON
/// numbers come back as `f64`; we narrow to `f32` (the precision embeddings
/// models actually use) with `as f32`.
fn parse_openai_embeddings(json: &Value) -> Result<Vec<Vec<f32>>, String> {
    let data = json
        .get("data")
        .and_then(|d| d.as_array())
        .ok_or_else(|| "response missing data".to_string())?;
    data.iter()
        .map(|entry| {
            let embedding = entry
                .get("embedding")
                .and_then(|e| e.as_array())
                .ok_or_else(|| "response missing data[*].embedding".to_string())?;
            embedding
                .iter()
                .map(|n| {
                    n.as_f64()
                        .ok_or_else(|| "response has a non-numeric embedding value".to_string())
                        .map(|v| v as f32)
                })
                .collect()
        })
        .collect()
}

/// Parse Ollama's native embeddings response `{ "embeddings": [[f32…], …] }`
/// into one vector per row, in order. (Ollama's current embeddings endpoint is
/// `/api/embed`, which always returns an array of arrays even for one input;
/// the legacy `/api/embeddings` returned a single `{ "embedding": […] }` and is
/// not used.)
fn parse_ollama_embeddings(json: &Value) -> Result<Vec<Vec<f32>>, String> {
    let embeddings = json
        .get("embeddings")
        .and_then(|e| e.as_array())
        .ok_or_else(|| "response missing embeddings".to_string())?;
    embeddings
        .iter()
        .map(|row| {
            let row = row
                .as_array()
                .ok_or_else(|| "response has a non-array embedding row".to_string())?;
            row.iter()
                .map(|n| {
                    n.as_f64()
                        .ok_or_else(|| "response has a non-numeric embedding value".to_string())
                        .map(|v| v as f32)
                })
                .collect()
        })
        .collect()
}

/// Embed a batch of texts via the provider's embeddings endpoint, returning one
/// vector per input text (same order). Registered as a Tauri command (callable
/// from JS by the drawer's "Test embeddings" button and 4.4's retrieval) AND
/// callable directly from Rust by 4.3's vector store
/// (`retrieval::embed_texts(...).await`) — the `#[tauri::command]` attribute
/// leaves the bare async fn callable, same as `llm_chat`.
///
/// Provider detection mirrors `llm_list_models`: try the OpenAI-compatible
/// `/v1/embeddings` first (also served by Ollama), and fall back to Ollama's
/// native `/api/embed` if that is non-2xx or fails to reach the server. For the
/// target user (Ollama) the first call succeeds, so there is no double-call;
/// the fallback only covers servers that lack the OpenAI path. The request body
/// `{ model, input: texts }` is identical for both — only the path and response
/// parser differ.
///
/// A 2xx from `/v1/embeddings` is taken as final: a malformed-but-2xx body
/// returns its parse error rather than silently retrying on the Ollama path
/// (the server *did* handle the request; a bad body is a real error, not "try
/// the other endpoint"). The Ollama fallback's error is the final error
/// surfaced — that last-resort path is the one the user most needs to see fail
/// clearly (e.g. the embeddings model isn't pulled).
#[tauri::command]
pub async fn embed_texts(
    endpoint: String,
    api_key: Option<String>,
    model: String,
    texts: Vec<String>,
) -> Result<Vec<Vec<f32>>, String> {
    let base = normalize_base(&endpoint);
    let headers = build_headers(&api_key)?;
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let body = embeddings_request_body(&model, &texts);

    // OpenAI-compatible path first. Record its status (if non-2xx) so the
    // fallback's error can report BOTH paths: a 401 on both means auth/access
    // is rejected; a 404 on /api/embed alone means the native endpoint isn't
    // served (some Cloud setups are /v1-only); a non-2xx on /v1/embeddings
    // with a 2xx fallback means the OpenAI embeddings shape just isn't there.
    let openai_url = format!("{}/v1/embeddings", base);
    let mut openai_status: Option<u16> = None;
    let result = client
        .post(&openai_url)
        .headers(headers.clone())
        .json(&body)
        .send()
        .await;
    if let Ok(response) = result {
        if response.status().is_success() {
            let json: Value = response
                .json()
                .await
                .map_err(|e| format!("bad response: {}", e))?;
            return parse_openai_embeddings(&json);
        }
        openai_status = Some(response.status().as_u16());
    }

    // Native Ollama fallback.
    let ollama_url = format!("{}/api/embed", base);
    let response = client
        .post(&ollama_url)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {}", e))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        // Name both paths so the failure is diagnosable from this string alone
        // — the request runs through Rust (reqwest), so the webview's network
        // panel never shows it and this error is the only signal.
        return Err(match openai_status {
            Some(openai) => format!(
                "embeddings failed — /v1/embeddings returned {} and /api/embed returned {}: {}",
                openai,
                status.as_u16(),
                text
            ),
            None => format!("endpoint returned {}: {}", status.as_u16(), text),
        });
    }
    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("bad response: {}", e))?;
    parse_ollama_embeddings(&json)
}

// --- Vector store + differential re-embed (Phase 4.3) ----------------------
//
// The third link in the RAG chain: KEEP the vectors 4.2 produced, tied back to
// the chunks they came from, and keep the store CURRENT as the manuscript
// changes — cheaply. The store lives in `AppState` (see `state.rs`):
// `vectors: Mutex<Vec<StoredChunk>>` is the flat store 4.4 scans, and
// `section_hashes: Mutex<HashMap<String, u64>>` is the differential baseline.
// This module owns the logic that mutates them; `reembed_document` is the
// Tauri command the frontend fires ~1.5s after each edit (when the index is
// enabled).
//
// **Section-level differential.** Rather than tracking which paragraphs changed
// (chunks don't record paragraph ids, and a mid-section insert shifts every
// following chunk's ordinal — see the plan), we hash each section's full
// paragraph text and re-embed only sections whose hash changed (plus drop
// deleted ones). A typical edit touches one section, so one section's few
// chunks are re-embedded in a single batched `embed_texts` call — not the whole
// manuscript.

/// One entry in the in-memory vector store: a chunk paired with the vector
/// `embed_texts` produced for its text. Stored flat in `AppState::vectors` for
/// 4.4's linear cosine scan. Not `Serialize` — 4.4 builds its own response from
/// the `Chunk` (which is `Serialize`); the raw vector never crosses to JS.
#[derive(Clone)]
pub struct StoredChunk {
    pub chunk: Chunk,
    // 4.3 writes vectors but does not yet read them — the first reader is 4.4's
    // `retrieve_passages`, which cosine-similarity-ranks the stored vectors
    // against the query vector. Allow dead code until that lands; removing this
    // early would re-warn the moment 4.3 merges.
    #[allow(dead_code)]
    pub vector: Vec<f32>,
}

/// The result of one `reembed_document` pass, surfaced to the frontend's
/// index-status readout. `built_from_scratch` is true when the store had no
/// baseline and every section was embedded (an open / toggle-on). `camelCase`
/// so the JS side reads `builtFromScratch` etc., matching `Chunk`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReembedReport {
    pub built_from_scratch: bool,
    pub sections_embedded: u32,
    pub chunks_embedded: u32,
    pub chunks_total: u32,
}

/// Which sections need work this pass, derived purely from the stored baseline
/// hashes vs the current document's section hashes. `to_embed` = sections whose
/// hash changed or are new (their chunks must be re-embedded); `to_drop` =
/// sections that no longer exist (their stored vectors are stale). `full` = the
/// store had no baseline, so `to_embed` is every current section and nothing is
/// dropped. Used only as a membership set by `reembed_pass` (chunk order comes
/// from `chunk_document`, not from here), so the `Vec` order is unspecified.
#[derive(Debug, PartialEq)]
struct ReembedPlan {
    full: bool,
    to_embed: Vec<String>,
    to_drop: Vec<String>,
}

/// Compute the differential plan from the stored baseline hashes vs the current
/// document's section hashes. Pure — no I/O, no state — so it is the
/// unit-testable core of the re-embed. See `ReembedPlan` for the meaning of each
/// field.
fn plan_reembed(stored: &HashMap<String, u64>, current: &HashMap<String, u64>) -> ReembedPlan {
    // No baseline → full build: embed every current section, drop nothing. The
    // store is empty on first enable / on opening a document.
    if stored.is_empty() {
        return ReembedPlan {
            full: true,
            to_embed: current.keys().cloned().collect(),
            to_drop: Vec::new(),
        };
    }
    // A section needs re-embedding if it is new (absent from `stored`) or its
    // hash differs. `stored.get(id) != Some(hash)` covers both: `get` returns
    // `None` for a new id, which is never `== Some(hash)`.
    let to_embed: Vec<String> = current
        .iter()
        .filter(|(id, hash)| stored.get(*id) != Some(*hash))
        .map(|(id, _)| id.clone())
        .collect();
    // A stored section that is gone from the current document is stale: drop its
    // vectors and its baseline hash entry.
    let to_drop: Vec<String> = stored
        .keys()
        .filter(|id| !current.contains_key(*id))
        .cloned()
        .collect();
    ReembedPlan {
        full: false,
        to_embed,
        to_drop,
    }
}

/// Hash a section's full paragraph text (paragraphs joined by `\n`) into a
/// `u64`. This is the differential signal: if a section's text is unchanged
/// between two passes, its hash matches and its stored vectors are kept
/// untouched. `DefaultHasher` (SipHash) is deterministic within a process —
/// enough, because the baseline lives in memory for the session and is never
/// persisted (persistence is deferred to after 2.1's schema versioning). Uses
/// `paragraph_text` (the same run concatenation `chunk_document` uses), so a
/// section hashes the same prose that gets chunked + embedded — a hash match
/// guarantees the vectors are still valid for that section's text.
fn section_text_hash(section: &Section) -> u64 {
    let mut text = String::new();
    for (i, paragraph) in section.paragraphs.iter().enumerate() {
        if i > 0 {
            text.push('\n');
        }
        text.push_str(&paragraph_text(paragraph));
    }
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

/// One differential pass: read the current document, plan against the baseline,
/// embed only the changed sections' chunks, and apply on success. Not a Tauri
/// command — the testable async core that `reembed_document` (the command)
/// delegates to and re-loops. Taking `&AppState` (not `State`) keeps it callable
/// from a plain `AppState` in tests via `tauri::async_runtime::block_on`.
async fn reembed_pass(
    endpoint: &str,
    api_key: Option<&str>,
    model: &str,
    state: &AppState,
) -> Result<ReembedReport, String> {
    // Snapshot the current document out of its Mutex so the embed (an async HTTP
    // call) does not hold the document lock across I/O — other commands
    // (sync_document, undo, etc.) could be waiting on it.
    let doc = state
        .document
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    // Current section hashes, straight from the live document. Order doesn't
    // matter here — `plan_reembed` treats these as a lookup, and chunk order
    // comes from `chunk_document` below.
    let current_hashes: HashMap<String, u64> = doc
        .sections
        .iter()
        .map(|section| (section.id.clone(), section_text_hash(section)))
        .collect();

    let stored = state
        .section_hashes
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let plan = plan_reembed(&stored, &current_hashes);
    let built_from_scratch = plan.full;

    // Gather the chunks to embed: all of them for a full build, otherwise only
    // those whose section is in the plan's embed set. `chunk_document` preserves
    // manuscript order, so the gathered texts are in order → `embed_texts`
    // returns vectors in the same order → the zip below pairs each vector with
    // the right chunk.
    let embed_set: HashSet<String> = plan.to_embed.iter().cloned().collect();
    let chunks_to_embed: Vec<Chunk> = chunk_document(&doc)
        .into_iter()
        .filter(|chunk| plan.full || embed_set.contains(&chunk.section_id))
        .collect();
    let texts: Vec<String> = chunks_to_embed.iter().map(|c| c.text.clone()).collect();

    let sections_embedded = if plan.full {
        current_hashes.len() as u32
    } else {
        embed_set.len() as u32
    };

    // Embed the gathered texts in one batched call. If there is nothing to embed
    // (empty document, or no changes this pass) we still apply drops below so
    // deleted sections' vectors are removed.
    let mut new_stored: Vec<StoredChunk> = Vec::new();
    if !texts.is_empty() {
        let vectors = embed_texts(
            endpoint.to_string(),
            api_key.map(|key| key.to_string()),
            model.to_string(),
            texts,
        )
        .await?;
        // The provider must return exactly one vector per input text. A mismatch
        // would silently misalign vectors and chunks, so surface it as an error
        // rather than guessing — and do NOT mutate the store (the failed
        // sections keep their old vectors and retry next time).
        if vectors.len() != chunks_to_embed.len() {
            return Err(format!(
                "embeddings returned {} vectors for {} chunks",
                vectors.len(),
                chunks_to_embed.len()
            ));
        }
        new_stored = chunks_to_embed
            .into_iter()
            .zip(vectors)
            .map(|(chunk, vector)| StoredChunk { chunk, vector })
            .collect();
    }
    let chunks_embedded = new_stored.len() as u32;

    // Apply on success, in one critical section so a 4.4 retrieval reader never
    // sees a half-applied store. Remove stale vectors for changed + deleted
    // sections, push the new ones, and advance the baseline hashes for the
    // changed sections / drop the deleted ones. On a full build `to_embed` is
    // every current section and `to_drop` is empty, so this also rebuilds the
    // baseline from scratch.
    let chunks_total = {
        let drop_set: HashSet<&str> = plan
            .to_embed
            .iter()
            .map(|id| id.as_str())
            .chain(plan.to_drop.iter().map(|id| id.as_str()))
            .collect();
        let mut vectors_lock = state.vectors.lock().map_err(|e| e.to_string())?;
        let mut hashes_lock = state.section_hashes.lock().map_err(|e| e.to_string())?;
        vectors_lock.retain(|stored| !drop_set.contains(stored.chunk.section_id.as_str()));
        vectors_lock.extend(new_stored);
        for id in &plan.to_embed {
            if let Some(hash) = current_hashes.get(id) {
                hashes_lock.insert(id.clone(), *hash);
            }
        }
        for id in &plan.to_drop {
            hashes_lock.remove(id);
        }
        vectors_lock.len() as u32
    };

    Ok(ReembedReport {
        built_from_scratch,
        sections_embedded,
        chunks_embedded,
        chunks_total,
    })
}

/// Rebuild / refresh the in-memory vector store against the current document.
///
/// Triggered from JS (which holds the embeddings endpoint/key/model) ~1.5s after
/// each edit, and on toggle-on. Reads the already-current `state.document`
/// (synced by `sync_document` for typing, or installed by `open_document` /
/// `undo` / `redo` / `restore_version` for the other paths) — it does NOT take a
/// document argument. The embeddings triple is passed per call and never stored
/// in `AppState`, matching the chat/embed convention (keeps the key out of the
/// webview's inspectable fetch headers — the proxy's reason for existing).
///
/// **Concurrency.** `embed_texts` is async (an HTTP round-trip). If a second
/// trigger arrives while one is in flight, it is dropped and `repending` is set;
/// the in-flight pass re-loops and re-reads the (possibly newer) document, so
/// the last trigger always wins — no lost updates, and never two concurrent
/// embeds. On embed failure the store is left untouched for the failed sections
/// (their old vectors stay, their hashes are not advanced) so they retry next
/// time; `reembedding` is always reset before returning, success or error.
#[tauri::command]
pub async fn reembed_document(
    endpoint: String,
    api_key: Option<String>,
    model: String,
    state: State<'_, AppState>,
) -> Result<ReembedReport, String> {
    // Guard: claim the re-embed slot. `swap` returns the OLD value; if it was
    // already true, another pass is in flight — mark pending and return a
    // skipped report. AcqRel pairs the claim with the loop's reads. The skipped
    // report carries the current `chunks_total` so the status readout doesn't
    // blank out while a re-embed is pending.
    if state.reembedding.swap(true, Ordering::AcqRel) {
        state.repending.store(true, Ordering::Release);
        let chunks_total = state.vectors.lock().map_err(|e| e.to_string())?.len() as u32;
        return Ok(ReembedReport {
            built_from_scratch: false,
            sections_embedded: 0,
            chunks_embedded: 0,
            chunks_total,
        });
    }

    // Run passes until no trigger arrived during the last one. Each pass
    // re-reads the current document, so this converges to the latest state. We
    // handle errors inline (rather than `?`) so `reembedding` is ALWAYS reset
    // before returning — an early `?` would leave it stuck `true` and deadlock
    // every future re-embed.
    let mut report = match reembed_pass(&endpoint, api_key.as_deref(), &model, &state).await {
        Ok(report) => report,
        Err(error) => {
            state.repending.store(false, Ordering::Release);
            state.reembedding.store(false, Ordering::Release);
            return Err(error);
        }
    };
    while state.repending.swap(false, Ordering::AcqRel) {
        match reembed_pass(&endpoint, api_key.as_deref(), &model, &state).await {
            Ok(next) => report = next,
            Err(error) => {
                state.repending.store(false, Ordering::Release);
                state.reembedding.store(false, Ordering::Release);
                return Err(error);
            }
        }
    }

    state.reembedding.store(false, Ordering::Release);
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Element, Section, TextRun, TextStyle};
    use crate::state::AppState;

    // --- test fixtures (mirror diff.rs:240-274) -----------------------------

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

    fn create_section(id: &str, title: &str, section_type: SectionType, paras: Vec<Paragraph>) -> Section {
        Section {
            id: id.to_string(),
            title: title.to_string(),
            section_type,
            paragraphs: paras,
        }
    }

    fn create_document(sections: Vec<Section>) -> Document {
        Document {
            title: "T".to_string(),
            author: "A".to_string(),
            author_contact: "C".to_string(),
            has_toc: false,
            has_epigram: false,
            epigram_text: String::new(),
            sections,
        }
    }

    // A paragraph holding `count` words of filler ("w1 w2 w3 …"). Cheaper than
    // typing 256 words by hand for the merge/split tests.
    fn paragraph_with_words(id: &str, count: u32) -> Paragraph {
        let text: String = (1..=count)
            .map(|n| format!("w{n}"))
            .collect::<Vec<_>>()
            .join(" ");
        create_paragraph(id, &text)
    }

    // --- tests --------------------------------------------------------------

    #[test]
    fn empty_document_yields_no_chunks() {
        assert!(chunk_document(&create_document(vec![])).is_empty());
    }

    #[test]
    fn section_with_only_empty_paragraphs_yields_no_chunks() {
        let doc = create_document(vec![create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![create_paragraph("p1", ""), create_paragraph("p2", "   ")],
        )]);
        assert!(chunk_document(&doc).is_empty());
    }

    #[test]
    fn single_short_paragraph_becomes_one_chunk() {
        let doc = create_document(vec![create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![create_paragraph("p1", "The door opened.")],
        )]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].id, "s1:0");
        assert_eq!(chunks[0].section_id, "s1");
        assert_eq!(chunks[0].text, "The door opened.");
    }

    #[test]
    fn short_paragraphs_under_target_merge_into_one_chunk() {
        // 50 + 50 = 100 words, well under the 256 target → one chunk.
        let doc = create_document(vec![create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![
                paragraph_with_words("p1", 50),
                paragraph_with_words("p2", 50),
            ],
        )]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].id, "s1:0");
        // The two paragraphs are joined by a newline inside the chunk.
        assert_eq!(chunks[0].text.matches('\n').count(), 1);
    }

    #[test]
    fn paragraphs_split_when_adding_the_next_would_exceed_target() {
        // 200 + 200 = 400 > 256, and 200 alone < 256, so the second paragraph
        // tips the first over → two chunks (each 200 words, under target).
        let doc = create_document(vec![create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![
                paragraph_with_words("p1", 200),
                paragraph_with_words("p2", 200),
            ],
        )]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].id, "s1:0");
        assert_eq!(chunks[1].id, "s1:1");
        // Each chunk holds exactly one paragraph (no newline join).
        assert!(!chunks[0].text.contains('\n'));
        assert!(!chunks[1].text.contains('\n'));
    }

    #[test]
    fn a_single_over_target_paragraph_becomes_one_chunk() {
        // One 300-word paragraph (> 256). With an empty buffer the flush guard
        // (buffer_words > 0) is false, so it is NOT split and becomes a single
        // over-target chunk. We never split mid-paragraph.
        let doc = create_document(vec![create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![paragraph_with_words("p1", 300)],
        )]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].id, "s1:0");
        // 300 words → 300 whitespace-separated tokens.
        assert_eq!(count_words(&chunks[0].text), 300);
    }

    #[test]
    fn over_target_paragraph_then_short_one_makes_two_chunks() {
        // 300 (over target) then 10. The 300 becomes its own chunk; the 10
        // starts a fresh chunk (the flush before appending fires because
        // buffer_words=300 > 0 and 300+10 > 256).
        let doc = create_document(vec![create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![paragraph_with_words("p1", 300), paragraph_with_words("p2", 10)],
        )]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 2);
        assert_eq!(count_words(&chunks[0].text), 300);
        assert_eq!(count_words(&chunks[1].text), 10);
        assert_eq!(chunks[1].id, "s1:1");
    }

    #[test]
    fn chapter_index_advances_only_on_chapters_not_sections() {
        // Chapter 1, then a Section (sandwiched), then Chapter 2. The Section
        // does NOT advance the counter, so its chunks inherit Chapter 1's
        // index. Mirrors export_text's chapter_number_increments_across_chapters_only.
        let doc = create_document(vec![
            create_section("c1", "One", SectionType::Chapter, vec![create_paragraph("p1", "a b c")]),
            create_section("s1", "Notes", SectionType::Section, vec![create_paragraph("p2", "d e f")]),
            create_section("c2", "Two", SectionType::Chapter, vec![create_paragraph("p3", "g h i")]),
        ]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].chapter_index, Some(1)); // Chapter 1
        assert_eq!(chunks[1].chapter_index, Some(1)); // Section → nearest preceding
        assert_eq!(chunks[2].chapter_index, Some(2)); // Chapter 2
    }

    #[test]
    fn front_matter_before_any_chapter_has_no_chapter_index() {
        let doc = create_document(vec![
            create_section("front", "Epigraph", SectionType::Section, vec![create_paragraph("p1", "a b")]),
            create_section("c1", "One", SectionType::Chapter, vec![create_paragraph("p2", "c d")]),
        ]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks[0].chapter_index, None); // before any Chapter
        assert_eq!(chunks[1].chapter_index, Some(1));
    }

    #[test]
    fn empty_paragraphs_between_content_are_skipped() {
        // A blank paragraph between two short ones does not break the merge and
        // does not itself produce a chunk.
        let doc = create_document(vec![create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![
                paragraph_with_words("p1", 10),
                create_paragraph("p2", "   "),
                paragraph_with_words("p3", 10),
            ],
        )]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 1); // p1 + p3 merged; p2 skipped
        // The chunk holds p1 and p3 (one newline join); the blank is absent.
        assert_eq!(chunks[0].text.matches('\n').count(), 1);
    }

    #[test]
    fn chunks_never_span_sections() {
        // Two one-paragraph sections → two chunks with distinct section_ids,
        // even though each is tiny (no cross-section merging).
        let doc = create_document(vec![
            create_section("a", "A", SectionType::Section, vec![create_paragraph("p1", "one")]),
            create_section("b", "B", SectionType::Section, vec![create_paragraph("p2", "two")]),
        ]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].section_id, "a");
        assert_eq!(chunks[1].section_id, "b");
        assert_eq!(chunks[0].text, "one");
        assert_eq!(chunks[1].text, "two");
    }

    #[test]
    fn chunk_ids_are_section_scoped_ordinals() {
        // Three short paragraphs that exceed the target in total split into
        // multiple chunks; ids are s1:0, s1:1, … within the section.
        let doc = create_document(vec![create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![
                paragraph_with_words("p1", 200),
                paragraph_with_words("p2", 200),
                paragraph_with_words("p3", 200),
            ],
        )]);
        let chunks = chunk_document(&doc);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].id, "s1:0");
        assert_eq!(chunks[1].id, "s1:1");
        assert_eq!(chunks[2].id, "s1:2");
    }

    // --- Embedding request / response (Phase 4.2) --------------------------
    //
    // The pure helpers are tested with hand-built JSON (via `from_str` rather
    // than the `json!` macro to avoid any macro-rescope ambiguity in the test
    // module). Integers in the JSON convert to exact f32 values, so the happy
    // paths compare with `==` without float-epsilon fuss.

    fn json_value(literal: &str) -> Value {
        serde_json::from_str(literal).expect("test JSON must parse")
    }

    #[test]
    fn embeddings_request_body_builds_model_and_input_array() {
        let texts = vec!["one".to_string(), "two".to_string()];
        let body = embeddings_request_body("nomic-embed-text", &texts);
        assert_eq!(body["model"], "nomic-embed-text");
        // `input` is always an array, in the same order as the inputs.
        let input = body["input"].as_array().expect("input must be an array");
        assert_eq!(input.len(), 2);
        assert_eq!(input[0], "one");
        assert_eq!(input[1], "two");
    }

    #[test]
    fn embeddings_request_body_emits_an_array_even_for_one_text() {
        // A single text still becomes `input: [text]` so the return shape
        // (one vector per input) is uniform for callers.
        let body = embeddings_request_body("m", &vec!["solo".to_string()]);
        assert_eq!(body["input"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn parse_openai_embeddings_happy_path() {
        let json = json_value(r#"{"data":[{"embedding":[1,2]},{"embedding":[3]}]}"#);
        assert_eq!(
            parse_openai_embeddings(&json),
            Ok(vec![vec![1.0, 2.0], vec![3.0]])
        );
    }

    #[test]
    fn parse_openai_embeddings_errors_when_data_is_missing() {
        let json = json_value(r#"{"not_data": []}"#);
        assert_eq!(
            parse_openai_embeddings(&json).unwrap_err(),
            "response missing data"
        );
    }

    #[test]
    fn parse_openai_embeddings_errors_when_an_embedding_is_missing() {
        let json = json_value(r#"{"data":[{"not_embedding":[1]}]}"#);
        assert_eq!(
            parse_openai_embeddings(&json).unwrap_err(),
            "response missing data[*].embedding"
        );
    }

    #[test]
    fn parse_ollama_embeddings_happy_path() {
        // `/api/embed` returns `{ "embeddings": [[…], …] }` (always an array of
        // arrays, even for one input).
        let json = json_value(r#"{"embeddings":[[1,2],[3]]}"#);
        assert_eq!(
            parse_ollama_embeddings(&json),
            Ok(vec![vec![1.0, 2.0], vec![3.0]])
        );
    }

    #[test]
    fn parse_ollama_embeddings_errors_when_embeddings_is_missing() {
        let json = json_value(r#"{"not_embeddings": []}"#);
        assert_eq!(
            parse_ollama_embeddings(&json).unwrap_err(),
            "response missing embeddings"
        );
    }

    #[test]
    fn parse_ollama_embeddings_errors_when_a_row_is_not_an_array() {
        let json = json_value(r#"{"embeddings":[[1,2],42]}"#);
        assert_eq!(
            parse_ollama_embeddings(&json).unwrap_err(),
            "response has a non-array embedding row"
        );
    }

    // Live round-trip against a real Ollama. Ignored by default (needs a
    // running server + a pulled embeddings model); run with
    // `cargo test embed -- --ignored`. Driven through `tauri::async_runtime`
    // (Tauri's bundled tokio runtime) rather than a `tokio` dev-dep — no other
    // test in the crate is async, so this avoids adding one just for one live
    // check.
    #[test]
    #[ignore]
    fn embed_texts_live_against_ollama() {
        let vectors = tauri::async_runtime::block_on(embed_texts(
            "http://localhost:11434".to_string(),
            None,
            "nomic-embed-text".to_string(),
            vec!["The door opened onto a quiet street.".to_string()],
        ))
        .expect("live embed should succeed with the model pulled");
        assert_eq!(vectors.len(), 1, "one input → one vector");
        assert!(!vectors[0].is_empty(), "the embedding must be non-empty");
    }

    // --- Differential re-embed planning (Phase 4.3) -------------------------
    //
    // `plan_reembed` is pure — no I/O, no state — so the differential logic is
    // tested with hand-built hash maps. Helper keeps the section ids short.

    fn hashes(ids_and_hashes: &[(&str, u64)]) -> HashMap<String, u64> {
        ids_and_hashes
            .iter()
            .map(|(id, hash)| (id.to_string(), *hash))
            .collect()
    }

    #[test]
    fn plan_reembed_full_build_when_store_is_empty() {
        // No baseline → every current section is embedded, nothing dropped.
        let current = hashes(&[("s1", 10), ("s2", 20)]);
        let plan = plan_reembed(&HashMap::new(), &current);
        assert!(plan.full);
        assert_eq!(plan.to_drop, Vec::<String>::new());
        // Order of to_embed is unspecified (HashMap keys); compare as a set.
        let mut got: Vec<&str> = plan.to_embed.iter().map(|s| s.as_str()).collect();
        got.sort_unstable();
        assert_eq!(got, vec!["s1", "s2"]);
    }

    #[test]
    fn plan_reembed_nothing_when_hashes_match() {
        // Identical baseline + current → no embeds, no drops.
        let stored = hashes(&[("s1", 10), ("s2", 20)]);
        let current = hashes(&[("s1", 10), ("s2", 20)]);
        let plan = plan_reembed(&stored, &current);
        assert!(!plan.full);
        assert!(plan.to_embed.is_empty());
        assert!(plan.to_drop.is_empty());
    }

    #[test]
    fn plan_reembed_flags_a_changed_section_as_to_embed() {
        // s2's hash changed → it is re-embedded; s1 (unchanged) is left alone.
        let stored = hashes(&[("s1", 10), ("s2", 20)]);
        let current = hashes(&[("s1", 10), ("s2", 99)]);
        let plan = plan_reembed(&stored, &current);
        assert!(!plan.full);
        assert_eq!(plan.to_embed, vec!["s2"]);
        assert!(plan.to_drop.is_empty());
    }

    #[test]
    fn plan_reembed_flags_a_new_section_as_to_embed() {
        // s3 is new (absent from stored) → it is embedded. `stored.get` returns
        // None, which is never == Some(hash), so the new-section case is the same
        // branch as a changed hash.
        let stored = hashes(&[("s1", 10)]);
        let current = hashes(&[("s1", 10), ("s3", 30)]);
        let plan = plan_reembed(&stored, &current);
        assert_eq!(plan.to_embed, vec!["s3"]);
        assert!(plan.to_drop.is_empty());
    }

    #[test]
    fn plan_reembed_flags_a_deleted_section_as_to_drop() {
        // s2 is gone from the current document → drop its vectors + baseline.
        let stored = hashes(&[("s1", 10), ("s2", 20)]);
        let current = hashes(&[("s1", 10)]);
        let plan = plan_reembed(&stored, &current);
        assert_eq!(plan.to_drop, vec!["s2"]);
        assert!(plan.to_embed.is_empty());
    }

    #[test]
    fn plan_reembed_handles_change_and_delete_together() {
        // s1 changed, s2 deleted, s3 new — all three flagged correctly in one
        // pass.
        let stored = hashes(&[("s1", 10), ("s2", 20)]);
        let current = hashes(&[("s1", 11), ("s3", 30)]);
        let plan = plan_reembed(&stored, &current);
        assert_eq!(plan.to_embed, vec!["s1", "s3"]);
        assert_eq!(plan.to_drop, vec!["s2"]);
    }

    // --- Section hashing (Phase 4.3) ---------------------------------------

    #[test]
    fn section_text_hash_is_stable_for_identical_text() {
        let section = create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![create_paragraph("p1", "The door opened."), create_paragraph("p2", "Cold air.")],
        );
        // Same text → same hash, twice. Determinism within a process is all the
        // baseline needs (it lives in memory for the session).
        let h1 = section_text_hash(&section);
        let h2 = section_text_hash(&section);
        assert_eq!(h1, h2);
    }

    #[test]
    fn section_text_hash_differs_when_text_changes() {
        let before = create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![create_paragraph("p1", "The door opened.")],
        );
        let after = create_section(
            "s1",
            "Intro",
            SectionType::Section,
            vec![create_paragraph("p1", "The door slammed.")],
        );
        assert_ne!(section_text_hash(&before), section_text_hash(&after));
    }

    #[test]
    fn section_text_hash_ignores_the_section_title() {
        // The hash is over paragraph TEXT only, not the title — renaming a
        // section does NOT re-embed it (its passages are unchanged). Two sections
        // with identical paragraphs but different titles hash the same.
        let a = create_section("s1", "Original", SectionType::Section, vec![create_paragraph("p1", "same body")]);
        let b = create_section("s1", "Renamed", SectionType::Section, vec![create_paragraph("p1", "same body")]);
        assert_eq!(section_text_hash(&a), section_text_hash(&b));
    }

    // Live differential round-trip against a real Ollama. Ignored by default
    // (needs a running server + `nomic-embed-text` pulled); run with
    // `cargo test reembed -- --ignored`. Drives `reembed_pass` directly through
    // `tauri::async_runtime` so it can build an `AppState` by hand rather than a
    // Tauri `State` wrapper.
    #[test]
    #[ignore]
    fn reembed_pass_live_differential_against_ollama() {
        let state = AppState::new();
        // First doc: two one-paragraph sections.
        let doc = create_document(vec![
            create_section("s1", "One", SectionType::Section, vec![create_paragraph("p1", "The door opened onto a quiet street.")]),
            create_section("s2", "Two", SectionType::Section, vec![create_paragraph("p2", "Rain fell in silver lines.")]),
        ]);
        *state.document.lock().unwrap() = doc;

        let endpoint = "http://localhost:11434";
        let model = "nomic-embed-text";

        // First pass: full build from an empty store.
        let report = tauri::async_runtime::block_on(reembed_pass(endpoint, None, model, &state))
            .expect("first embed should succeed with the model pulled");
        assert!(report.built_from_scratch, "empty store → full build");
        assert!(report.chunks_total > 0, "vectors should be stored");
        let initial_total = report.chunks_total;
        assert_eq!(
            state.section_hashes.lock().unwrap().len(),
            2,
            "baseline records both sections"
        );

        // Mutate one section's text; leave the other untouched.
        let mut doc2 = create_document(vec![
            create_section("s1", "One", SectionType::Section, vec![create_paragraph("p1", "The door slammed shut behind her.")]),
            create_section("s2", "Two", SectionType::Section, vec![create_paragraph("p2", "Rain fell in silver lines.")]),
        ]);
        *state.document.lock().unwrap() = doc2.clone();

        let report2 = tauri::async_runtime::block_on(reembed_pass(endpoint, None, model, &state))
            .expect("second embed should succeed");
        assert!(!report2.built_from_scratch, "store had a baseline → not a full build");
        assert_eq!(report2.sections_embedded, 1, "only the changed section re-embedded");
        assert_eq!(report2.chunks_total, initial_total, "same section count → same chunk total");
        // The unchanged section's baseline hash is unchanged; the changed one advanced.
        let hashes = state.section_hashes.lock().unwrap();
        assert_eq!(hashes.len(), 2);

        // Delete a section: s2 gone → its vectors dropped, baseline shrinks.
        doc2.sections.retain(|s| s.id != "s2");
        *state.document.lock().unwrap() = doc2;
        let report3 = tauri::async_runtime::block_on(reembed_pass(endpoint, None, model, &state))
            .expect("third embed should succeed");
        assert_eq!(report3.chunks_total, initial_total - 1, "deleted section's chunk dropped");
        assert_eq!(state.section_hashes.lock().unwrap().len(), 1, "baseline shrunk to one section");
    }
}