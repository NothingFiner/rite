use crate::document::{
    find_paragraph_mut, find_section_mut, Document, Element, Paragraph, ReplaceResult, SearchMatch,
    Section, SectionType, TextRun, TextStyleDelta,
};
use crate::diff::{self, SectionDiff};
use crate::history::{self, HistoryEntry};
use crate::state::AppState;
use regex::Regex;
use std::fs;
use std::path::Path;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_document(state: State<AppState>) -> Result<Document, String> {
    let doc = state.document.lock().map_err(|e| e.to_string())?;
    Ok(doc.clone())
}

/// Remove the section identified by `id`. The document always keeps at least
/// one section (deleting the last replaces it with a fresh empty one), so the
/// editor never renders an empty sheet. Round-trip: the delta is journalable
/// and undoable via `push_history_delta`.
#[tauri::command]
pub fn delete_section(id: String, state: State<AppState>) -> Result<Document, String> {
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;

    if let Some(idx) = doc.sections.iter().position(|s| s.id == id) {
        doc.sections.remove(idx);
    }
    if doc.sections.is_empty() {
        doc.sections.push(Section::default());
    }

    *modified = true;
    drop(doc);
    state.push_history_delta(&old_doc);
    let doc = state.document.lock().map_err(|e| e.to_string())?;
    Ok(doc.clone())
}

/// Set a section's title. For a `Chapter` this is the subtitle (the `Chapter N:`
/// prefix is render-derived, never stored); for a `Section` it is the full
/// title. Round-trip + undoable.
#[tauri::command]
pub fn rename_section(
    id: String,
    title: String,
    state: State<AppState>,
) -> Result<Document, String> {
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;

    if let Some(section) = find_section_mut(&mut doc, &id) {
        section.title = title;
    }

    *modified = true;
    drop(doc);
    state.push_history_delta(&old_doc);
    let doc = state.document.lock().map_err(|e| e.to_string())?;
    Ok(doc.clone())
}

/// Toggle a section between `Chapter` (derived number) and `Section` (freeform
/// title, no number). Round-trip + undoable via `ChangeSectionType`.
#[tauri::command]
pub fn change_section_type(
    id: String,
    new_type: SectionType,
    state: State<AppState>,
) -> Result<Document, String> {
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;

    if let Some(section) = find_section_mut(&mut doc, &id) {
        section.section_type = new_type;
    }

    *modified = true;
    drop(doc);
    state.push_history_delta(&old_doc);
    let doc = state.document.lock().map_err(|e| e.to_string())?;
    Ok(doc.clone())
}

/// Move a section — with all its paragraphs — to sit after `to_after_id`, or
/// to the front of the document when `to_after_id` is `None`. The outline
/// drag-reorder (roadmap 5.5) calls this; the resulting `push_history_delta`
/// journals a single `MoveSection` op (the compute_doc_ops reorder fix), so
/// undo/redo and version-history reconstruction both round-trip the order.
#[tauri::command]
pub fn move_section(
    id: String,
    to_after_id: Option<String>,
    state: State<AppState>,
) -> Result<Document, String> {
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;

    if to_after_id.as_deref() == Some(id.as_str()) {
        return Err(format!("MoveSection: section {} cannot follow itself", id));
    }
    // Validate the destination BEFORE mutating: on a bad id the document
    // lock must not be released with the section already removed (the
    // failed command would otherwise silently drop it from the document).
    if let Some(to_after_id) = &to_after_id {
        if !doc.sections.iter().any(|s| s.id == *to_after_id) {
            return Err(format!("MoveSection: to_after_id {} not found", to_after_id));
        }
    }
    let from_idx = doc
        .sections
        .iter()
        .position(|s| s.id == id)
        .ok_or_else(|| format!("MoveSection: section {} not found", id))?;
    let section = doc.sections.remove(from_idx);
    if let Some(to_after_id) = &to_after_id {
        let to_idx = doc
            .sections
            .iter()
            .position(|s| s.id == *to_after_id)
            .expect("destination validated above");
        doc.sections.insert(to_idx + 1, section);
    } else {
        doc.sections.insert(0, section);
    }

    *modified = true;
    drop(doc);
    state.push_history_delta(&old_doc);
    let doc = state.document.lock().map_err(|e| e.to_string())?;
    Ok(doc.clone())
}

#[tauri::command]
pub fn search_document(query: String, state: State<AppState>) -> Result<Vec<SearchMatch>, String> {
    let doc = state.document.lock().map_err(|e| e.to_string())?;
    let pattern = regex::escape(&query);
    let re = Regex::new(&format!("(?i){}", pattern)).map_err(|e| e.to_string())?;
    let mut matches = Vec::new();

    for section in &doc.sections {
        for para in &section.paragraphs {
            let text: String = para
                .elements
                .iter()
                .map(|e| e.text_run.content.as_str())
                .collect();
            for m in re.find_iter(&text) {
                let start_offset = text[..m.start()].chars().count();
                let end_offset = text[..m.end()].chars().count();
                matches.push(SearchMatch {
                    section_id: section.id.clone(),
                    paragraph_id: para.id.clone(),
                    start_offset,
                    end_offset,
                    text: m.as_str().to_string(),
                });
            }
        }
    }

    Ok(matches)
}

#[tauri::command]
pub fn replace_current(
    query: String,
    replacement: String,
    match_index: usize,
    state: State<AppState>,
) -> Result<ReplaceResult, String> {
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;

    let pattern = regex::escape(&query);
    let re = Regex::new(&format!("(?i){}", pattern)).map_err(|e| e.to_string())?;

    // Find all matches with char offsets, tracking which section each is in.
    let mut matches = Vec::new();
    for section in &doc.sections {
        for para in &section.paragraphs {
            let text: String = para
                .elements
                .iter()
                .map(|e| e.text_run.content.as_str())
                .collect();
            for m in re.find_iter(&text) {
                let start_offset = text[..m.start()].chars().count();
                let end_offset = text[..m.end()].chars().count();
                matches.push((section.id.clone(), para.id.clone(), start_offset, end_offset));
            }
        }
    }

    if match_index >= matches.len() {
        return Ok(ReplaceResult {
            matches: vec![],
            current_index: -1,
        });
    }

    let (_section_id, para_id, m_start, m_end) = &matches[match_index];
    if let Some(para) = find_paragraph_mut(&mut doc, para_id) {
        let full_text: String = para
            .elements
            .iter()
            .map(|e| e.text_run.content.clone())
            .collect();
        let start_byte = full_text
            .char_indices()
            .nth(*m_start)
            .map(|(i, _)| i)
            .unwrap_or(full_text.len());
        let end_byte = full_text
            .char_indices()
            .nth(*m_end)
            .map(|(i, _)| i)
            .unwrap_or(full_text.len());

        let mut new_text = String::new();
        new_text.push_str(&full_text[..start_byte]);
        new_text.push_str(&replacement);
        new_text.push_str(&full_text[end_byte..]);

        if let Some(first) = para.elements.first_mut() {
            first.text_run.content = new_text;
        }
    }

    *modified = true;

    // Re-search
    let mut new_matches = Vec::new();
    for section in &doc.sections {
        for para in &section.paragraphs {
            let text: String = para
                .elements
                .iter()
                .map(|e| e.text_run.content.as_str())
                .collect();
            for m in re.find_iter(&text) {
                let start_offset = text[..m.start()].chars().count();
                let end_offset = text[..m.end()].chars().count();
                new_matches.push(SearchMatch {
                    section_id: section.id.clone(),
                    paragraph_id: para.id.clone(),
                    start_offset,
                    end_offset,
                    text: query.clone(),
                });
            }
        }
    }

    let new_index = if match_index < new_matches.len() {
        match_index as i32
    } else if new_matches.is_empty() {
        -1
    } else {
        new_matches.len() as i32 - 1
    };

    drop(doc);
    state.push_history_delta(&old_doc);

    Ok(ReplaceResult {
        matches: new_matches,
        current_index: new_index,
    })
}

#[tauri::command]
pub fn replace_all(
    query: String,
    replacement: String,
    state: State<AppState>,
) -> Result<u32, String> {
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;
    let mut count = 0u32;

    let pattern = regex::escape(&query);
    let re = Regex::new(&format!("(?i){}", pattern)).map_err(|e| e.to_string())?;

    for section in doc.sections.iter_mut() {
        for para in section.paragraphs.iter_mut() {
            for el in para.elements.iter_mut() {
                let content = &mut el.text_run.content;
                let new_content = re.replace_all(content, replacement.as_str()).to_string();
                if new_content != *content {
                    count += re.find_iter(content).count() as u32;
                    *content = new_content;
                }
            }
        }
    }

    if count > 0 {
        *modified = true;
    }
    drop(doc);
    state.push_history_delta(&old_doc);
    Ok(count)
}

#[tauri::command]
pub fn save_document(path: String, app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let doc = state.document.lock().map_err(|e| e.to_string())?.clone();

    // Record a full snapshot of the saved document in the embedded history (the
    // save baseline), then write the whole `.rite` — document + history — as a
    // single atomic file. This replaces the old `.rite` + `.rite.history` sidecar
    // pair, so nothing separate appears in Finder next to the document.
    state.append_history_snapshot(&doc)?;
    let file = state.build_rite_file()?;
    // `write_rite_file` takes ownership and stamps the current schema version
    // on the way to disk; `file` is not used afterward, so move it in.
    history::write_rite_file(Path::new(&path), file)?;

    // Checkpoint the RAG vector index to its sidecar (Phase 4.7). Done BEFORE
    // `path` is moved into `last_path` below. Best-effort: vectors are derivable
    // (a missing sidecar just rebuilds on next open), so a sidecar write failure
    // must NOT fail the document save that already succeeded — swallow it.
    let _ = state.checkpoint_index_to_sidecar(&app, &path);

    let mut last_path = state.last_path.lock().map_err(|e| e.to_string())?;
    *last_path = Some(path);

    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;
    *modified = false;

    // The saved document is now the baseline the next autosave delta computes
    // against (the snapshot just appended reconstructs to this same state).
    state.set_history_baseline(&doc);

    Ok(())
}

#[tauri::command]
pub fn open_document(path: String, app: AppHandle, state: State<AppState>) -> Result<Document, String> {
    let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;

    // Parse the `.rite` as an embedded `RiteFile { document, history }`. A
    // bare `Document` (a pre-embedding `.rite`, written before history lived
    // inside the file) is accepted as a fallback with an empty history, so
    // older single-document saves still open. Then run the forward-migration
    // hook so the rest of the app only ever sees a file at the current schema;
    // a file from a newer Rite is rejected here with a clear error rather than
    // silently misread.
    let mut rite_file = history::migrate_rite_file(history::read_rite_file(&json)?)?;

    // Absorb any legacy `.rite.history` sidecar folder into the embedded
    // history, then delete the folder so it no longer appears in Finder.
    // No-op when there was no sidecar (a modern `.rite` with embedded history).
    let migrated = history::migrate_sidecar(Path::new(&path))?;
    if !migrated.is_empty() {
        rite_file.history.extend(migrated);
        // Both sides are already oldest-first; a stable sort by timestamp keeps
        // them that way and tolerates any interleaving.
        rite_file
            .history
            .sort_by(|a, b| a.timestamp().cmp(b.timestamp()));
    }

    let doc = rite_file.document.clone();

    let mut state_doc = state.document.lock().map_err(|e| e.to_string())?;
    *state_doc = doc.clone();
    drop(state_doc);

    // Load the embedded history into the live state. set_version_history also
    // compacts, so a freshly migrated (uncapped, old sidecar) history is
    // bounded immediately.
    state.set_version_history(rite_file.history);

    state.reset_history();
    // The loaded document is the baseline the first autosave delta computes
    // against (the embedded history already holds a snapshot from the
    // document's last explicit save).
    state.set_history_baseline(&doc);

    // Load the durable RAG vector index for this manuscript (Phase 4.7). This
    // clears the previous manuscript's stale vectors first, then repopulates
    // from the sidecar if one exists for this path; the next `reembed_document`
    // pass reconciles the persisted baseline against the live document.
    state.load_index_from_sidecar(&app, &path);

    let mut last_path = state.last_path.lock().map_err(|e| e.to_string())?;
    *last_path = Some(path);

    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;
    *modified = false;

    Ok(doc)
}

#[tauri::command]
pub fn sync_document(data: Document, state: State<AppState>) -> Result<(), String> {
    // Capture the pre-sync state so the typing batch is journaled as an undo
    // delta. The editor's typing path lands here ~1s after typing stops
    // (debouncedSync coalesces a burst into one call). Without this, plain
    // typing was never journaled, so Cmd+Z only reverted the structural
    // commands (rename/delete/change-type) — not additions or edits. The
    // delta machinery (compute_doc_ops → UpdateParagraph{old,new}, inverts by
    // swap) already handles both additions and deletions; we were simply not
    // feeding it. push_history_delta no-ops when compute_doc_ops finds no
    // change, so an unchanged re-sync (e.g. the flush store.undo performs
    // before reverting) creates no spurious undo step.
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;
    *doc = data;
    *modified = true;
    drop(doc);
    state.push_history_delta(&old_doc);
    Ok(())
}

#[tauri::command]
pub fn autosave_document(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let modified = *state.is_modified.lock().map_err(|e| e.to_string())?;
    if !modified {
        return Ok(());
    }

    // A document with no last_path has never been saved, so there is no `.rite`
    // to rewrite or baseline to journal from.
    let base_path = state.last_path.lock().map_err(|e| e.to_string())?.clone();
    let Some(base_path) = base_path else {
        return Ok(());
    };

    // Journal the change since the last baseline into the embedded history (a
    // delta, or a fresh snapshot if the delta run has grown long), then rewrite
    // the whole `.rite` so the history on disk stays current. The tradeoff of
    // embedding history in the file is that a throttled autosave rewrites the
    // whole file including history — but it only fires here (and on explicit
    // save), never per keystroke.
    let journaled = state.append_history_delta()?;
    if journaled {
        let file = state.build_rite_file()?;
        history::write_rite_file(Path::new(&base_path), file)?;
        // Checkpoint the RAG vector index alongside the `.rite` rewrite
        // (Phase 4.7). Best-effort, same rationale as `save_document`: the
        // index is derivable, so a sidecar write failure must not fail the
        // autosave. Only checkpoint when we actually rewrote the `.rite`
        // (a journaled change implies the doc — and thus the reembed that
        // follows a sync — advanced).
        let _ = state.checkpoint_index_to_sidecar(&app, &base_path);
    }

    *state.is_modified.lock().map_err(|e| e.to_string())? = false;
    Ok(())
}

/// Manually append a full snapshot of the current document to the embedded
/// history and persist the `.rite`. A checkpoint records progress (a
/// browse/restore point) without a full save's semantics. Returns the snapshot's
/// timestamp. Requires the document to have been saved at least once (a
/// last_path to write to).
#[tauri::command]
pub fn save_snapshot(state: State<AppState>) -> Result<String, String> {
    let base_path = require_last_path(&state)?;
    let doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let timestamp = state.append_history_snapshot(&doc)?;
    let file = state.build_rite_file()?;
    history::write_rite_file(Path::new(&base_path), file)?;
    Ok(timestamp)
}

/// List every snapshot and delta in the open document's embedded history,
/// oldest first. Returns an empty list when no document is open or it has no
/// history yet.
#[tauri::command]
pub fn list_history(state: State<AppState>) -> Result<Vec<HistoryEntry>, String> {
    let Some(_) = state.last_path.lock().map_err(|e| e.to_string())?.clone() else {
        return Ok(Vec::new());
    };
    let history_records = state.version_history.lock().map_err(|e| e.to_string())?;
    Ok(history::list_history(&history_records))
}

/// Reconstruct the document as it was at `timestamp`: take the newest snapshot
/// at or before it, then replay intervening deltas forward. A read-only query
/// over the embedded history — it does not load the result into the live
/// document (restoring a version is a separate action).
#[tauri::command]
pub fn reconstruct_version(timestamp: String, state: State<AppState>) -> Result<Document, String> {
    let _ = require_last_path(&state)?;
    let history_records = state.version_history.lock().map_err(|e| e.to_string())?;
    history::reconstruct_version(&timestamp, &history_records)
}

/// Replace the live document with the version reconstructed at `timestamp`.
/// Non-destructive: the `.rite` on disk is untouched (the next explicit save
/// rewrites it). Undoable: an in-memory history delta is journaled for the
/// old→restored transition, so Cmd+Z reverts the restore. The reconstructed
/// document is returned so the frontend store can adopt it as the live doc.
#[tauri::command]
pub fn restore_version(timestamp: String, state: State<AppState>) -> Result<Document, String> {
    let _ = require_last_path(&state)?;
    let restored = {
        let history_records = state.version_history.lock().map_err(|e| e.to_string())?;
        history::reconstruct_version(&timestamp, &history_records)?
    };

    // Capture the old state before overwriting. `push_history_delta` computes
    // the delta from `old` to the *current* document internally, so the live
    // doc must already hold `restored` when we call it.
    let mut state_doc = state.document.lock().map_err(|e| e.to_string())?;
    let old = state_doc.clone();
    *state_doc = restored.clone();
    drop(state_doc);

    state.push_history_delta(&old);

    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;
    *modified = true;
    Ok(restored)
}

/// Structural diff of the version at `timestamp` (left/old) against the current
/// live document (right/new). Returns one `SectionDiff` per section, walked by
/// id, with word-level spans inside modified paragraphs. Read-only: touches
/// neither the live document nor the embedded history.
#[tauri::command]
pub fn diff_against_current(
    timestamp: String,
    state: State<AppState>,
) -> Result<Vec<SectionDiff>, String> {
    let _ = require_last_path(&state)?;
    let past = {
        let history_records = state.version_history.lock().map_err(|e| e.to_string())?;
        history::reconstruct_version(&timestamp, &history_records)?
    };
    let current = state.document.lock().map_err(|e| e.to_string())?;
    Ok(diff::compute_diff(&past, &*current))
}

/// Clone the current last_path, or error if the document has never been saved
/// (no `.rite` to read from or write to).
fn require_last_path(state: &State<AppState>) -> Result<String, String> {
    state
        .last_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "no document path — save the document first".to_string())
}

fn apply_text_style_to_paragraph(
    para: &mut Paragraph,
    start: usize,
    end: usize,
    style_delta: &TextStyleDelta,
) -> Result<(), String> {
    let full_text: String = para
        .elements
        .iter()
        .map(|e| e.text_run.content.clone())
        .collect();
    let char_count = full_text.chars().count();
    let start = start.min(char_count);
    let end = end.min(char_count);
    if start >= end {
        return Ok(());
    }

    let mut new_elements = Vec::new();
    let mut current_offset = 0usize;

    for el in para.elements.iter() {
        let content = &el.text_run.content;
        let len = content.chars().count();
        let el_start = current_offset;
        let el_end = current_offset + len;

        if el_end <= start || el_start >= end {
            new_elements.push(el.clone());
        } else {
            let overlap_start = start.saturating_sub(el_start);
            let overlap_end = (end.saturating_sub(el_start)).min(len);

            let prefix: String = content.chars().take(overlap_start).collect();
            let middle: String = content
                .chars()
                .skip(overlap_start)
                .take(overlap_end - overlap_start)
                .collect();
            let suffix: String = content.chars().skip(overlap_end).collect();

            if !prefix.is_empty() {
                new_elements.push(Element {
                    text_run: TextRun {
                        content: prefix,
                        text_style: el.text_run.text_style.clone(),
                    },
                });
            }

            let mut middle_style = el.text_run.text_style.clone();
            if let Some(bold) = style_delta.bold {
                middle_style.bold = bold;
            }
            if let Some(italic) = style_delta.italic {
                middle_style.italic = italic;
            }
            if let Some(underline) = style_delta.underline {
                middle_style.underline = underline;
            }
            if let Some(font_size) = style_delta.font_size {
                middle_style.font_size = Some(font_size);
            }

            new_elements.push(Element {
                text_run: TextRun {
                    content: middle,
                    text_style: middle_style,
                },
            });

            if !suffix.is_empty() {
                new_elements.push(Element {
                    text_run: TextRun {
                        content: suffix,
                        text_style: el.text_run.text_style.clone(),
                    },
                });
            }
        }

        current_offset += len;
    }

    // Merge adjacent elements with identical styles.
    let mut merged: Vec<Element> = Vec::new();
    for el in new_elements {
        if let Some(last) = merged.last_mut() {
            if last.text_run.text_style == el.text_run.text_style {
                last.text_run.content.push_str(&el.text_run.content);
                continue;
            }
        }
        merged.push(el);
    }

    para.elements = merged;
    Ok(())
}

/// Locate a paragraph by id, returning `(section_index, paragraph_index)`.
/// Paragraph ids are globally unique, so at most one match exists.
fn find_paragraph_location(doc: &Document, paragraph_id: &str) -> Option<(usize, usize)> {
    for (si, section) in doc.sections.iter().enumerate() {
        if let Some(pi) = section.paragraphs.iter().position(|p| p.id == paragraph_id) {
            return Some((si, pi));
        }
    }
    None
}

/// Split the paragraph identified by `paragraph_id` at `offset` characters,
/// within the section that owns it. Splitting at a boundary (0 or end-of-text)
/// inserts an empty paragraph before/after it instead of cutting a run. The
/// original paragraph keeps its id and indents; the new paragraph gets a fresh
/// id and default (no) indents. Returns false if no paragraph has that id.
/// Extracted from `split_paragraph`.
fn split_paragraph_in_document(doc: &mut Document, paragraph_id: &str, offset: usize) -> bool {
    let Some((si, idx)) = find_paragraph_location(doc, paragraph_id) else {
        return false;
    };
    let paras = &mut doc.sections[si].paragraphs;
    let para = paras[idx].clone();
    let full_text: String = para
        .elements
        .iter()
        .map(|e| e.text_run.content.clone())
        .collect();
    let char_count = full_text.chars().count();
    let offset = offset.min(char_count);

    if offset == 0 || offset == char_count {
        let new_para = Paragraph::default();
        let insert_idx = if offset == 0 { idx } else { idx + 1 };
        paras.insert(insert_idx, new_para);
    } else {
        let mut before_elements = Vec::new();
        let mut after_elements = Vec::new();
        let mut current_offset = 0usize;

        for el in para.elements.iter() {
            let content = &el.text_run.content;
            let len = content.chars().count();
            let el_start = current_offset;

            if el_start + len <= offset {
                before_elements.push(el.clone());
            } else if el_start >= offset {
                after_elements.push(el.clone());
            } else {
                let split_at = offset - el_start;
                let before_text: String = content.chars().take(split_at).collect();
                let after_text: String = content.chars().skip(split_at).collect();

                if !before_text.is_empty() {
                    before_elements.push(Element {
                        text_run: TextRun {
                            content: before_text,
                            text_style: el.text_run.text_style.clone(),
                        },
                    });
                }
                if !after_text.is_empty() {
                    after_elements.push(Element {
                        text_run: TextRun {
                            content: after_text,
                            text_style: el.text_run.text_style.clone(),
                        },
                    });
                }
            }

            current_offset += len;
        }

        let left_indent = para.left_indent;
        let right_indent = para.right_indent;
        let first_line_indent = para.first_line_indent;

        let before_para = Paragraph {
            id: para.id.clone(),
            elements: before_elements,
            left_indent,
            right_indent,
            first_line_indent,
        };

        let after_para = Paragraph {
            id: format!("p-{}", uuid::Uuid::new_v4()),
            elements: after_elements,
            left_indent: None,
            right_indent: None,
            first_line_indent: None,
        };

        paras[idx] = before_para;
        paras.insert(idx + 1, after_para);
    }
    true
}

/// Merge paragraph `second_id` into the preceding paragraph `first_id`. Only
/// merges when the two are adjacent paragraphs in the *same* section (second
/// immediately follows first). Cross-section merges are refused — a section
/// boundary is structural, not a join point. Elements with identical text
/// styles are concatenated into one run; otherwise the second paragraph's
/// elements are appended unchanged. Returns false if either id is missing or
/// they are not adjacent in the same section. Extracted from `merge_paragraphs`.
fn merge_paragraphs_in_document(doc: &mut Document, first_id: &str, second_id: &str) -> bool {
    let Some((si, first_idx)) = find_paragraph_location(doc, first_id) else {
        return false;
    };
    let second_idx = first_idx + 1;
    let paras = &doc.sections[si].paragraphs;
    if second_idx >= paras.len() || paras[second_idx].id != second_id {
        return false;
    }

    let second = doc.sections[si].paragraphs.remove(second_idx);
    let first = &mut doc.sections[si].paragraphs[first_idx];
    for el in second.elements {
        if let Some(last) = first.elements.last_mut() {
            if last.text_run.text_style == el.text_run.text_style {
                last.text_run.content.push_str(&el.text_run.content);
                continue;
            }
        }
        first.elements.push(el);
    }
    true
}

#[tauri::command]
pub fn apply_text_style(
    paragraph_id: String,
    start_offset: usize,
    end_offset: usize,
    style_delta: TextStyleDelta,
    state: State<AppState>,
) -> Result<Document, String> {
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;

    if let Some(para) = find_paragraph_mut(&mut doc, &paragraph_id) {
        apply_text_style_to_paragraph(para, start_offset, end_offset, &style_delta)?;
    }

    *modified = true;
    drop(doc);
    state.push_history_delta(&old_doc);
    let doc = state.document.lock().map_err(|e| e.to_string())?;
    Ok(doc.clone())
}

#[tauri::command]
pub fn split_paragraph(
    paragraph_id: String,
    offset: usize,
    state: State<AppState>,
) -> Result<Document, String> {
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;

    split_paragraph_in_document(&mut doc, &paragraph_id, offset);

    *modified = true;
    drop(doc);
    state.push_history_delta(&old_doc);
    let doc = state.document.lock().map_err(|e| e.to_string())?;
    Ok(doc.clone())
}

#[tauri::command]
pub fn merge_paragraphs(
    first_id: String,
    second_id: String,
    state: State<AppState>,
) -> Result<Document, String> {
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;

    merge_paragraphs_in_document(&mut doc, &first_id, &second_id);

    *modified = true;
    drop(doc);
    state.push_history_delta(&old_doc);
    let doc = state.document.lock().map_err(|e| e.to_string())?;
    Ok(doc.clone())
}

#[tauri::command]
pub fn undo(state: State<AppState>) -> Result<Document, String> {
    if state.undo()? {
        let doc = state.document.lock().map_err(|e| e.to_string())?;
        let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;
        *modified = true;
        Ok(doc.clone())
    } else {
        let doc = state.document.lock().map_err(|e| e.to_string())?;
        Ok(doc.clone())
    }
}

#[tauri::command]
pub fn redo(state: State<AppState>) -> Result<Document, String> {
    if state.redo()? {
        let doc = state.document.lock().map_err(|e| e.to_string())?;
        let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;
        *modified = true;
        Ok(doc.clone())
    } else {
        let doc = state.document.lock().map_err(|e| e.to_string())?;
        Ok(doc.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Section, SectionType, TextStyle};
    use tauri::Manager;

    /// Create a paragraph with a single unstyled run of `text`.
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

    /// Create a paragraph with a single run carrying an explicit style.
    fn create_styled_paragraph(id: &str, text: &str, style: TextStyle) -> Paragraph {
        Paragraph {
            id: id.to_string(),
            elements: vec![Element {
                text_run: TextRun {
                    content: text.to_string(),
                    text_style: style,
                },
            }],
            left_indent: None,
            right_indent: None,
            first_line_indent: None,
        }
    }

    /// A single-section document whose section holds the given paragraphs.
    /// The split/merge/format tests all operate within this one section.
    fn create_document(content: Vec<Paragraph>) -> Document {
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
                paragraphs: content,
            }],
        }
    }

    /// A section with the given id and paragraphs — the building block for
    /// the move_section tests, which need MULTI-section documents.
    fn create_section(id: &str, paragraphs: Vec<Paragraph>) -> Section {
        Section {
            id: id.to_string(),
            title: String::new(),
            section_type: SectionType::Section,
            paragraphs,
        }
    }

    fn para_text(p: &Paragraph) -> String {
        p.elements
            .iter()
            .map(|e| e.text_run.content.as_str())
            .collect()
    }

    fn bold() -> TextStyleDelta {
        TextStyleDelta {
            bold: Some(true),
            italic: None,
            underline: None,
            font_size: None,
        }
    }

    // --- apply_text_style_to_paragraph -----------------------------------------

    #[test]
    fn format_bold_middle_splits_into_three_runs() {
        let mut para = create_paragraph("p1", "hello");
        apply_text_style_to_paragraph(&mut para, 1, 4, &bold()).unwrap();
        // prefix "h" (normal) | middle "ell" (bold) | suffix "o" (normal)
        assert_eq!(para.elements.len(), 3);
        assert_eq!(para.elements[0].text_run.content, "h");
        assert!(!para.elements[0].text_run.text_style.bold);
        assert_eq!(para.elements[1].text_run.content, "ell");
        assert!(para.elements[1].text_run.text_style.bold);
        assert_eq!(para.elements[2].text_run.content, "o");
        assert!(!para.elements[2].text_run.text_style.bold);
    }

    #[test]
    fn format_bold_whole_run_stays_single() {
        let mut para = create_paragraph("p1", "hello");
        apply_text_style_to_paragraph(&mut para, 0, 5, &bold()).unwrap();
        assert_eq!(para.elements.len(), 1);
        assert_eq!(para.elements[0].text_run.content, "hello");
        assert!(para.elements[0].text_run.text_style.bold);
    }

    #[test]
    fn format_merges_adjacent_runs_of_same_style() {
        // Two elements with the *same* (normal) style abutting each other.
        let mut para = Paragraph {
            id: "p1".to_string(),
            elements: vec![
                Element {
                    text_run: TextRun {
                        content: "ab".to_string(),
                        text_style: TextStyle::default(),
                    },
                },
                Element {
                    text_run: TextRun {
                        content: "cd".to_string(),
                        text_style: TextStyle::default(),
                    },
                },
            ],
            left_indent: None,
            right_indent: None,
            first_line_indent: None,
        };
        // Bold the "bc" range that straddles the element boundary.
        apply_text_style_to_paragraph(&mut para, 1, 3, &bold()).unwrap();
        // The trailing empty middle fragment and its bold neighbour collapse
        // back together in the merge pass, leaving clean a | bc | d.
        assert_eq!(para_text(&para), "abcd");
        assert_eq!(para.elements.len(), 3);
        assert_eq!(para.elements[1].text_run.content, "bc");
        assert!(para.elements[1].text_run.text_style.bold);
    }

    #[test]
    fn format_empty_range_is_noop() {
        let mut para = create_paragraph("p1", "hello");
        // start == end (also start > end after clamping) must do nothing.
        apply_text_style_to_paragraph(&mut para, 3, 3, &bold()).unwrap();
        assert_eq!(para.elements.len(), 1);
        assert_eq!(para.elements[0].text_run.content, "hello");
        assert!(!para.elements[0].text_run.text_style.bold);
    }

    #[test]
    fn format_offsets_clamp_to_text_length() {
        let mut para = create_paragraph("p1", "hi");
        // end far beyond the 2-char text clamps to the end; nothing panics.
        apply_text_style_to_paragraph(&mut para, 1, 999, &bold()).unwrap();
        assert_eq!(para_text(&para), "hi");
        assert_eq!(para.elements.len(), 2);
        assert_eq!(para.elements[0].text_run.content, "h");
        assert!(!para.elements[0].text_run.text_style.bold);
        assert_eq!(para.elements[1].text_run.content, "i");
        assert!(para.elements[1].text_run.text_style.bold);
    }

    // --- split_paragraph_in_document ---------------------------------------

    #[test]
    fn split_in_middle_preserves_id_on_before() {
        let mut doc = create_document(vec![create_paragraph("p1", "hello")]);
        assert!(split_paragraph_in_document(&mut doc, "p1", 2));
        assert_eq!(doc.sections[0].paragraphs.len(), 2);
        assert_eq!(para_text(&doc.sections[0].paragraphs[0]), "he");
        assert_eq!(doc.sections[0].paragraphs[0].id, "p1"); // original keeps its id
        assert_eq!(para_text(&doc.sections[0].paragraphs[1]), "llo");
        assert_ne!(doc.sections[0].paragraphs[1].id, "p1"); // new paragraph, fresh id
    }

    #[test]
    fn split_at_start_inserts_empty_before() {
        let mut doc = create_document(vec![create_paragraph("p1", "hello")]);
        split_paragraph_in_document(&mut doc, "p1", 0);
        assert_eq!(doc.sections[0].paragraphs.len(), 2);
        assert_eq!(para_text(&doc.sections[0].paragraphs[0]), "");
        assert_eq!(para_text(&doc.sections[0].paragraphs[1]), "hello");
    }

    #[test]
    fn split_at_end_inserts_empty_after() {
        let mut doc = create_document(vec![create_paragraph("p1", "hello")]);
        split_paragraph_in_document(&mut doc, "p1", 5);
        assert_eq!(doc.sections[0].paragraphs.len(), 2);
        assert_eq!(para_text(&doc.sections[0].paragraphs[0]), "hello");
        assert_eq!(para_text(&doc.sections[0].paragraphs[1]), "");
    }

    #[test]
    fn split_clamps_oversized_offset_to_end() {
        let mut doc = create_document(vec![create_paragraph("p1", "hi")]);
        // offset 999 is longer than the text; treated like end-of-text.
        split_paragraph_in_document(&mut doc, "p1", 999);
        assert_eq!(doc.sections[0].paragraphs.len(), 2);
        assert_eq!(para_text(&doc.sections[0].paragraphs[0]), "hi");
        assert_eq!(para_text(&doc.sections[0].paragraphs[1]), "");
    }

    #[test]
    fn split_unknown_id_is_noop_and_returns_false() {
        let mut doc = create_document(vec![create_paragraph("p1", "hello")]);
        assert!(!split_paragraph_in_document(&mut doc, "nope", 1));
        assert_eq!(doc.sections[0].paragraphs.len(), 1);
    }

    // --- merge_paragraphs_in_document --------------------------------------

    #[test]
    fn merge_adjacent_same_style_concatenates() {
        let mut doc = create_document(vec![
            create_paragraph("p1", "ab"),
            create_paragraph("p2", "cd"),
        ]);
        assert!(merge_paragraphs_in_document(&mut doc, "p1", "p2"));
        assert_eq!(doc.sections[0].paragraphs.len(), 1);
        assert_eq!(para_text(&doc.sections[0].paragraphs[0]), "abcd");
        // Same style -> one merged run.
        assert_eq!(doc.sections[0].paragraphs[0].elements.len(), 1);
    }

    #[test]
    fn merge_adjacent_different_style_keeps_both_runs() {
        let mut doc = create_document(vec![
            create_styled_paragraph("p1", "ab", TextStyle::default()),
            create_styled_paragraph(
                "p2",
                "cd",
                TextStyle {
                    bold: true,
                    italic: false,
                    underline: false,
                    font_size: None,
                },
            ),
        ]);
        assert!(merge_paragraphs_in_document(&mut doc, "p1", "p2"));
        assert_eq!(doc.sections[0].paragraphs.len(), 1);
        assert_eq!(para_text(&doc.sections[0].paragraphs[0]), "abcd");
        // Different styles -> two distinct runs, not concatenated into one.
        assert_eq!(doc.sections[0].paragraphs[0].elements.len(), 2);
        assert!(!doc.sections[0].paragraphs[0].elements[0].text_run.text_style.bold);
        assert!(doc.sections[0].paragraphs[0].elements[1].text_run.text_style.bold);
    }

    #[test]
    fn merge_non_adjacent_returns_false() {
        let mut doc = create_document(vec![
            create_paragraph("p1", "a"),
            create_paragraph("p2", "b"),
            create_paragraph("p3", "c"),
        ]);
        // p1 and p3 are not neighbours; nothing happens.
        assert!(!merge_paragraphs_in_document(&mut doc, "p1", "p3"));
        assert_eq!(doc.sections[0].paragraphs.len(), 3);
    }

    #[test]
    fn merge_unknown_id_returns_false() {
        let mut doc = create_document(vec![
            create_paragraph("p1", "a"),
            create_paragraph("p2", "b"),
        ]);
        assert!(!merge_paragraphs_in_document(&mut doc, "p1", "nope"));
        assert_eq!(doc.sections[0].paragraphs.len(), 2);
    }

    // --- replace_current (history journaling) --------------------------------

    /// Read the concatenated text of the first paragraph in the live document.
    fn first_paragraph_text(state: &AppState) -> String {
        let doc = state.document.lock().unwrap();
        doc.sections[0].paragraphs[0]
            .elements
            .iter()
            .map(|e| e.text_run.content.as_str())
            .collect()
    }

    /// Build a Tauri mock app with a fresh `AppState` managed. Mirrors how
    /// `main.rs` wires the real app (`main.rs` calls `.manage(AppState::new())`).
    /// The returned `App` owns the state; tests obtain a `State` handle via
    /// `app.state::<AppState>()` and keep the `App` alive for the test's
    /// duration so that borrow stays valid.
    fn mock_app_with_state() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .manage(AppState::new())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("failed to build mock app")
    }

    #[test]
    fn replace_current_replaces_the_indexed_match() {
        let app = mock_app_with_state();
        let state = app.state::<AppState>();
        *state.document.lock().unwrap() =
            create_document(vec![create_paragraph("p1", "foo foo")]);

        // Replace the first of the two "foo" matches.
        let result =
            replace_current("foo".to_string(), "bar".to_string(), 0, state.clone()).unwrap();
        // One "foo" remains, so re-search finds exactly one match, and the
        // cursor stays on the same index.
        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.current_index, 0);
        assert_eq!(first_paragraph_text(&state), "bar foo");
    }

    #[test]
    fn replace_current_is_undoable() {
        let app = mock_app_with_state();
        let state = app.state::<AppState>();
        let original = create_document(vec![create_paragraph("p1", "foo foo")]);
        *state.document.lock().unwrap() = original.clone();

        // A single find/replace is journaled as a history delta, so it must be
        // reachable from `undo` (this is the regression: previously
        // `replace_current` never called `push_history_delta`, so a single
        // replace was not undoable).
        replace_current("foo".to_string(), "bar".to_string(), 0, state.clone()).unwrap();
        assert_eq!(first_paragraph_text(&state), "bar foo");

        assert!(state.undo().unwrap());
        assert_eq!(first_paragraph_text(&state), "foo foo");
    }

    #[test]
    fn replace_current_no_match_journals_nothing() {
        let app = mock_app_with_state();
        let state = app.state::<AppState>();
        *state.document.lock().unwrap() =
            create_document(vec![create_paragraph("p1", "foo foo")]);

        // An out-of-range match index performs no replacement and records no
        // history entry, so undo is a no-op that leaves the text untouched.
        let result = replace_current(
            "foo".to_string(),
            "bar".to_string(),
            99,
            state.clone(),
        )
        .unwrap();
        assert!(result.matches.is_empty());
        assert_eq!(result.current_index, -1);
        assert!(!state.undo().unwrap());
        assert_eq!(first_paragraph_text(&state), "foo foo");
    }

    // --- move_section ----------------------------------------------------------

    /// Read the live document's section ids in order (the property every
    /// move/undo assertion in this block checks).
    fn section_ids(state: &AppState) -> Vec<String> {
        state
            .document
            .lock()
            .unwrap()
            .sections
            .iter()
            .map(|s| s.id.clone())
            .collect()
    }

    /// A three-section document [s1, s2, s3], one paragraph each.
    fn three_section_document() -> Document {
        let base = create_document(vec![create_paragraph("p1", "a")]);
        Document {
            sections: vec![
                create_section("s1", vec![create_paragraph("p1", "a")]),
                create_section("s2", vec![create_paragraph("p2", "b")]),
                create_section("s3", vec![create_paragraph("p3", "c")]),
            ],
            ..base
        }
    }

    #[test]
    fn move_section_returns_the_reordered_document() {
        let app = mock_app_with_state();
        let state = app.state::<AppState>();
        *state.document.lock().unwrap() = three_section_document();

        // Move s1 to the end (after s3) — the returned doc AND the live state
        // must both reflect the new order.
        let returned = move_section(
            "s1".to_string(),
            Some("s3".to_string()),
            state.clone(),
        )
        .unwrap();
        assert_eq!(
            returned.sections.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            ["s2", "s3", "s1"]
        );
        assert_eq!(section_ids(&state), ["s2", "s3", "s1"]);
        // The command marks the document modified so autosave picks it up.
        assert!(*state.is_modified.lock().unwrap());
    }

    #[test]
    fn move_section_to_none_moves_to_front() {
        let app = mock_app_with_state();
        let state = app.state::<AppState>();
        *state.document.lock().unwrap() = three_section_document();

        move_section("s2".to_string(), None, state.clone()).unwrap();
        assert_eq!(section_ids(&state), ["s2", "s1", "s3"]);
    }

    #[test]
    fn move_section_is_undoable() {
        let app = mock_app_with_state();
        let state = app.state::<AppState>();
        *state.document.lock().unwrap() = three_section_document();
        let original_ids = section_ids(&state);

        // The move is journaled as a history delta (the whole point of the
        // MoveSection DocOp over a blind reorder), so undo must restore the
        // original order.
        move_section("s1".to_string(), Some("s3".to_string()), state.clone())
            .unwrap();
        assert_eq!(section_ids(&state), ["s2", "s3", "s1"]);

        assert!(state.undo().unwrap());
        assert_eq!(section_ids(&state), original_ids);
    }

    #[test]
    fn move_section_unknown_id_errors_and_leaves_document_untouched() {
        let app = mock_app_with_state();
        let state = app.state::<AppState>();
        *state.document.lock().unwrap() = three_section_document();

        let err = move_section(
            "nope".to_string(),
            Some("s2".to_string()),
            state.clone(),
        )
        .unwrap_err();
        assert!(err.contains("not found"));
        assert_eq!(section_ids(&state), ["s1", "s2", "s3"]);
        // A failed command must not journal a delta: undo has nothing to do.
        assert!(!state.undo().unwrap());
    }

    #[test]
    fn move_section_unknown_destination_leaves_document_untouched() {
        let app = mock_app_with_state();
        let state = app.state::<AppState>();
        *state.document.lock().unwrap() = three_section_document();

        // The destination must be validated BEFORE the remove — the
        // regression this guards: removing first would silently drop s1 from
        // the document on the failed command's error path.
        let err = move_section(
            "s1".to_string(),
            Some("nope".to_string()),
            state.clone(),
        )
        .unwrap_err();
        assert!(err.contains("not found"));
        assert_eq!(section_ids(&state), ["s1", "s2", "s3"]);
        assert!(!state.undo().unwrap());
    }

    #[test]
    fn move_section_self_follow_errors() {
        let app = mock_app_with_state();
        let state = app.state::<AppState>();
        *state.document.lock().unwrap() = three_section_document();

        let err = move_section(
            "s1".to_string(),
            Some("s1".to_string()),
            state.clone(),
        )
        .unwrap_err();
        assert!(err.contains("cannot follow itself"));
        assert_eq!(section_ids(&state), ["s1", "s2", "s3"]);
    }
}
