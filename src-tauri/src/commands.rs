use crate::document::{
    Delta, Document, Element, Paragraph, ParagraphStyle, ReplaceResult, SearchMatch, TextRun,
    TextStyleDelta,
};
use crate::state::AppState;
use regex::Regex;
use std::fs;
use tauri::State;

#[tauri::command]
pub fn get_document(state: State<AppState>) -> Result<Document, String> {
    let doc = state.document.lock().map_err(|e| e.to_string())?;
    Ok(doc.clone())
}

#[tauri::command]
pub fn apply_delta(delta: Delta, state: State<AppState>) -> Result<Document, String> {
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;

    match delta {
        Delta::TextInsert { paragraph_id, pos, text } => {
            if let Some(para) = doc.body.content.iter_mut().find(|p| p.id == paragraph_id) {
                if let Some(first) = para.elements.first_mut() {
                    let content = &mut first.text_run.content;
                    if pos <= content.len() {
                        content.insert_str(pos, &text);
                    }
                }
            }
        }
        Delta::TextDelete { paragraph_id, pos, len } => {
            if let Some(para) = doc.body.content.iter_mut().find(|p| p.id == paragraph_id) {
                if let Some(first) = para.elements.first_mut() {
                    let content = &mut first.text_run.content;
                    let end = (pos + len).min(content.len());
                    content.replace_range(pos..end, "");
                }
            }
        }
        Delta::ParagraphInsert { after_id, new_id, style } => {
            if let Some(idx) = doc.body.content.iter().position(|p| p.id == after_id) {
                let new_para = Paragraph {
                    id: new_id,
                    paragraph_style: style,
                    elements: vec![Element { text_run: TextRun { content: String::new(), text_style: Default::default() } }],
                    left_indent: None,
                    right_indent: None,
                    first_line_indent: None,
                };
                doc.body.content.insert(idx + 1, new_para);
            }
        }
        Delta::ParagraphDelete { id } => {
            if let Some(idx) = doc.body.content.iter().position(|p| p.id == id) {
                doc.body.content.remove(idx);
            }
        }
        Delta::StyleChange { paragraph_id, text_style } => {
            if let Some(para) = doc.body.content.iter_mut().find(|p| p.id == paragraph_id) {
                if let Some(first) = para.elements.first_mut() {
                    first.text_run.text_style = text_style;
                }
            }
        }
        Delta::RenameSection { id, title } => {
            if let Some(para) = doc.body.content.iter_mut().find(|p| p.id == id) {
                para.elements = vec![Element { text_run: TextRun { content: title, text_style: Default::default() } }];
            }
        }
        Delta::ParagraphUpdate { id, elements } => {
            if let Some(para) = doc.body.content.iter_mut().find(|p| p.id == id) {
                para.elements = elements;
            }
        }
    }

    *modified = true;
    drop(doc);
    state.push_history_delta(&old_doc);
    let doc = state.document.lock().map_err(|e| e.to_string())?;
    Ok(doc.clone())
}

#[tauri::command]
pub fn insert_heading(
    level: u8,
    after_id: Option<String>,
    state: State<AppState>,
) -> Result<Document, String> {
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;

    let style = match level {
        1 => ParagraphStyle::Heading1,
        2 => ParagraphStyle::Heading2,
        3 => ParagraphStyle::Heading3,
        4 => ParagraphStyle::Heading4,
        5 => ParagraphStyle::Heading5,
        6 => ParagraphStyle::Heading6,
        _ => ParagraphStyle::Normal,
    };

    let new_id = format!("p-{}", uuid::Uuid::new_v4());
    let new_para = Paragraph {
        id: new_id.clone(),
        paragraph_style: style,
        elements: vec![Element { text_run: TextRun { content: String::new(), text_style: Default::default() } }],
        left_indent: None,
        right_indent: None,
        first_line_indent: None,
    };

    if let Some(id) = after_id {
        if let Some(idx) = doc.body.content.iter().position(|p| p.id == id) {
            doc.body.content.insert(idx + 1, new_para);
        } else {
            doc.body.content.push(new_para);
        }
    } else {
        doc.body.content.push(new_para);
    }

    *modified = true;
    drop(doc);
    state.push_history_delta(&old_doc);
    let doc = state.document.lock().map_err(|e| e.to_string())?;
    Ok(doc.clone())
}

#[tauri::command]
pub fn delete_heading(id: String, state: State<AppState>) -> Result<Document, String> {
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;

    if let Some(idx) = doc.body.content.iter().position(|p| p.id == id) {
        doc.body.content.remove(idx);
    }

    *modified = true;
    drop(doc);
    state.push_history_delta(&old_doc);
    let doc = state.document.lock().map_err(|e| e.to_string())?;
    Ok(doc.clone())
}

#[tauri::command]
pub fn rename_section(id: String, title: String, state: State<AppState>) -> Result<Document, String> {
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;

    if let Some(para) = doc.body.content.iter_mut().find(|p| p.id == id) {
        para.elements = vec![Element { text_run: TextRun { content: title, text_style: Default::default() } }];
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

    for para in &doc.body.content {
        let text: String = para.elements.iter().map(|e| e.text_run.content.as_str()).collect();
        for m in re.find_iter(&text) {
            let start_offset = text[..m.start()].chars().count();
            let end_offset = text[..m.end()].chars().count();
            matches.push(SearchMatch {
                paragraph_id: para.id.clone(),
                start_offset,
                end_offset,
                text: m.as_str().to_string(),
            });
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
    let _old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;

    let pattern = regex::escape(&query);
    let re = Regex::new(&format!("(?i){}", pattern)).map_err(|e| e.to_string())?;

    // Find all matches with char offsets
    let mut matches = Vec::new();
    for para in &doc.body.content {
        let text: String = para.elements.iter().map(|e| e.text_run.content.as_str()).collect();
        for m in re.find_iter(&text) {
            let start_offset = text[..m.start()].chars().count();
            let end_offset = text[..m.end()].chars().count();
            matches.push((para.id.clone(), start_offset, end_offset));
        }
    }

    if match_index >= matches.len() {
        return Ok(ReplaceResult {
            matches: vec![],
            current_index: -1,
        });
    }

    let (para_id, m_start, m_end) = &matches[match_index];
    if let Some(para) = doc.body.content.iter_mut().find(|p| p.id == *para_id) {
        let full_text: String = para.elements.iter().map(|e| e.text_run.content.clone()).collect();
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
    for para in &doc.body.content {
        let text: String = para.elements.iter().map(|e| e.text_run.content.as_str()).collect();
        for m in re.find_iter(&text) {
            let start_offset = text[..m.start()].chars().count();
            let end_offset = text[..m.end()].chars().count();
            new_matches.push(SearchMatch {
                paragraph_id: para.id.clone(),
                start_offset,
                end_offset,
                text: query.clone(),
            });
        }
    }

    let new_index = if match_index < new_matches.len() {
        match_index as i32
    } else if new_matches.is_empty() {
        -1
    } else {
        new_matches.len() as i32 - 1
    };

    Ok(ReplaceResult {
        matches: new_matches,
        current_index: new_index,
    })
}

#[tauri::command]
pub fn replace_all(query: String, replacement: String, state: State<AppState>) -> Result<u32, String> {
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;
    let mut count = 0u32;

    let pattern = regex::escape(&query);
    let re = Regex::new(&format!("(?i){}", pattern)).map_err(|e| e.to_string())?;

    for para in doc.body.content.iter_mut() {
        for el in para.elements.iter_mut() {
            let content = &mut el.text_run.content;
            let new_content = re.replace_all(content, replacement.as_str()).to_string();
            if new_content != *content {
                count += re.find_iter(content).count() as u32;
                *content = new_content;
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
pub fn save_document(path: String, state: State<AppState>) -> Result<(), String> {
    let doc = state.document.lock().map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&*doc).map_err(|e| e.to_string())?;
    let tmp_path = format!("{}.tmp", path);
    fs::write(&tmp_path, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|e| e.to_string())?;

    let mut last_path = state.last_path.lock().map_err(|e| e.to_string())?;
    *last_path = Some(path);

    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;
    *modified = false;

    Ok(())
}

#[tauri::command]
pub fn open_document(path: String, state: State<AppState>) -> Result<Document, String> {
    let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let doc: Document = serde_json::from_str(&json).map_err(|e| e.to_string())?;

    let mut state_doc = state.document.lock().map_err(|e| e.to_string())?;
    *state_doc = doc.clone();
    drop(state_doc);

    state.reset_history();

    let mut last_path = state.last_path.lock().map_err(|e| e.to_string())?;
    *last_path = Some(path);

    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;
    *modified = false;

    Ok(doc)
}

#[tauri::command]
pub fn sync_document(data: Document, state: State<AppState>) -> Result<(), String> {
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;
    *doc = data;
    *modified = true;
    Ok(())
}

#[tauri::command]
pub fn autosave(state: State<AppState>) -> Result<(), String> {
    let modified = state.is_modified.lock().map_err(|e| e.to_string())?;
    if !*modified {
        return Ok(());
    }

    let last_path = state.last_path.lock().map_err(|e| e.to_string())?;
    if let Some(path) = last_path.clone() {
        drop(modified);
        drop(last_path);
        save_document(path, state)?;
    }
    Ok(())
}

fn apply_format_to_paragraph(
    para: &mut Paragraph,
    start: usize,
    end: usize,
    format: &TextStyleDelta,
) -> Result<(), String> {
    let full_text: String = para.elements.iter().map(|e| e.text_run.content.clone()).collect();
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
            if let Some(bold) = format.bold {
                middle_style.bold = bold;
            }
            if let Some(italic) = format.italic {
                middle_style.italic = italic;
            }
            if let Some(underline) = format.underline {
                middle_style.underline = underline;
            }
            if let Some(font_size) = format.font_size {
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

#[tauri::command]
pub fn apply_format(
    paragraph_id: String,
    start_offset: usize,
    end_offset: usize,
    format: TextStyleDelta,
    state: State<AppState>,
) -> Result<Document, String> {
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;

    if let Some(para) = doc.body.content.iter_mut().find(|p| p.id == paragraph_id) {
        apply_format_to_paragraph(para, start_offset, end_offset, &format)?;
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

    if let Some(idx) = doc.body.content.iter().position(|p| p.id == paragraph_id) {
        let para = &doc.body.content[idx];
        let full_text: String = para.elements.iter().map(|e| e.text_run.content.clone()).collect();
        let char_count = full_text.chars().count();
        let offset = offset.min(char_count);

        if offset == 0 || offset == char_count {
            let new_para = Paragraph {
                id: format!("p-{}", uuid::Uuid::new_v4()),
                paragraph_style: ParagraphStyle::Normal,
                elements: vec![Element {
                    text_run: TextRun {
                        content: String::new(),
                        text_style: Default::default(),
                    },
                }],
                left_indent: None,
                right_indent: None,
                first_line_indent: None,
            };
            let insert_idx = if offset == 0 { idx } else { idx + 1 };
            doc.body.content.insert(insert_idx, new_para);
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

            let style = para.paragraph_style.clone();
            let left_indent = para.left_indent;
            let right_indent = para.right_indent;
            let first_line_indent = para.first_line_indent;

            let before_para = Paragraph {
                id: para.id.clone(),
                paragraph_style: style.clone(),
                elements: before_elements,
                left_indent,
                right_indent,
                first_line_indent,
            };

            let after_para = Paragraph {
                id: format!("p-{}", uuid::Uuid::new_v4()),
                paragraph_style: ParagraphStyle::Normal,
                elements: after_elements,
                left_indent: None,
                right_indent: None,
                first_line_indent: None,
            };

            doc.body.content[idx] = before_para;
            doc.body.content.insert(idx + 1, after_para);
        }
    }

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

    let first_idx = doc.body.content.iter().position(|p| p.id == first_id);
    let second_idx = doc.body.content.iter().position(|p| p.id == second_id);

    if let (Some(first_idx), Some(second_idx)) = (first_idx, second_idx) {
        if second_idx == first_idx + 1 {
            let second = doc.body.content.remove(second_idx);
            let first = &mut doc.body.content[first_idx];

            for el in second.elements {
                if let Some(last) = first.elements.last_mut() {
                    if last.text_run.text_style == el.text_run.text_style {
                        last.text_run.content.push_str(&el.text_run.content);
                        continue;
                    }
                }
                first.elements.push(el);
            }
        }
    }

    *modified = true;
    drop(doc);
    state.push_history_delta(&old_doc);
    let doc = state.document.lock().map_err(|e| e.to_string())?;
    Ok(doc.clone())
}

#[tauri::command]
pub fn set_paragraph_style(
    paragraph_id: String,
    style: ParagraphStyle,
    state: State<AppState>,
) -> Result<Document, String> {
    let old_doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let mut doc = state.document.lock().map_err(|e| e.to_string())?;
    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;

    if let Some(para) = doc.body.content.iter_mut().find(|p| p.id == paragraph_id) {
        para.paragraph_style = style;
    }

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
