use serde::{Deserialize, Serialize};
use std::collections::HashSet;

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
    /// When true the section renders NO heading — in the manuscript, the
    /// exports, and the printed TOC — but its body text still renders and it
    /// still starts its own page (the every-section-forces-a-page-break rule
    /// is unchanged). Purpose: a section named "Epigram"/"Dedication" whose
    /// title must not render as a header. The editor still shows the title
    /// div (dimmed) so it can be selected/renamed/re-toggled, and the nav
    /// drawer still lists it.
    ///
    /// `#[serde(default)]` because serde is strict by default — a missing key
    /// in the JSON is a hard deserialization error. With `default`, any
    /// section without `"hidden"` (every `.rite` written before this field
    /// existed, any importer that doesn't set it) reads as `false`.
    #[serde(default)]
    pub hidden: bool,
    pub paragraphs: Vec<Paragraph>,
}

impl Default for Section {
    fn default() -> Self {
        Self {
            id: format!("s-{}", uuid::Uuid::new_v4()),
            title: String::new(),
            section_type: SectionType::Section,
            hidden: false,
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
/// `section_type`; renames carry titles; type changes carry types; moves carry
/// before/after predecessor ids. Renumbering
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
    MoveSection {
        id: String,
        /// Predecessor section id in the OLD position, so `invert` can swap
        /// the two ids and produce a reverse move without re-reading the
        /// document (mirrors the `after_id`-carried-for-invert pattern of
        /// `DeleteSection`/`DeleteParagraph`). Unused by `apply`.
        from_after_id: Option<String>,
        /// New position: insert after this section id, or at the front when
        /// `None`.
        to_after_id: Option<String>,
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
    ChangeSectionHidden {
        id: String,
        old_hidden: bool,
        new_hidden: bool,
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
}

/// Compute the sequence of operations that transforms `old` into `new`.
/// Sections are matched by stable `id`; paragraphs within a section are matched
/// by `id`. A section that exists in both lists at a different position is a
/// MOVE: emitted as a single `MoveSection` (never a delete+insert pair — the
/// old pair interleaved a blind positional insert with a delete-by-first-id,
/// and forward replay of that pair cancelled itself, so redo silently no-oped
/// and journaled history reconstructed the wrong order).
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

    let mut i = 0usize;
    let mut j = 0usize;
    let old_secs = &old.sections;
    let new_secs = &new.sections;
    // Ids already emitted as a `MoveSection` in this batch. The old cursor
    // walks past such a section again later (it advanced only `j` at emit
    // time); without this set it would emit a spurious `DeleteSection` for a
    // section that merely moved.
    let mut moved: HashSet<String> = HashSet::new();
    // The section ids in INTERMEDIATE order — the state of the document as
    // the emitted ops apply one by one (starts as `old`). Two jobs:
    //   (1) the else branch stamps `from_after_id` from `sim`, NOT from the
    //       old list: an earlier move in the same batch changes a section's
    //       actual predecessor, and `invert` must move it back to where it
    //       REALLY sat at apply time — a stale old-list predecessor makes the
    //       inverse an identity and undo silently stops restoring the order;
    //   (2) invariant kept by every branch: after the walk processes
    //       new[0..j), sim[0..j) == new[0..j) — so the else branch's move can
    //       always drop the section at index j.
    let mut sim: Vec<String> = old_secs.iter().map(|s| s.id.clone()).collect();

    while i < old_secs.len() || j < new_secs.len() {
        // Skip old sections already handled by an earlier MoveSection: their
        // new position (and content diff) was emitted when the new cursor
        // first encountered them.
        if i < old_secs.len() && moved.contains(&old_secs[i].id) {
            i += 1;
            continue;
        }
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
            if old_secs[i].hidden != new_secs[j].hidden {
                ops.push(DocOp::ChangeSectionHidden {
                    id: id.clone(),
                    old_hidden: old_secs[i].hidden,
                    new_hidden: new_secs[j].hidden,
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
            sim.insert(j, new_secs[j].id.clone());
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
            if let Some(sim_idx) = sim.iter().position(|id| id == &old_secs[i].id) {
                sim.remove(sim_idx);
            }
            i += 1;
        } else {
            // Both sections exist elsewhere in the opposite list: `new[j]`
            // MOVED. Emit a single MoveSection (not delete+insert — see the
            // fn doc), diff its content against its old occurrence right here
            // (MoveSection carries no content, so rename/type/paragraph
            // changes must ride in the same batch), and advance ONLY the new
            // cursor: the old occurrence is skipped later via `moved`.
            let old_idx = old_secs
                .iter()
                .position(|s| s.id == new_secs[j].id)
                .expect("else branch is only reached when the id exists in old");
            // The predecessor in the INTERMEDIATE state (see `sim` above) —
            // this is where the section REALLY sits when the op applies.
            let sim_idx = sim
                .iter()
                .position(|id| id == &new_secs[j].id)
                .expect("else branch is only reached when the id exists in the intermediate state");
            let from_after_id = if sim_idx == 0 {
                None
            } else {
                Some(sim[sim_idx - 1].clone())
            };
            let to_after_id = if j == 0 {
                None
            } else {
                Some(new_secs[j - 1].id.clone())
            };
            ops.push(DocOp::MoveSection {
                id: new_secs[j].id.clone(),
                from_after_id,
                to_after_id,
            });
            sim.remove(sim_idx);
            sim.insert(j, new_secs[j].id.clone());
            let id = new_secs[j].id.clone();
            if old_secs[old_idx].title != new_secs[j].title {
                ops.push(DocOp::RenameSection {
                    id: id.clone(),
                    old_title: old_secs[old_idx].title.clone(),
                    new_title: new_secs[j].title.clone(),
                });
            }
            if old_secs[old_idx].section_type != new_secs[j].section_type {
                ops.push(DocOp::ChangeSectionType {
                    id: id.clone(),
                    old_type: old_secs[old_idx].section_type,
                    new_type: new_secs[j].section_type,
                });
            }
            if old_secs[old_idx].hidden != new_secs[j].hidden {
                ops.push(DocOp::ChangeSectionHidden {
                    id: id.clone(),
                    old_hidden: old_secs[old_idx].hidden,
                    new_hidden: new_secs[j].hidden,
                });
            }
            ops.extend(compute_paragraph_ops(
                &old_secs[old_idx].paragraphs,
                &new_secs[j].paragraphs,
                &id,
            ));
            moved.insert(id);
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
            // A move inverts to the reverse move: the old position becomes
            // the new destination. Swapping the ids is enough because `apply`
            // never reads `from_after_id` — only invert does.
            DocOp::MoveSection {
                id,
                from_after_id,
                to_after_id,
            } => DocOp::MoveSection {
                id: id.clone(),
                from_after_id: to_after_id.clone(),
                to_after_id: from_after_id.clone(),
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
            DocOp::ChangeSectionHidden {
                id,
                old_hidden,
                new_hidden,
            } => DocOp::ChangeSectionHidden {
                id: id.clone(),
                old_hidden: *new_hidden,
                new_hidden: *old_hidden,
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
            DocOp::MoveSection {
                id,
                from_after_id: _,
                to_after_id,
            } => {
                let from_idx = doc
                    .sections
                    .iter()
                    .position(|s| s.id == *id)
                    .ok_or_else(|| format!("MoveSection: section {} not found", id))?;
                // A section can't follow itself — `to_after_id == id` would
                // otherwise remove the section and reinsert it relative to
                // its own (now gone) position, silently corrupting the order.
                if to_after_id.as_deref() == Some(id.as_str()) {
                    return Err(format!("MoveSection: section {} cannot follow itself", id));
                }
                // Validate the destination BEFORE mutating: apply_doc_ops'
                // contract is precondition-first (see the fn doc) — a failed
                // op must leave the document untouched, so the removal below
                // only happens once the destination is known to exist.
                if let Some(to_after_id) = to_after_id {
                    if !doc.sections.iter().any(|s| s.id == *to_after_id) {
                        return Err(format!(
                            "MoveSection: to_after_id {} not found",
                            to_after_id
                        ));
                    }
                }
                let section = doc.sections.remove(from_idx);
                if let Some(to_after_id) = to_after_id {
                    let to_idx = doc
                        .sections
                        .iter()
                        .position(|s| s.id == *to_after_id)
                        .expect("destination validated above");
                    doc.sections.insert(to_idx + 1, section);
                } else {
                    doc.sections.insert(0, section);
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
            DocOp::ChangeSectionHidden {
                id,
                old_hidden,
                new_hidden,
            } => {
                let section = find_section_mut(doc, id)
                    .ok_or_else(|| format!("ChangeSectionHidden: section {} not found", id))?;
                if section.hidden != *old_hidden {
                    return Err(format!(
                        "ChangeSectionHidden: old_hidden does not match current state for {}",
                        id
                    ));
                }
                section.hidden = *new_hidden;
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
    fn test_compute_doc_ops_change_section_hidden() {
        let mut hidden_section = create_section("s1", "Epigram", SectionType::Section, vec![
            create_paragraph("p1", "quote"),
        ]);
        hidden_section.hidden = true;
        let old = create_document(vec![create_section("s1", "Epigram", SectionType::Section, vec![
            create_paragraph("p1", "quote"),
        ])]);
        let new = create_document(vec![hidden_section]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 1);
        assert!(matches!(&ops[0], DocOp::ChangeSectionHidden { id, old_hidden, new_hidden }
            if id == "s1" && !*old_hidden && *new_hidden));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_compute_doc_ops_hidden_change_rides_with_move() {
        // A moved section that also toggled hidden: MoveSection carries no
        // content, so the hidden change must ride in the same batch — the
        // same rationale as the existing rename/type ride-along.
        let mut moved_and_hidden = create_section("s1", "One", SectionType::Section, vec![
            create_paragraph("p1", "a"),
        ]);
        moved_and_hidden.hidden = true;
        let old = create_document(vec![
            create_section("s1", "One", SectionType::Section, vec![create_paragraph("p1", "a")]),
            create_section("s2", "Two", SectionType::Section, vec![create_paragraph("p2", "b")]),
        ]);
        let new = create_document(vec![
            create_section("s2", "Two", SectionType::Section, vec![create_paragraph("p2", "b")]),
            moved_and_hidden,
        ]);
        let ops = compute_doc_ops(&old, &new);
        assert!(ops.len() >= 2);
        // The walk normalizes "move s1 to the end" as "move s2 to the front"
        // (same as test_move_first_section_to_end), so the MoveSection may
        // target either id — what matters is that the hidden change rides in
        // the SAME batch rather than being dropped.
        assert!(ops.iter().any(|op| matches!(op, DocOp::MoveSection { .. })));
        assert!(ops.iter().any(|op| matches!(op,
            DocOp::ChangeSectionHidden { id, old_hidden, new_hidden }
                if id == "s1" && !*old_hidden && *new_hidden)));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_change_section_hidden_invert_round_trips() {
        let mut hidden_section = create_section("s1", "Epigram", SectionType::Section, vec![
            create_paragraph("p1", "quote"),
        ]);
        hidden_section.hidden = true;
        let old = create_document(vec![create_section("s1", "Epigram", SectionType::Section, vec![
            create_paragraph("p1", "quote"),
        ])]);
        let new = create_document(vec![hidden_section]);
        let ops = compute_doc_ops(&old, &new);

        let mut doc = old.clone();
        apply_doc_ops(&mut doc, &ops).unwrap();
        assert_eq!(doc, new);

        let inverted: Vec<DocOp> = ops.iter().rev().map(|op| op.invert()).collect();
        apply_doc_ops(&mut doc, &inverted).unwrap();
        assert_eq!(doc, old);

        apply_doc_ops(&mut doc, &ops).unwrap();
        assert_eq!(doc, new);
    }

    #[test]
    fn test_apply_change_section_hidden_validates_precondition() {
        let mut doc = create_document(vec![create_section("s1", "X", SectionType::Section, vec![
            create_paragraph("p1", "hello"),
        ])]);
        let before = doc.clone();

        // old_hidden says true but the section is currently visible → error,
        // and the document is left untouched.
        let op = DocOp::ChangeSectionHidden {
            id: "s1".to_string(),
            old_hidden: true,
            new_hidden: false,
        };
        let result = apply_doc_ops(&mut doc, &[op]);
        assert!(result.is_err());
        assert_eq!(doc, before);

        // Unknown section id → error.
        let op = DocOp::ChangeSectionHidden {
            id: "nope".to_string(),
            old_hidden: false,
            new_hidden: true,
        };
        assert!(apply_doc_ops(&mut doc, &[op]).is_err());
        assert_eq!(doc, before);
    }

    #[test]
    fn test_hidden_survives_insert_delete_roundtrip() {
        // InsertSection carries the WHOLE section, so hidden round-trips
        // through insert; inverting it yields DeleteSection whose full-
        // Section-equality precondition must match the hidden section —
        // undoing a delete of a hidden section restores it hidden.
        let mut hidden_section = create_section("s9", "Epigram", SectionType::Section, vec![
            create_paragraph("p9", "quote"),
        ]);
        hidden_section.hidden = true;
        let old = create_document(vec![create_section("s1", "One", SectionType::Section, vec![
            create_paragraph("p1", "a"),
        ])]);
        let new = create_document(vec![
            create_section("s1", "One", SectionType::Section, vec![create_paragraph("p1", "a")]),
            hidden_section,
        ]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 1);
        assert!(matches!(&ops[0], DocOp::InsertSection { section, .. } if section.hidden));

        let mut doc = old.clone();
        apply_doc_ops(&mut doc, &ops).unwrap();
        assert_eq!(doc, new);

        let inverted: Vec<DocOp> = ops.iter().rev().map(|op| op.invert()).collect();
        apply_doc_ops(&mut doc, &inverted).unwrap();
        assert_eq!(doc, old);
    }

    #[test]
    fn test_compute_doc_ops_swap_sections_emits_single_move() {
        // The regression the old code failed: this used to emit an
        // interleaved delete+insert pair whose forward replay cancelled
        // itself (reconstructed the OLD order, so redo silently no-oped).
        let old = create_document(vec![
            create_section("s1", "One", SectionType::Chapter, vec![create_paragraph("p1", "a")]),
            create_section("s2", "Two", SectionType::Chapter, vec![create_paragraph("p2", "b")]),
        ]);
        let new = create_document(vec![
            create_section("s2", "Two", SectionType::Chapter, vec![create_paragraph("p2", "b")]),
            create_section("s1", "One", SectionType::Chapter, vec![create_paragraph("p1", "a")]),
        ]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 1);
        assert!(matches!(
            &ops[0],
            DocOp::MoveSection { id, from_after_id, to_after_id }
                if id == "s2"
                    && from_after_id.as_deref() == Some("s1")
                    && to_after_id.is_none()
        ));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_compute_doc_ops_full_reversal_emits_two_moves() {
        let old = create_document(vec![
            create_section("s1", "One", SectionType::Section, vec![create_paragraph("p1", "a")]),
            create_section("s2", "Two", SectionType::Section, vec![create_paragraph("p2", "b")]),
            create_section("s3", "Three", SectionType::Section, vec![create_paragraph("p3", "c")]),
        ]);
        let new = create_document(vec![
            create_section("s3", "Three", SectionType::Section, vec![create_paragraph("p3", "c")]),
            create_section("s2", "Two", SectionType::Section, vec![create_paragraph("p2", "b")]),
            create_section("s1", "One", SectionType::Section, vec![create_paragraph("p1", "a")]),
        ]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 2);
        assert!(matches!(&ops[0], DocOp::MoveSection { id, to_after_id, .. }
            if id == "s3" && to_after_id.is_none()));
        assert!(matches!(&ops[1], DocOp::MoveSection { id, to_after_id, .. }
            if id == "s2" && to_after_id.as_deref() == Some("s3")));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_compute_doc_ops_move_plus_insert() {
        // A moved section and a brand-new section in one batch: the new
        // section inserts, the existing one moves — no spurious delete.
        let old = create_document(vec![
            create_section("s1", "One", SectionType::Section, vec![create_paragraph("p1", "a")]),
            create_section("s2", "Two", SectionType::Section, vec![create_paragraph("p2", "b")]),
            create_section("s3", "Three", SectionType::Section, vec![create_paragraph("p3", "c")]),
        ]);
        let new = create_document(vec![
            create_section("s1", "One", SectionType::Section, vec![create_paragraph("p1", "a")]),
            create_section("sx", "New", SectionType::Section, vec![create_paragraph("px", "x")]),
            create_section("s3", "Three", SectionType::Section, vec![create_paragraph("p3", "c")]),
            create_section("s2", "Two", SectionType::Section, vec![create_paragraph("p2", "b")]),
        ]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 2);
        assert!(matches!(&ops[0], DocOp::InsertSection { after_id, section }
            if after_id.as_deref() == Some("s1") && section.id == "sx"));
        assert!(matches!(&ops[1], DocOp::MoveSection { id, to_after_id, .. }
            if id == "s3" && to_after_id.as_deref() == Some("sx")));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_compute_doc_ops_move_with_content_change() {
        // MoveSection carries no content: a moved section that ALSO changed
        // must have its rename/paragraph ops emitted in the same batch.
        let old = create_document(vec![
            create_section("s1", "One", SectionType::Section, vec![create_paragraph("p1", "a")]),
            create_section("s2", "Two", SectionType::Section, vec![create_paragraph("p2", "old")]),
        ]);
        let new = create_document(vec![
            create_section("s2", "Two!", SectionType::Section, vec![create_paragraph("p2", "new")]),
            create_section("s1", "One", SectionType::Section, vec![create_paragraph("p1", "a")]),
        ]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 3);
        assert!(matches!(&ops[0], DocOp::MoveSection { id, .. } if id == "s2"));
        assert!(matches!(&ops[1], DocOp::RenameSection { id, new_title, .. }
            if id == "s2" && new_title == "Two!"));
        assert!(matches!(&ops[2], DocOp::UpdateParagraph { id, .. } if id == "p2"));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);
    }

    #[test]
    fn test_move_section_invert_round_trips_order() {
        // Undo of a move batch = invert + reverse + apply must land exactly
        // back on the original order; redo (forward apply) re-moves.
        let old = create_document(vec![
            create_section("s1", "One", SectionType::Section, vec![create_paragraph("p1", "a")]),
            create_section("s2", "Two", SectionType::Section, vec![create_paragraph("p2", "b")]),
            create_section("s3", "Three", SectionType::Section, vec![create_paragraph("p3", "c")]),
        ]);
        let new = create_document(vec![
            create_section("s3", "Three", SectionType::Section, vec![create_paragraph("p3", "c")]),
            create_section("s1", "One", SectionType::Section, vec![create_paragraph("p1", "a")]),
            create_section("s2", "Two", SectionType::Section, vec![create_paragraph("p2", "b")]),
        ]);
        let ops = compute_doc_ops(&old, &new);

        let mut doc = old.clone();
        apply_doc_ops(&mut doc, &ops).unwrap();
        assert_eq!(doc, new);

        let inverted: Vec<DocOp> = ops.iter().rev().map(|op| op.invert()).collect();
        apply_doc_ops(&mut doc, &inverted).unwrap();
        assert_eq!(doc, old);

        apply_doc_ops(&mut doc, &ops).unwrap();
        assert_eq!(doc, new);
    }

    #[test]
    fn test_move_first_section_to_end_normalizes_to_two_moves() {
        // Dragging the FIRST section to the end: the walk advances the NEW
        // cursor, so it expresses this as "move the other two to the front"
        // rather than "move s1 to the back" — two normalized MoveSections
        // instead of one. Not minimal, but both apply and invert round-trip
        // exactly (minimality is not the walk's contract; correctness is).
        let old = create_document(vec![
            create_section("s1", "One", SectionType::Section, vec![create_paragraph("p1", "a")]),
            create_section("s2", "Two", SectionType::Section, vec![create_paragraph("p2", "b")]),
            create_section("s3", "Three", SectionType::Section, vec![create_paragraph("p3", "c")]),
        ]);
        let new = create_document(vec![
            create_section("s2", "Two", SectionType::Section, vec![create_paragraph("p2", "b")]),
            create_section("s3", "Three", SectionType::Section, vec![create_paragraph("p3", "c")]),
            create_section("s1", "One", SectionType::Section, vec![create_paragraph("p1", "a")]),
        ]);
        let ops = compute_doc_ops(&old, &new);
        assert_eq!(ops.len(), 2);
        assert!(matches!(&ops[0], DocOp::MoveSection { id, to_after_id, .. }
            if id == "s2" && to_after_id.is_none()));
        assert!(matches!(&ops[1], DocOp::MoveSection { id, to_after_id, .. }
            if id == "s3" && to_after_id.as_deref() == Some("s2")));

        let mut reconstructed = old.clone();
        apply_doc_ops(&mut reconstructed, &ops).unwrap();
        assert_eq!(reconstructed, new);

        let inverted: Vec<DocOp> = ops.iter().rev().map(|op| op.invert()).collect();
        apply_doc_ops(&mut reconstructed, &inverted).unwrap();
        assert_eq!(reconstructed, old);
    }

    #[test]
    fn test_move_section_apply_guards() {
        let mut doc = create_document(vec![
            create_section("s1", "One", SectionType::Section, vec![create_paragraph("p1", "a")]),
            create_section("s2", "Two", SectionType::Section, vec![create_paragraph("p2", "b")]),
        ]);

        // Missing section.
        let missing = DocOp::MoveSection {
            id: "zz".to_string(),
            from_after_id: None,
            to_after_id: Some("s1".to_string()),
        };
        assert!(apply_doc_ops(&mut doc, &[missing]).is_err());

        // Missing destination.
        let missing_dest = DocOp::MoveSection {
            id: "s1".to_string(),
            from_after_id: None,
            to_after_id: Some("zz".to_string()),
        };
        assert!(apply_doc_ops(&mut doc, &[missing_dest]).is_err());

        // A section cannot follow itself.
        let self_after = DocOp::MoveSection {
            id: "s1".to_string(),
            from_after_id: Some("s2".to_string()),
            to_after_id: Some("s1".to_string()),
        };
        assert!(apply_doc_ops(&mut doc, &[self_after]).is_err());

        // None of the failed ops mutated the document.
        assert_eq!(doc.sections[0].id, "s1");
        assert_eq!(doc.sections[1].id, "s2");
    }

    #[test]
    fn test_move_section_to_same_position_is_noop() {
        // Dropping a row exactly where it already is produces no ops at all.
        let old = create_document(vec![
            create_section("s1", "One", SectionType::Section, vec![create_paragraph("p1", "a")]),
            create_section("s2", "Two", SectionType::Section, vec![create_paragraph("p2", "b")]),
        ]);
        let mut doc = old.clone();
        apply_doc_ops(
            &mut doc,
            &[DocOp::MoveSection {
                id: "s2".to_string(),
                from_after_id: Some("s1".to_string()),
                to_after_id: Some("s1".to_string()),
            }],
        )
        .unwrap();
        assert_eq!(doc, old);
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