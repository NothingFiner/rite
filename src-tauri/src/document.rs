use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub title: String,
    pub author: String,
    pub author_contact: String,
    // The frontend spells this `hasTOC` (all-caps), which predates the
    // `rename_all = "camelCase"` container attribute. Match the frontend's
    // spelling on the wire so round-tripping a frontend-built doc (import/new,
    // which only ever sets `hasTOC`) doesn't fail deserialization with
    // "missing field hasToc". The `alias` keeps already-saved `.rite` files
    // and history snapshots — which serialize the Rust field as `hasToc` —
    // readable, so this is backward-compatible.
    #[serde(rename = "hasTOC", alias = "hasToc")]
    pub has_toc: bool,
    pub has_epigram: bool,
    pub epigram_text: String,
    /// First-class, flat structural units. Each section owns its body paragraphs
    /// (single source of truth — moving/deleting a section is one array op, no
    /// parallel-structure sync). The editor renders a *flat* DOM and translates
    /// to/from this nested shape on render/sync.
    pub sections: Vec<Section>,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            title: "Untitled".into(),
            author: "Author Name".into(),
            author_contact:
                "123 Writer's Lane\nNew York, NY 10001\n(555) 123-4567\nauthor@example.com".into(),
            has_toc: false,
            has_epigram: false,
            epigram_text: String::new(),
            sections: vec![Section::default()],
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    /// Stable first-class identity (UUID). Preserved across rename/type-change/
    /// restore, which is what lets the delta protocol track a section over time.
    pub id: String,
    /// Subtitle for a `Chapter`; full title for a `Section`. A Chapter's number
    /// is *derived* at render from its position among Chapter-type sections, so
    /// it is never stored here — inserting/deleting a chapter renumbers all
    /// chapters with zero delta churn (no RenameSection cascade).
    pub title: String,
    pub section_type: SectionType,
    pub paragraphs: Vec<Paragraph>,
}

impl Default for Section {
    fn default() -> Self {
        Self {
            id: format!("s-{}", uuid::Uuid::new_v4()),
            title: String::new(),
            section_type: SectionType::Section,
            paragraphs: vec![Paragraph::default()],
        }
    }
}

/// Whether a section gets a derived positional number (`Chapter`) or renders
/// its title verbatim with no number (`Section`). Extensible later for section
/// templates (notes/glossary); today only these two.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SectionType {
    Chapter,
    Section,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Paragraph {
    pub id: String,
    // `paragraph_style` is intentionally gone: headings are now `Section.title`,
    // not paragraphs, so every paragraph is body text. Scene breaks remain
    // content-detected (text === "***" / "#" etc.), not a style. A future
    // scene-break/blockquote style can re-add a field here without reshaping
    // `Paragraph`.
    pub elements: Vec<Element>,
    pub left_indent: Option<f32>,
    pub right_indent: Option<f32>,
    pub first_line_indent: Option<f32>,
}

impl Default for Paragraph {
    fn default() -> Self {
        Self {
            id: format!("p-{}", uuid::Uuid::new_v4()),
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

/// Stable, invertible operation describing a change between two Document
/// snapshots. Used for version-history deltas and undo/redo. Every variant
/// carries its `old` state so `apply_doc_ops` can validate the precondition
/// before mutating and `invert()` can reverse it.
///
/// Chapter numbers are render-derived, so **no variant carries a number** —
/// `InsertSection`/`DeleteSection` carry the section's `title` (subtitle) and
/// `section_type`; renames carry titles; type changes carry types. Renumbering
/// is invisible to the delta protocol.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum DocOp {
    InsertSection {
        after_id: Option<String>,
        section: Section,
    },
    DeleteSection {
        id: String,
        /// Predecessor section id at delete time, so the inverse `InsertSection`
        /// restores the correct position (mirrors the `DeleteParagraph` fix).
        after_id: Option<String>,
        old: Section,
    },
    RenameSection {
        id: String,
        old_title: String,
        new_title: String,
    },
    ChangeSectionType {
        id: String,
        old_type: SectionType,
        new_type: SectionType,
    },
    InsertParagraph {
        section_id: String,
        after_id: Option<String>,
        paragraph: Paragraph,
    },
    DeleteParagraph {
        section_id: String,
        /// Predecessor paragraph id within the section at delete time, so the
        /// inverse `InsertParagraph` restores the correct position. (The
        /// previous model discarded position and always reinserted at index 0,
        /// which mispositioned any non-front delete on undo.)
        after_id: Option<String>,
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
/// Sections are matched by stable `id`; paragraphs within a section are matched
/// by `id`. Reorders are detected as delete+insert pairs (functionally correct,
/// not optimal — reordering is rare in prose).
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
    let old_secs = &old.sections;
    let new_secs = &new.sections;

    while i < old_secs.len() || j < new_secs.len() {
        if i < old_secs.len() && j < new_secs.len() && old_secs[i].id == new_secs[j].id {
            let id = old_secs[i].id.clone();
            if old_secs[i].title != new_secs[j].title {
                ops.push(DocOp::RenameSection {
                    id: id.clone(),
                    old_title: old_secs[i].title.clone(),
                    new_title: new_secs[j].title.clone(),
                });
            }
            if old_secs[i].section_type != new_secs[j].section_type {
                ops.push(DocOp::ChangeSectionType {
                    id: id.clone(),
                    old_type: old_secs[i].section_type,
                    new_type: new_secs[j].section_type,
                });
            }
            ops.extend(compute_paragraph_ops(
                &old_secs[i].paragraphs,
                &new_secs[j].paragraphs,
                &id,
            ));
            i += 1;
            j += 1;
        } else if j < new_secs.len()
            && (i >= old_secs.len() || !old_secs.iter().skip(i).any(|s| s.id == new_secs[j].id))
        {
            let after_id = if j == 0 {
                None
            } else {
                Some(new_secs[j - 1].id.clone())
            };
            ops.push(DocOp::InsertSection {
                after_id,
                section: new_secs[j].clone(),
            });
            j += 1;
        } else if i < old_secs.len()
            && (j >= new_secs.len() || !new_secs.iter().skip(j).any(|s| s.id == old_secs[i].id))
        {
            let after_id = if i == 0 {
                None
            } else {
                Some(old_secs[i - 1].id.clone())
            };
            ops.push(DocOp::DeleteSection {
                id: old_secs[i].id.clone(),
                after_id,
                old: old_secs[i].clone(),
            });
            i += 1;
        } else {
            // Both sections exist elsewhere in the opposite list: treat as a
            // reorder (delete old[i], insert new[j]). Functionally correct but
            // not optimal; reordering sections is rare.
            let after_id = if i == 0 {
                None
            } else {
                Some(old_secs[i - 1].id.clone())
            };
            ops.push(DocOp::DeleteSection {
                id: old_secs[i].id.clone(),
                after_id,
                old: old_secs[i].clone(),
            });
            let ins_after_id = if j == 0 {
                None
            } else {
                Some(new_secs[j - 1].id.clone())
            };
            ops.push(DocOp::InsertSection {
                after_id: ins_after_id,
                section: new_secs[j].clone(),
            });
            i += 1;
            j += 1;
        }
    }

    ops
}

/// Diff the paragraphs within a single section, scoped to `section_id`.
fn compute_paragraph_ops(old: &[Paragraph], new: &[Paragraph], section_id: &str) -> Vec<DocOp> {
    let mut ops = Vec::new();
    let mut i = 0usize;
    let mut j = 0usize;

    while i < old.len() || j < new.len() {
        if i < old.len() && j < new.len() && old[i].id == new[j].id {
            if old[i] != new[j] {
                ops.push(DocOp::UpdateParagraph {
                    id: old[i].id.clone(),
                    old: old[i].clone(),
                    new: new[j].clone(),
                });
            }
            i += 1;
            j += 1;
        } else if j < new.len() && (i >= old.len() || !old.iter().skip(i).any(|p| p.id == new[j].id))
        {
            let after_id = if j == 0 {
                None
            } else {
                Some(new[j - 1].id.clone())
            };
            ops.push(DocOp::InsertParagraph {
                section_id: section_id.to_string(),
                after_id,
                paragraph: new[j].clone(),
            });
            j += 1;
        } else if i < old.len() && (j >= new.len() || !new.iter().skip(j).any(|p| p.id == old[i].id))
        {
            // after_id = predecessor in the OLD section, so undo reinserts at the
            // right spot rather than the front.
            let after_id = if i == 0 {
                None
            } else {
                Some(old[i - 1].id.clone())
            };
            ops.push(DocOp::DeleteParagraph {
                section_id: section_id.to_string(),
                after_id,
                old: old[i].clone(),
            });
            i += 1;
        } else {
            let del_after_id = if i == 0 {
                None
            } else {
                Some(old[i - 1].id.clone())
            };
            ops.push(DocOp::DeleteParagraph {
                section_id: section_id.to_string(),
                after_id: del_after_id,
                old: old[i].clone(),
            });
            let ins_after_id = if j == 0 {
                None
            } else {
                Some(new[j - 1].id.clone())
            };
            ops.push(DocOp::InsertParagraph {
                section_id: section_id.to_string(),
                after_id: ins_after_id,
                paragraph: new[j].clone(),
            });
            i += 1;
            j += 1;
        }
    }

    ops
}

/// Invert a single `DocOp` so applying the inverse undoes the original.
impl DocOp {
    pub fn invert(&self) -> Self {
        match self {
            DocOp::InsertSection {
                after_id: _,
                section,
            } => DocOp::DeleteSection {
                id: section.id.clone(),
                after_id: None,
                old: section.clone(),
            },
            DocOp::DeleteSection {
                id: _,
                after_id,
                old,
            } => DocOp::InsertSection {
                after_id: after_id.clone(),
                section: old.clone(),
            },
            DocOp::RenameSection {
                id,
                old_title,
                new_title,
            } => DocOp::RenameSection {
                id: id.clone(),
                old_title: new_title.clone(),
                new_title: old_title.clone(),
            },
            DocOp::ChangeSectionType {
                id,
                old_type,
                new_type,
            } => DocOp::ChangeSectionType {
                id: id.clone(),
                old_type: *new_type,
                new_type: *old_type,
            },
            DocOp::InsertParagraph {
                section_id,
                after_id: _,
                paragraph,
            } => DocOp::DeleteParagraph {
                section_id: section_id.clone(),
                after_id: None,
                old: paragraph.clone(),
            },
            // The fix: carry `after_id` forward so the inverse insert restores
            // the paragraph's original position, not index 0.
            DocOp::DeleteParagraph {
                section_id,
                after_id,
                old,
            } => DocOp::InsertParagraph {
                section_id: section_id.clone(),
                after_id: after_id.clone(),
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

/// Borrow a section by id for mutation. Returns `None` if not found — the caller
/// must handle that (Rust forces it via `Option`; no null).
pub fn find_section_mut<'a>(doc: &'a mut Document, id: &str) -> Option<&'a mut Section> {
    doc.sections.iter_mut().find(|s| s.id == id)
}

/// Borrow a paragraph by id, searching across all sections. Paragraph ids are
/// globally unique, so no section context is needed for updates.
pub fn find_paragraph_mut<'a>(doc: &'a mut Document, id: &str) -> Option<&'a mut Paragraph> {
    for section in doc.sections.iter_mut() {
        if let Some(p) = section.paragraphs.iter_mut().find(|p| p.id == id) {
            return Some(p);
        }
    }
    None
}

/// Apply a sequence of `DocOp`s to a document. Each op validates its `old`
/// precondition before mutating, so the sequence is safely invertible.
pub fn apply_doc_ops(doc: &mut Document, ops: &[DocOp]) -> Result<(), String> {
    for op in ops {
        match op {
            DocOp::InsertSection { after_id, section } => {
                if let Some(after_id) = after_id {
                    if let Some(idx) = doc.sections.iter().position(|s| s.id == *after_id) {
                        doc.sections.insert(idx + 1, section.clone());
                    } else {
                        return Err(format!("InsertSection: after_id {} not found", after_id));
                    }
                } else {
                    doc.sections.insert(0, section.clone());
                }
            }
            DocOp::DeleteSection {
                id, after_id: _, old,
            } => {
                if let Some(idx) = doc.sections.iter().position(|s| s.id == *id) {
                    if &doc.sections[idx] != old {
                        return Err(format!(
                            "DeleteSection: old section at {} does not match current state",
                            id
                        ));
                    }
                    doc.sections.remove(idx);
                } else {
                    return Err(format!("DeleteSection: section {} not found", id));
                }
            }
            DocOp::RenameSection {
                id,
                old_title,
                new_title,
            } => {
                let section = find_section_mut(doc, id)
                    .ok_or_else(|| format!("RenameSection: section {} not found", id))?;
                if section.title != *old_title {
                    return Err(format!(
                        "RenameSection: old_title does not match current state for {}",
                        id
                    ));
                }
                section.title = new_title.clone();
            }
            DocOp::ChangeSectionType {
                id,
                old_type,
                new_type,
            } => {
                let section = find_section_mut(doc, id)
                    .ok_or_else(|| format!("ChangeSectionType: section {} not found", id))?;
                if section.section_type != *old_type {
                    return Err(format!(
                        "ChangeSectionType: old_type does not match current state for {}",
                        id
                    ));
                }
                section.section_type = *new_type;
            }
            DocOp::InsertParagraph {
                section_id,
                after_id,
                paragraph,
            } => {
                let section = find_section_mut(doc, section_id).ok_or_else(|| {
                    format!("InsertParagraph: section {} not found", section_id)
                })?;
                if let Some(after_id) = after_id {
                    if let Some(idx) = section.paragraphs.iter().position(|p| p.id == *after_id) {
                        section.paragraphs.insert(idx + 1, paragraph.clone());
                    } else {
                        return Err(format!(
                            "InsertParagraph: after_id {} not found in section {}",
                            after_id, section_id
                        ));
                    }
                } else {
                    section.paragraphs.insert(0, paragraph.clone());
                }
            }
            DocOp::DeleteParagraph {
                section_id,
                after_id: _,
                old,
            } => {
                let section = find_section_mut(doc, section_id).ok_or_else(|| {
                    format!("DeleteParagraph: section {} not found", section_id)
                })?;
                if let Some(idx) = section.paragraphs.iter().position(|p| p.id == old.id) {
                    if &section.paragraphs[idx] != old {
                        return Err(format!(
                            "DeleteParagraph: old paragraph at {} does not match current state",
                            old.id
                        ));
                    }
                    section.paragraphs.remove(idx);
                } else {
                    return Err(format!("DeleteParagraph: paragraph {} not found", old.id));
                }
            }
            DocOp::UpdateParagraph { id, old, new } => {
                let paragraph = find_paragraph_mut(doc, id)
                    .ok_or_else(|| format!("UpdateParagraph: paragraph {} not found", id))?;
                if paragraph != old {
                    return Err(format!(
                        "UpdateParagraph: old paragraph at {} does not match current state",
                        id
                    ));
                }
                *paragraph = new.clone();
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
                        return Err("UpdateMetadata: epigram_text does not match old value".into());
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
    pub section_id: String,
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

// ---------------------------------------------------------------------------
// (The legacy pre-sections document format and its migration path were
// removed — there are no surviving flat-`body.content` `.rite` files to
// support. New documents and all saved files use the section-based `Document`
// below.)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn test_compute_doc_ops_no_changes() {
        let doc = create_document(vec![create_section("s1", "Intro", SectionType::Section, vec![
            create_paragraph("p1", "hello"),
        ])]);
        let ops = compute_doc_ops(&doc, &doc);
        assert!(ops.is_empty());
    }

    #[test]
    fn test_compute_doc_ops_insert_section() {
        let old = create_document(vec![create_section("s1", "Intro", SectionType::Section, vec![
            create_paragraph("p1", "hello"),
        ])]);
        let new = create_document(vec![
            create_section("s1", "Intro", SectionType::Section, vec![create_paragraph("p1", "hello")]),
            create_section("s2", "Two", SectionType::Chapter, vec![create_paragraph("p2", "world")]),
        ]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 1);
        assert!(matches!(
            &ops[0],
            DocOp::InsertSection { after_id: Some(_), section: Section { id, .. } } if id == "s2"
        ));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_compute_doc_ops_delete_section() {
        let old = create_document(vec![
            create_section("s1", "Intro", SectionType::Section, vec![create_paragraph("p1", "hello")]),
            create_section("s2", "Two", SectionType::Chapter, vec![create_paragraph("p2", "world")]),
        ]);
        let new = create_document(vec![create_section("s1", "Intro", SectionType::Section, vec![
            create_paragraph("p1", "hello"),
        ])]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 1);
        assert!(matches!(&ops[0], DocOp::DeleteSection { id, .. } if id == "s2"));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_compute_doc_ops_rename_section() {
        let old = create_document(vec![create_section("s1", "Old", SectionType::Section, vec![
            create_paragraph("p1", "hello"),
        ])]);
        let new = create_document(vec![create_section("s1", "New", SectionType::Section, vec![
            create_paragraph("p1", "hello"),
        ])]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 1);
        assert!(matches!(&ops[0], DocOp::RenameSection { id, old_title, new_title }
            if id == "s1" && old_title == "Old" && new_title == "New"));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_compute_doc_ops_change_section_type() {
        let old = create_document(vec![create_section("s1", "X", SectionType::Section, vec![
            create_paragraph("p1", "hello"),
        ])]);
        let new = create_document(vec![create_section("s1", "X", SectionType::Chapter, vec![
            create_paragraph("p1", "hello"),
        ])]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 1);
        assert!(matches!(&ops[0], DocOp::ChangeSectionType { id, old_type, new_type }
            if id == "s1" && *old_type == SectionType::Section && *new_type == SectionType::Chapter));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_compute_doc_ops_insert_paragraph() {
        let old = create_document(vec![create_section("s1", "Intro", SectionType::Section, vec![
            create_paragraph("p1", "hello"),
        ])]);
        let new = create_document(vec![create_section("s1", "Intro", SectionType::Section, vec![
            create_paragraph("p1", "hello"),
            create_paragraph("p2", "world"),
        ])]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 1);
        assert!(matches!(
            &ops[0],
            DocOp::InsertParagraph { section_id, after_id: Some(_), paragraph: Paragraph { id, .. } }
                if section_id == "s1" && id == "p2"
        ));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_compute_doc_ops_delete_paragraph() {
        let old = create_document(vec![create_section("s1", "Intro", SectionType::Section, vec![
            create_paragraph("p1", "hello"),
            create_paragraph("p2", "world"),
        ])]);
        let new = create_document(vec![create_section("s1", "Intro", SectionType::Section, vec![
            create_paragraph("p1", "hello"),
        ])]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 1);
        assert!(matches!(
            &ops[0],
            DocOp::DeleteParagraph { section_id, old: Paragraph { id, .. }, .. }
                if section_id == "s1" && id == "p2"
        ));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_compute_doc_ops_update_paragraph() {
        let old = create_document(vec![create_section("s1", "Intro", SectionType::Section, vec![
            create_paragraph("p1", "hello"),
        ])]);
        let new = create_document(vec![create_section("s1", "Intro", SectionType::Section, vec![
            create_paragraph("p1", "hello world"),
        ])]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 1);
        assert!(matches!(&ops[0], DocOp::UpdateParagraph { id, .. } if id == "p1"));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_compute_doc_ops_update_metadata() {
        let mut old = create_document(vec![create_section("s1", "Intro", SectionType::Section, vec![
            create_paragraph("p1", "hello"),
        ])]);
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
        let mut doc = create_document(vec![create_section("s1", "Intro", SectionType::Section, vec![
            create_paragraph("p1", "hello"),
        ])]);
        let wrong_old = create_paragraph("p1", "goodbye");
        let ops = vec![DocOp::UpdateParagraph {
            id: "p1".to_string(),
            old: wrong_old,
            new: create_paragraph("p1", "hello world"),
        }];
        assert!(apply_doc_ops(&mut doc, &ops).is_err());
    }

    #[test]
    fn test_delete_paragraph_invert_restores_position() {
        // Deleting a middle paragraph and inverting must reinsert it in the
        // middle, not at index 0 (the pre-fix behavior).
        let mut doc = create_document(vec![create_section("s1", "S", SectionType::Section, vec![
            create_paragraph("p1", "one"),
            create_paragraph("p2", "two"),
            create_paragraph("p3", "three"),
        ])]);
        let original = doc.clone();
        let op = DocOp::DeleteParagraph {
            section_id: "s1".to_string(),
            after_id: Some("p1".to_string()),
            old: create_paragraph("p2", "two"),
        };
        apply_doc_ops(&mut doc, &[op.clone()]).unwrap();
        // p2 removed
        assert_eq!(doc.sections[0].paragraphs.len(), 2);
        assert_eq!(doc.sections[0].paragraphs[0].id, "p1");
        assert_eq!(doc.sections[0].paragraphs[1].id, "p3");

        // Invert and apply → should restore the original ordering exactly.
        let inv = op.invert();
        apply_doc_ops(&mut doc, &[inv]).unwrap();
        assert_eq!(doc, original);
    }
}