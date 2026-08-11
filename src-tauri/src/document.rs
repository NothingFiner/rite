use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub title: String,
    pub author: String,
    pub author_contact: String,
    pub has_toc: bool,
    pub has_epigram: bool,
    pub epigram_text: String,
    pub body: Body,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            title: "Untitled".into(),
            author: "Author Name".into(),
            author_contact: "123 Writer's Lane\nNew York, NY 10001\n(555) 123-4567\nauthor@example.com".into(),
            has_toc: false,
            has_epigram: false,
            epigram_text: String::new(),
            body: Body::default(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Body {
    pub content: Vec<Paragraph>,
}

impl Default for Body {
    fn default() -> Self {
        Self {
            content: vec![Paragraph::default()],
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Paragraph {
    pub id: String,
    pub paragraph_style: ParagraphStyle,
    pub elements: Vec<Element>,
    pub left_indent: Option<f32>,
    pub right_indent: Option<f32>,
    pub first_line_indent: Option<f32>,
}

impl Default for Paragraph {
    fn default() -> Self {
        Self {
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
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ParagraphStyle {
    Normal,
    Heading1,
    Heading2,
    Heading3,
    Heading4,
    Heading5,
    Heading6,
}

impl Default for ParagraphStyle {
    fn default() -> Self {
        ParagraphStyle::Normal
    }
}

// Custom deserializer for backward compatibility with old "section"/"chapter" values.
impl<'de> Deserialize<'de> for ParagraphStyle {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        match s.as_str() {
            "normal" => Ok(ParagraphStyle::Normal),
            "heading1" => Ok(ParagraphStyle::Heading1),
            "heading2" => Ok(ParagraphStyle::Heading2),
            "heading3" => Ok(ParagraphStyle::Heading3),
            "heading4" => Ok(ParagraphStyle::Heading4),
            "heading5" => Ok(ParagraphStyle::Heading5),
            "heading6" => Ok(ParagraphStyle::Heading6),
            // Backward compat: old document format
            "section" => Ok(ParagraphStyle::Heading1),
            "chapter" => Ok(ParagraphStyle::Heading2),
            _ => Ok(ParagraphStyle::Normal),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Element {
    pub text_run: TextRun,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextRun {
    pub content: String,
    pub text_style: TextStyle,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TextStyle {
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub font_size: Option<u16>,
}

/// Partial update to a text style: `None` means "leave unchanged".
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TextStyleDelta {
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
    pub font_size: Option<u16>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum Delta {
    TextInsert {
        paragraph_id: String,
        pos: usize,
        text: String,
    },
    TextDelete {
        paragraph_id: String,
        pos: usize,
        len: usize,
    },
    ParagraphInsert {
        after_id: String,
        new_id: String,
        style: ParagraphStyle,
    },
    ParagraphDelete {
        id: String,
    },
    StyleChange {
        paragraph_id: String,
        text_style: TextStyle,
    },
    RenameSection {
        id: String,
        title: String,
    },
    ParagraphUpdate {
        id: String,
        elements: Vec<Element>,
    },
}

/// Stable, invertible operation describing a change between two Document snapshots.
/// Used for version history deltas and side-by-side diff rendering.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case", tag = "type")]
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
        field: MetadataField,
    },
}

/// Metadata fields that can change at the document level.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case", tag = "field")]
pub enum MetadataField {
    Title { old: String, new: String },
    Author { old: String, new: String },
    AuthorContact { old: String, new: String },
    HasToc { old: bool, new: bool },
    HasEpigram { old: bool, new: bool },
    EpigramText { old: String, new: String },
}

/// Compute the sequence of operations that transforms `old` into `new`.
/// Paragraphs are matched by their stable `id`, so moves/reorders are
/// detected as delete+insert pairs rather than modifications.
pub fn compute_doc_ops(old: &Document, new: &Document) -> Vec<DocOp> {
    let mut ops = Vec::new();

    if old.title != new.title {
        ops.push(DocOp::UpdateMetadata {
            field: MetadataField::Title {
                old: old.title.clone(),
                new: new.title.clone(),
            },
        });
    }
    if old.author != new.author {
        ops.push(DocOp::UpdateMetadata {
            field: MetadataField::Author {
                old: old.author.clone(),
                new: new.author.clone(),
            },
        });
    }
    if old.author_contact != new.author_contact {
        ops.push(DocOp::UpdateMetadata {
            field: MetadataField::AuthorContact {
                old: old.author_contact.clone(),
                new: new.author_contact.clone(),
            },
        });
    }
    if old.has_toc != new.has_toc {
        ops.push(DocOp::UpdateMetadata {
            field: MetadataField::HasToc {
                old: old.has_toc,
                new: new.has_toc,
            },
        });
    }
    if old.has_epigram != new.has_epigram {
        ops.push(DocOp::UpdateMetadata {
            field: MetadataField::HasEpigram {
                old: old.has_epigram,
                new: new.has_epigram,
            },
        });
    }
    if old.epigram_text != new.epigram_text {
        ops.push(DocOp::UpdateMetadata {
            field: MetadataField::EpigramText {
                old: old.epigram_text.clone(),
                new: new.epigram_text.clone(),
            },
        });
    }

    let mut i = 0usize;
    let mut j = 0usize;
    let old_len = old.body.content.len();
    let new_len = new.body.content.len();

    while i < old_len || j < new_len {
        if i < old_len
            && j < new_len
            && old.body.content[i].id == new.body.content[j].id
        {
            if old.body.content[i] != new.body.content[j] {
                ops.push(DocOp::UpdateParagraph {
                    id: old.body.content[i].id.clone(),
                    old: old.body.content[i].clone(),
                    new: new.body.content[j].clone(),
                });
            }
            i += 1;
            j += 1;
        } else if j < new_len
            && (i >= old_len
                || !old.body.content.iter().skip(i).any(|p| p.id == new.body.content[j].id))
        {
            let after_id = if j == 0 {
                None
            } else {
                Some(new.body.content[j - 1].id.clone())
            };
            ops.push(DocOp::InsertParagraph {
                after_id,
                paragraph: new.body.content[j].clone(),
            });
            j += 1;
        } else if i < old_len
            && (j >= new_len
                || !new.body.content.iter().skip(j).any(|p| p.id == old.body.content[i].id))
        {
            ops.push(DocOp::DeleteParagraph {
                id: old.body.content[i].id.clone(),
                old: old.body.content[i].clone(),
            });
            i += 1;
        } else {
            // Both paragraphs exist elsewhere in the opposite list: treat as a
            // reorder (delete old[i], insert new[j]). This is functionally
            // correct but not optimal; reordering paragraphs is rare in prose.
            ops.push(DocOp::DeleteParagraph {
                id: old.body.content[i].id.clone(),
                old: old.body.content[i].clone(),
            });
            let after_id = if j == 0 {
                None
            } else {
                Some(new.body.content[j - 1].id.clone())
            };
            ops.push(DocOp::InsertParagraph {
                after_id,
                paragraph: new.body.content[j].clone(),
            });
            i += 1;
            j += 1;
        }
    }

    ops
}

/// Invert a single `DocOp` so that applying the inverse undoes the original.
impl DocOp {
    pub fn invert(&self) -> Self {
        match self {
            DocOp::InsertParagraph { after_id: _, paragraph } => DocOp::DeleteParagraph {
                id: paragraph.id.clone(),
                old: paragraph.clone(),
            },
            DocOp::DeleteParagraph { id: _, old } => DocOp::InsertParagraph {
                after_id: None,
                paragraph: old.clone(),
            },
            DocOp::UpdateParagraph { id, old, new } => DocOp::UpdateParagraph {
                id: id.clone(),
                old: new.clone(),
                new: old.clone(),
            },
            DocOp::UpdateMetadata { field } => DocOp::UpdateMetadata {
                field: match field {
                    MetadataField::Title { old, new } => MetadataField::Title {
                        old: new.clone(),
                        new: old.clone(),
                    },
                    MetadataField::Author { old, new } => MetadataField::Author {
                        old: new.clone(),
                        new: old.clone(),
                    },
                    MetadataField::AuthorContact { old, new } => MetadataField::AuthorContact {
                        old: new.clone(),
                        new: old.clone(),
                    },
                    MetadataField::HasToc { old, new } => MetadataField::HasToc {
                        old: *new,
                        new: *old,
                    },
                    MetadataField::HasEpigram { old, new } => MetadataField::HasEpigram {
                        old: *new,
                        new: *old,
                    },
                    MetadataField::EpigramText { old, new } => MetadataField::EpigramText {
                        old: new.clone(),
                        new: old.clone(),
                    },
                },
            },
        }
    }
}

/// Apply a sequence of `DocOp`s to a document. Each operation validates its
/// `old` state before applying, making the sequence safely invertible.
pub fn apply_doc_ops(doc: &mut Document, ops: &[DocOp]) -> Result<(), String> {
    for op in ops {
        match op {
            DocOp::InsertParagraph { after_id, paragraph } => {
                if let Some(after_id) = after_id {
                    if let Some(idx) = doc.body.content.iter().position(|p| p.id == *after_id) {
                        doc.body.content.insert(idx + 1, paragraph.clone());
                    } else {
                        return Err(format!(
                            "InsertParagraph: after_id {} not found",
                            after_id
                        ));
                    }
                } else {
                    doc.body.content.insert(0, paragraph.clone());
                }
            }
            DocOp::DeleteParagraph { id, old } => {
                if let Some(idx) = doc.body.content.iter().position(|p| p.id == *id) {
                    if &doc.body.content[idx] != old {
                        return Err(format!(
                            "DeleteParagraph: old paragraph at {} does not match current state",
                            id
                        ));
                    }
                    doc.body.content.remove(idx);
                } else {
                    return Err(format!("DeleteParagraph: paragraph {} not found", id));
                }
            }
            DocOp::UpdateParagraph { id, old, new } => {
                if let Some(idx) = doc.body.content.iter().position(|p| p.id == *id) {
                    if &doc.body.content[idx] != old {
                        return Err(format!(
                            "UpdateParagraph: old paragraph at {} does not match current state",
                            id
                        ));
                    }
                    doc.body.content[idx] = new.clone();
                } else {
                    return Err(format!("UpdateParagraph: paragraph {} not found", id));
                }
            }
            DocOp::UpdateMetadata { field } => match field {
                MetadataField::Title { old, new } => {
                    if doc.title != *old {
                        return Err("UpdateMetadata: title does not match old value".into());
                    }
                    doc.title = new.clone();
                }
                MetadataField::Author { old, new } => {
                    if doc.author != *old {
                        return Err("UpdateMetadata: author does not match old value".into());
                    }
                    doc.author = new.clone();
                }
                MetadataField::AuthorContact { old, new } => {
                    if doc.author_contact != *old {
                        return Err(
                            "UpdateMetadata: author_contact does not match old value".into()
                        );
                    }
                    doc.author_contact = new.clone();
                }
                MetadataField::HasToc { old, new } => {
                    if doc.has_toc != *old {
                        return Err("UpdateMetadata: has_toc does not match old value".into());
                    }
                    doc.has_toc = *new;
                }
                MetadataField::HasEpigram { old, new } => {
                    if doc.has_epigram != *old {
                        return Err("UpdateMetadata: has_epigram does not match old value".into());
                    }
                    doc.has_epigram = *new;
                }
                MetadataField::EpigramText { old, new } => {
                    if doc.epigram_text != *old {
                        return Err(
                            "UpdateMetadata: epigram_text does not match old value".into()
                        );
                    }
                    doc.epigram_text = new.clone();
                }
            },
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub paragraph_id: String,
    pub start_offset: usize,
    pub end_offset: usize,
    pub text: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceResult {
    pub matches: Vec<SearchMatch>,
    pub current_index: i32,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_para(id: &str, text: &str) -> Paragraph {
        Paragraph {
            id: id.to_string(),
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
        }
    }

    fn make_doc(content: Vec<Paragraph>) -> Document {
        Document {
            title: "T".to_string(),
            author: "A".to_string(),
            author_contact: "C".to_string(),
            has_toc: false,
            has_epigram: false,
            epigram_text: String::new(),
            body: Body { content },
        }
    }

    #[test]
    fn test_compute_doc_ops_no_changes() {
        let doc = make_doc(vec![make_para("p1", "hello")]);
        let ops = compute_doc_ops(&doc, &doc);
        assert!(ops.is_empty());
    }

    #[test]
    fn test_compute_doc_ops_insert_paragraph() {
        let old = make_doc(vec![make_para("p1", "hello")]);
        let new = make_doc(vec![
            make_para("p1", "hello"),
            make_para("p2", "world"),
        ]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 1);
        assert!(matches!(
            ops[0],
            DocOp::InsertParagraph {
                after_id: Some(_),
                paragraph: Paragraph { id: _, .. }
            }
        ));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_compute_doc_ops_delete_paragraph() {
        let old = make_doc(vec![
            make_para("p1", "hello"),
            make_para("p2", "world"),
        ]);
        let new = make_doc(vec![make_para("p1", "hello")]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 1);
        assert!(matches!(&ops[0], DocOp::DeleteParagraph { id, .. } if id == "p2"));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_compute_doc_ops_update_paragraph() {
        let old = make_doc(vec![make_para("p1", "hello")]);
        let new = make_doc(vec![make_para("p1", "hello world")]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 1);
        assert!(matches!(&ops[0], DocOp::UpdateParagraph { id, .. } if id == "p1"));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_compute_doc_ops_update_metadata() {
        let mut old = make_doc(vec![make_para("p1", "hello")]);
        old.title = "Old Title".to_string();
        let mut new = old.clone();
        new.title = "New Title".to_string();
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 1);
        assert!(matches!(
            ops[0],
            DocOp::UpdateMetadata {
                field: MetadataField::Title { .. }
            }
        ));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_apply_doc_ops_validation_fails_on_mismatch() {
        let mut doc = make_doc(vec![make_para("p1", "hello")]);
        let wrong_old = make_para("p1", "goodbye");
        let ops = vec![DocOp::UpdateParagraph {
            id: "p1".to_string(),
            old: wrong_old,
            new: make_para("p1", "hello world"),
        }];
        assert!(apply_doc_ops(&mut doc, &ops).is_err());
    }
}
