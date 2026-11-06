//! Semantic-summary layer for the analytical assistant (Phase 4.8).
//!
//! 4.6's "Structure" Feedback Target gives a compact *shape* (per-chapter
//! counts); 4.4's "Relevant passages" gives localized *evidence*. Neither gives
//! a compact *semantic* grasp of the whole book — on a novel too big to send
//! verbatim ("Whole document" truncates against the context window), the
//! assistant can't reason about the overall arc. This module adds the fourth
//! Feedback Target, **"Summaries"**: LLM-generated per-section summaries (a
//! 2–3 sentence neutral recap per Section), stored durably in 4.7's sidecar and
//! injected as context on demand.
//!
//! **Reading them is FREE** (`retrieve_summaries`: a pure-Rust read from
//! `AppState.summaries`, no network — mirrors `structural_signals`).
//! **Generating them costs tokens**: one LLM call per section, user-triggered
//! (`summarize_and_store_section`). The assistant stays strictly analytical —
//! summaries are metadata in the sidecar, NEVER inserted into the document.
//!
//! ### Staleness — a SEPARATE baseline from the vector store
//!
//! `SectionSummary` carries its own `section_hash` (from
//! `retrieval::section_text_hash`, the same prose hash the vector store uses).
//! It is INDEPENDENT of the vector store's `AppState::section_hashes` map:
//! re-embed debounces on every edit (~1.5s), re-summarize is user-triggered, so
//! the two baselines drift. A summary is `stale` when its `section_hash` no
//! longer matches the live section's hash; "Refresh stale" re-summarizes only
//! those (`plan_resummarize`).
//!
//! ### One-shot, non-streaming generation
//!
//! `summarize_and_store_section` calls `llm::llm_chat` (the one-shot
//! `stream: false` path), NOT `llm_chat_stream`. Tauri's `llm-token` event
//! broadcasts to EVERY listener with no stream id, so a concurrent summary
//! generation and a chat stream would cross-talk (each listener would append
//! every incoming token). The non-streaming path emits no events, so summary
//! generation can run without interfering with chat — and returns the full text
//! in one `Result`, which is all a summary needs (no progressive UI).

use crate::document::{Document, Paragraph, Section, SectionType};
use crate::llm::{compose_role_body, ChatMessage, ChatRequest};
use crate::retrieval::section_text_hash;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, State};

/// A per-section neutral recap, generated once by the model and stored in the
/// durable sidecar (4.7) keyed by `section_id`. `section_hash` is the summary's
/// OWN staleness baseline — `retrieve_summaries` compares it against the live
/// section's current `section_text_hash` to flag `stale`. `camelCase` on the
/// wire to match `Chunk`/`StoredChunk`/the sidecar's other shapes.
/// `Serialize`/`Deserialize` so it round-trips through the sidecar;
/// `Clone`/`Debug`/`PartialEq` for in-memory use + tests.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SectionSummary {
    pub section_id: String,
    pub section_hash: u64,
    pub summary: String,
}

/// One row of `retrieve_summaries`'s response: a stored summary paired with the
/// section's render context (chapter index, title, type) so the JS side can
/// format `Chapter N: title — {summary}` without re-walking the document. The
/// `chapter_index` follows the same render-derived numbering rule as
/// `chunk_document` / `compute_structural_signals` (1-based, advancing only on
/// `SectionType::Chapter`; `None` for front matter before any Chapter). `stale`
/// is true when the section's text changed since the summary was generated.
/// `sectionType` serializes as `"chapter"` / `"section"` (the enum's
/// `rename_all = "camelCase"`), matching how the frontend already spells it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SummaryEntry {
    pub section_id: String,
    pub chapter_index: Option<u32>,
    pub title: String,
    pub section_type: SectionType,
    pub summary: String,
    pub stale: bool,
}

/// The FIXED persona for summary generation. Summaries are NEUTRAL recaps — they
/// must NOT inherit the user's selected chat role (a Critic-flavored or
/// Poet-flavored summary would smuggle interpretation into what's meant to be a
/// faithful recap). `compose_role_body` prepends the shared `_base.md`
/// analytical-only base, so "never writes into the doc" is structural here too.
const SUMMARY_PERSONA: &str = "You are a manuscript section summarizer. Your job is to produce a faithful, neutral recap of the section's content — the key events, characters present, and any notable shifts. Do not interpret, critique, judge quality, or suggest changes. Report only what is on the page.";

/// The prompt suffix instructing the model on the recap shape. Kept separate
/// from `SUMMARY_PERSONA` so the persona (who the model is) and the task (what
/// to produce) read independently, mirroring how a role's persona body and a
/// preset's prompt are separate concerns in the chat path.
const SUMMARY_TASK: &str = "Summarize this section in 2–3 sentences, capturing key events, characters, and shifts. Do not add interpretation beyond what is present in the text.";

/// Concatenate a paragraph's text runs into a plain string — no HTML, no
/// styling. The same one-liner `retrieval.rs` / `structure.rs` / every export
/// module inline; per the codebase convention it isn't worth cross-module
/// coupling to share, so it is re-implemented here.
fn paragraph_text(paragraph: &Paragraph) -> String {
    paragraph
        .elements
        .iter()
        .map(|element| element.text_run.content.as_str())
        .collect()
}

/// Concatenate a section's paragraph text (paragraphs joined by `\n`) — the
/// same prose `section_text_hash` hashes and `chunk_document` chunks, so the
/// model summarizes exactly the text whose hash is the staleness baseline.
fn section_text(section: &Section) -> String {
    let mut text = String::new();
    for (i, paragraph) in section.paragraphs.iter().enumerate() {
        if i > 0 {
            text.push('\n');
        }
        text.push_str(&paragraph_text(paragraph));
    }
    text
}

/// Build the `ChatRequest` for one section's summary. Pure — no I/O, no state —
/// so it is the unit-testable core of `summarize_and_store_section`. The system
/// message is the FIXED summary persona (`compose_role_body` prepends the
/// `_base.md` analytical-only base); the user message is the task instruction
/// plus a `Chapter:` / `Section:` header (the title, for context) and the
/// section's prose. Provider fields (`endpoint` / `model` / `api_key`) are left
/// empty here — the command fills them per call (the key is never held in
/// `AppState`, matching the chat/embed boundary). A low `temperature` (0.3)
/// keeps the recap faithful rather than creative.
pub fn build_summary_request(
    section_text: &str,
    section_title: &str,
    section_type: SectionType,
) -> ChatRequest {
    let system = compose_role_body(SUMMARY_PERSONA);
    let kind_label = match section_type {
        SectionType::Chapter => "Chapter",
        SectionType::Section => "Section",
    };
    let header = if section_title.trim().is_empty() {
        format!("{} (untitled)", kind_label)
    } else {
        format!("{}: {}", kind_label, section_title)
    };
    let user = format!("{}\n\n{}\n\n{}", SUMMARY_TASK, header, section_text);
    ChatRequest {
        endpoint: String::new(),
        model: String::new(),
        api_key: None,
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: system,
            },
            ChatMessage {
                role: "user".to_string(),
                content: user,
            },
        ],
        temperature: Some(0.3),
    }
}

/// Which sections need re-summarizing, derived purely from the stored summary
/// hashes vs the current document's section hashes. Returns the `section_id`s
/// whose hash changed OR is new (absent from `stored`) — the same membership
/// logic as `retrieval::plan_reembed`'s `to_embed`, but without a `to_drop`
/// (a deleted section's summary is simply orphaned in the store; it is not
/// re-summarized and `retrieve_summaries` skips it because the section no longer
/// exists in the document). Pure so it is unit-tested like `plan_reembed`. The
/// `Vec` order is unspecified (HashMap keys), like `plan_reembed`'s `to_embed`.
pub fn plan_resummarize(
    stored: &HashMap<String, u64>,
    current: &HashMap<String, u64>,
) -> Vec<String> {
    current
        .iter()
        .filter(|(id, hash)| stored.get(*id) != Some(*hash))
        .map(|(id, _)| id.clone())
        .collect()
}

/// Build the manuscript-ordered summary entries for `retrieve_summaries`. Pure
/// — the unit-testable core: walks `doc.sections` with the running
/// `chapter_index` (advancing only on `SectionType::Chapter`, the shared
/// render-derived numbering rule), and for each section that HAS a stored
/// summary emits a `SummaryEntry` with its render context + a `stale` flag
/// (`summary.section_hash != section_text_hash(section)`). Sections without a
/// stored summary are skipped (the response lists only summarized sections, in
/// manuscript order). A section whose id is in `summaries` but no longer in the
/// document is dropped (orphaned summary — the section was deleted).
fn build_summary_entries(
    doc: &Document,
    summaries: &HashMap<String, SectionSummary>,
) -> Vec<SummaryEntry> {
    let mut entries = Vec::new();
    let mut chapter_index: Option<u32> = None;
    for section in &doc.sections {
        if section.section_type == SectionType::Chapter {
            chapter_index = Some(chapter_index.unwrap_or(0) + 1);
        }
        let Some(summary) = summaries.get(&section.id) else {
            continue;
        };
        let stale = summary.section_hash != section_text_hash(section);
        entries.push(SummaryEntry {
            section_id: section.id.clone(),
            chapter_index,
            title: section.title.clone(),
            section_type: section.section_type,
            summary: summary.summary.clone(),
            stale,
        });
    }
    entries
}

/// Generate a summary for one section, store it in `AppState.summaries`, and
/// persist the sidecar. User-triggered (one call per section from the JS
/// `useSummaries.generateSummaries` loop). Reads the section from
/// `state.document` under a brief lock, computes its current
/// `section_text_hash` + prose, builds the fixed-persona request, and makes a
/// ONE-SHOT `llm_chat` call (non-streaming → no `llm-token` event → no
/// cross-talk with a concurrent chat stream). On success it stores
/// `SectionSummary { section_id, section_hash, summary }` into `state.summaries`
/// and checkpoints the sidecar (best-effort — a sidecar write failure must not
/// fail the summary, which is also in memory; the next save re-checkpoints).
/// Returns the `SectionSummary` so JS can update progress per section.
///
/// On LLM failure the OLD summary is left untouched (the section keeps its
/// stale recap; a retry re-attempts) and the error is surfaced — graceful, like
/// `reembed_pass` leaving failed sections' vectors alone. The endpoint/key/model
/// are passed per call and never stored in `AppState` (the key stays out of the
/// webview's inspectable fetch headers — the proxy's reason for existing).
#[tauri::command]
pub async fn summarize_and_store_section(
    section_id: String,
    endpoint: String,
    api_key: Option<String>,
    model: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<SectionSummary, String> {
    // Snapshot the section under a brief lock so the async HTTP call does not
    // hold the document lock across I/O.
    let (section_hash, section_text, section_title, section_type) = {
        let doc = state.document.lock().map_err(|e| e.to_string())?.clone();
        let section = doc
            .sections
            .iter()
            .find(|s| s.id == section_id)
            .ok_or_else(|| format!("section {} not found", section_id))?;
        (
            section_text_hash(section),
            section_text(section),
            section.title.clone(),
            section.section_type,
        )
    };

    // Build the fixed-persona request, then fill the provider fields per call.
    let mut request = build_summary_request(&section_text, &section_title, section_type);
    request.endpoint = endpoint;
    request.api_key = api_key;
    request.model = model;

    // One-shot, non-streaming — no llm-token event, so no cross-talk with chat.
    let summary = crate::llm::llm_chat(request).await?;

    let summary = SectionSummary {
        section_id: section_id.clone(),
        section_hash,
        summary,
    };

    // Store into the in-memory map, then checkpoint the sidecar best-effort so
    // a mid-generation crash keeps the summaries already produced. The
    // checkpoint snapshots the whole sidecar (vectors + hashes + summaries); a
    // write failure is non-fatal (the summary is in memory and re-checkpoints
    // on the next save). Only checkpoint when there's a manuscript path —
    // before the first save there's nowhere to write, and the save-time
    // checkpoint will persist it.
    {
        let mut summaries = state.summaries.lock().map_err(|e| e.to_string())?;
        summaries.insert(section_id.clone(), summary.clone());
    }
    let manuscript_path = state
        .last_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    if let Some(path) = manuscript_path {
        let _ = state.checkpoint_index_to_sidecar(&app, &path);
    }

    Ok(summary)
}

/// Read the stored summaries in manuscript order, each with its render context
/// + a `stale` flag. Pure-Rust read (no network) — mirrors `structural_signals`
/// and is what the "Summaries" Feedback Target injects as context. An empty
/// store is a clear error, not a silent empty result — the writer must generate
/// summaries first (mirrors `retrieve_passages`'s empty-store error). The JS
/// side calls `invoke('retrieve_summaries')` with no args; `State` is
/// auto-injected by Tauri.
#[tauri::command]
pub fn retrieve_summaries(state: State<'_, AppState>) -> Result<Vec<SummaryEntry>, String> {
    let summaries = state
        .summaries
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    if summaries.is_empty() {
        return Err(
            "no summaries yet — generate them from the AI options, then set the Feedback Target to Summaries"
                .to_string(),
        );
    }
    let doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    Ok(build_summary_entries(&doc, &summaries))
}

/// The `section_id`s whose stored summary is stale or missing — the set the
/// "Refresh stale" button re-summarizes. Pure-read (no network). Builds the
/// two hash maps `plan_resummarize` diffs: `stored` = each summary's
/// `section_hash` (what the summary was generated from), `current` = each live
/// section's `section_text_hash` (what's on the page now). A section present in
/// the document but absent from the store is "new" → included (its first
/// summary); a section in the store but gone from the document is dropped
/// (orphaned summary, nothing to re-summarize). An empty store → empty `Vec`
/// (refresh on nothing is a no-op, NOT an error — `generateSummaries` handles
/// the "none exist yet" case; this command only answers "which existing ones
/// are stale"). This is `plan_resummarize`'s production caller, so the staleness
/// rule lives in one tested place (Rust) rather than being re-derived in JS from
/// `retrieve_summaries`'s per-entry `stale` flag.
#[tauri::command]
pub fn retrieve_stale_summary_section_ids(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let summaries = state
        .summaries
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    if summaries.is_empty() {
        return Ok(Vec::new());
    }
    let doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let stored: HashMap<String, u64> = summaries
        .iter()
        .map(|(id, s)| (id.clone(), s.section_hash))
        .collect();
    let current: HashMap<String, u64> = doc
        .sections
        .iter()
        .map(|section| (section.id.clone(), section_text_hash(section)))
        .collect();
    Ok(plan_resummarize(&stored, &current))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Element, TextRun, TextStyle};

    // --- test fixtures (mirror retrieval.rs / structure.rs) -----------------

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
            hidden: false,
            paragraphs: paras,
        }
    }

    fn create_document(sections: Vec<Section>) -> Document {
        Document {
            title: "T".to_string(),
            author: "A".to_string(),
            author_contact: "C".to_string(),
            has_toc: false,
            sections,
        }
    }

    fn make_summary(id: &str, hash: u64, summary: &str) -> SectionSummary {
        SectionSummary {
            section_id: id.to_string(),
            section_hash: hash,
            summary: summary.to_string(),
        }
    }

    // --- build_summary_request ----------------------------------------------

    #[test]
    fn build_summary_request_has_system_and_user_messages() {
        let request = build_summary_request("The door opened.", "The Arrival", SectionType::Chapter);
        assert_eq!(request.messages.len(), 2);
        assert_eq!(request.messages[0].role, "system");
        assert_eq!(request.messages[1].role, "user");
    }

    #[test]
    fn build_summary_request_system_message_composes_the_fixed_persona() {
        // The system message must be the _base.md rules + the FIXED summary
        // persona — NOT the user's chat role. The persona body is present, and
        // it is prepended with the base (the base begins the composed string).
        let request = build_summary_request("text", "title", SectionType::Section);
        let system = &request.messages[0].content;
        assert!(system.contains(SUMMARY_PERSONA), "system must carry the summary persona");
        // compose_role_body prepends the base rules, so the persona is NOT at
        // the very start (the base is).
        assert!(
            !system.starts_with(SUMMARY_PERSONA),
            "base rules must be prepended before the persona"
        );
    }

    #[test]
    fn build_summary_request_user_message_carries_task_header_and_text() {
        let request = build_summary_request("The door opened. Rain fell.", "The Arrival", SectionType::Chapter);
        let user = &request.messages[1].content;
        assert!(user.contains(SUMMARY_TASK), "user message must carry the task instruction");
        assert!(user.contains("Chapter: The Arrival"), "chapter title becomes a Chapter: header");
        assert!(user.contains("The door opened. Rain fell."), "section prose is included");
    }

    #[test]
    fn build_summary_request_labels_a_section_type_as_section() {
        let request = build_summary_request("body", "Notes", SectionType::Section);
        assert!(request.messages[1].content.contains("Section: Notes"));
        assert!(!request.messages[1].content.contains("Chapter: Notes"));
    }

    #[test]
    fn build_summary_request_handles_an_untitled_section() {
        let request = build_summary_request("body", "   ", SectionType::Chapter);
        // An empty/whitespace title falls back to "(untitled)" so the header is
        // never a bare "Chapter: " (which reads as a truncation).
        assert!(request.messages[1].content.contains("Chapter (untitled)"));
    }

    #[test]
    fn build_summary_request_leaves_provider_fields_empty_for_the_command_to_fill() {
        let request = build_summary_request("body", "title", SectionType::Section);
        assert_eq!(request.endpoint, "");
        assert_eq!(request.model, "");
        assert!(request.api_key.is_none());
        // Low temperature for a faithful recap.
        assert_eq!(request.temperature, Some(0.3));
    }

    // --- plan_resummarize ----------------------------------------------------

    fn hashes(ids_and_hashes: &[(&str, u64)]) -> HashMap<String, u64> {
        ids_and_hashes
            .iter()
            .map(|(id, hash)| (id.to_string(), *hash))
            .collect()
    }

    #[test]
    fn plan_resummarize_empty_when_all_hashes_match() {
        let stored = hashes(&[("s1", 10), ("s2", 20)]);
        let current = hashes(&[("s1", 10), ("s2", 20)]);
        assert!(plan_resummarize(&stored, &current).is_empty());
    }

    #[test]
    fn plan_resummarize_flags_a_changed_section() {
        let stored = hashes(&[("s1", 10), ("s2", 20)]);
        let current = hashes(&[("s1", 10), ("s2", 99)]);
        let res = plan_resummarize(&stored, &current);
        let mut got: Vec<&str> = res.iter().map(|s| s.as_str()).collect();
        got.sort_unstable();
        assert_eq!(got, vec!["s2"]);
    }

    #[test]
    fn plan_resummarize_flags_a_new_section() {
        let stored = hashes(&[("s1", 10)]);
        let current = hashes(&[("s1", 10), ("s3", 30)]);
        let res = plan_resummarize(&stored, &current);
        let mut got: Vec<&str> = res.iter().map(|s| s.as_str()).collect();
        got.sort_unstable();
        assert_eq!(got, vec!["s3"]);
    }

    #[test]
    fn plan_resummarize_ignores_deleted_sections() {
        // s2 is gone from the current document — it is NOT in the result (a
        // deleted section is not re-summarized; its orphaned summary is just
        // skipped by retrieve_summaries).
        let stored = hashes(&[("s1", 10), ("s2", 20)]);
        let current = hashes(&[("s1", 10)]);
        assert!(plan_resummarize(&stored, &current).is_empty());
    }

    #[test]
    fn plan_resummarize_handles_change_and_new_together() {
        let stored = hashes(&[("s1", 10), ("s2", 20)]);
        let current = hashes(&[("s1", 11), ("s3", 30)]);
        let res = plan_resummarize(&stored, &current);
        let mut got: Vec<&str> = res.iter().map(|s| s.as_str()).collect();
        got.sort_unstable();
        assert_eq!(got, vec!["s1", "s3"]);
    }

    // --- build_summary_entries (manuscript order + staleness) ----------------

    #[test]
    fn build_summary_entries_returns_only_summarized_sections_in_manuscript_order() {
        let doc = create_document(vec![
            create_section("c1", "One", SectionType::Chapter, vec![create_paragraph("p1", "a b")]),
            create_section("s1", "Notes", SectionType::Section, vec![create_paragraph("p2", "c d")]),
            create_section("c2", "Two", SectionType::Chapter, vec![create_paragraph("p3", "e f")]),
        ]);
        // Summaries exist for c1 and c2 only (s1 is skipped).
        let c1_hash = section_text_hash(&doc.sections[0]);
        let c2_hash = section_text_hash(&doc.sections[2]);
        let summaries = HashMap::from([
            ("c1".to_string(), make_summary("c1", c1_hash, "Chapter one recap.")),
            ("c2".to_string(), make_summary("c2", c2_hash, "Chapter two recap.")),
        ]);
        let entries = build_summary_entries(&doc, &summaries);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].section_id, "c1");
        assert_eq!(entries[1].section_id, "c2");
        // Manuscript order preserved (c1 before c2), not HashMap order.
    }

    #[test]
    fn build_summary_entries_derives_chapter_index_advancing_only_on_chapters() {
        let doc = create_document(vec![
            create_section("c1", "One", SectionType::Chapter, vec![create_paragraph("p1", "a")]),
            create_section("s1", "Notes", SectionType::Section, vec![create_paragraph("p2", "b")]),
            create_section("c2", "Two", SectionType::Chapter, vec![create_paragraph("p3", "c")]),
        ]);
        let h = |i| section_text_hash(&doc.sections[i]);
        let summaries = HashMap::from([
            ("c1".to_string(), make_summary("c1", h(0), "r1")),
            ("s1".to_string(), make_summary("s1", h(1), "r2")),
            ("c2".to_string(), make_summary("c2", h(2), "r3")),
        ]);
        let entries = build_summary_entries(&doc, &summaries);
        // c1 → Chapter 1, s1 → inherits 1 (None? no — Section inherits the
        // nearest preceding Chapter's index, so Some(1)), c2 → Chapter 2.
        assert_eq!(entries[0].chapter_index, Some(1));
        assert_eq!(entries[1].chapter_index, Some(1)); // Section under Chapter 1
        assert_eq!(entries[2].chapter_index, Some(2));
        assert_eq!(entries[1].section_type, SectionType::Section);
    }

    #[test]
    fn build_summary_entries_front_matter_has_no_chapter_index() {
        let doc = create_document(vec![
            create_section("front", "Epigraph", SectionType::Section, vec![create_paragraph("p1", "a")]),
            create_section("c1", "One", SectionType::Chapter, vec![create_paragraph("p2", "b")]),
        ]);
        let h = |i| section_text_hash(&doc.sections[i]);
        let summaries = HashMap::from([
            ("front".to_string(), make_summary("front", h(0), "epigram recap")),
            ("c1".to_string(), make_summary("c1", h(1), "chapter recap")),
        ]);
        let entries = build_summary_entries(&doc, &summaries);
        assert_eq!(entries[0].chapter_index, None); // before any Chapter
        assert_eq!(entries[1].chapter_index, Some(1));
    }

    #[test]
    fn build_summary_entries_flags_stale_when_section_hash_differs() {
        let doc = create_document(vec![
            create_section("c1", "One", SectionType::Chapter, vec![create_paragraph("p1", "the door opened")]),
        ]);
        let live_hash = section_text_hash(&doc.sections[0]);
        // A summary stored with a WRONG hash → stale.
        let summaries = HashMap::from([("c1".to_string(), make_summary("c1", live_hash + 1, "old recap"))]);
        let entries = build_summary_entries(&doc, &summaries);
        assert!(entries[0].stale, "a mismatched section_hash must flag stale");
    }

    #[test]
    fn build_summary_entries_not_stale_when_section_hash_matches() {
        let doc = create_document(vec![
            create_section("c1", "One", SectionType::Chapter, vec![create_paragraph("p1", "the door opened")]),
        ]);
        let live_hash = section_text_hash(&doc.sections[0]);
        let summaries = HashMap::from([("c1".to_string(), make_summary("c1", live_hash, "fresh recap"))]);
        let entries = build_summary_entries(&doc, &summaries);
        assert!(!entries[0].stale);
    }

    #[test]
    fn build_summary_entries_drops_orphaned_summaries_for_deleted_sections() {
        let doc = create_document(vec![
            create_section("c1", "One", SectionType::Chapter, vec![create_paragraph("p1", "a")]),
        ]);
        // The store has a summary for a section no longer in the doc.
        let summaries = HashMap::from([
            ("c1".to_string(), make_summary("c1", section_text_hash(&doc.sections[0]), "r1")),
            ("gone".to_string(), make_summary("gone", 999, "orphan")),
        ]);
        let entries = build_summary_entries(&doc, &summaries);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].section_id, "c1");
    }

    #[test]
    fn build_summary_entries_empty_when_no_sections_have_summaries() {
        let doc = create_document(vec![
            create_section("c1", "One", SectionType::Chapter, vec![create_paragraph("p1", "a")]),
        ]);
        let entries = build_summary_entries(&doc, &HashMap::new());
        assert!(entries.is_empty());
    }
}