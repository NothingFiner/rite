//! Reference entries (5.19a).
//!
//! One flat record with a kind — `term`, `character` or `place` — stored in the
//! `.rite` beside `Notes`. Entries are authored source: they never enter
//! `Document`, so they stay out of exports, the word count, search results and
//! version-history snapshots.
//!
//! Where an entry appears in the manuscript is derived by scanning paragraph
//! text. It is never stored here; `included_sections` and `excluded_sections`
//! are the writer's manual corrections, and those are source.

use crate::state::AppState;
use serde::{Deserialize, Serialize};

/// The document's reference entries. Absent in older files, where it reads as
/// an empty record through `serde(default)`.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct References {
    #[serde(default)]
    pub entries: Vec<ReferenceEntry>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceKind {
    #[default]
    Term,
    Character,
    Place,
}

impl ReferenceKind {
    /// The word the word menu prints beside an entry's name.
    ///
    /// Two entries can share the clicked word, so the label needs the kind to
    /// tell them apart (S-109).
    pub fn label(self) -> &'static str {
        match self {
            ReferenceKind::Term => "Term",
            ReferenceKind::Character => "Character",
            ReferenceKind::Place => "Place",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceEntry {
    pub id: String,
    pub kind: ReferenceKind,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub definition: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub facts: Vec<ReferenceFact>,
    #[serde(default)]
    pub included_sections: Vec<String>,
    #[serde(default)]
    pub excluded_sections: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceFact {
    pub label: String,
    pub value: String,
}

/// One entry offered by the word menu's lookup (SPEC.md S-097 … S-101).
///
/// The name and the kind are what tell two entries sharing a word apart in the
/// chooser, so a match is more than an id.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceMatch {
    pub id: String,
    pub name: String,
    pub kind: ReferenceKind,
}

/// Every entry whose name or an alias contains `word` as a whole word, ignoring
/// case (S-097).
///
/// Looser than link resolution and the mention scan: a lookup answers what a
/// word could mean, so every entry the word belongs to is offered.
pub fn entries_for_word(references: &References, word: &str) -> Vec<ReferenceMatch> {
    let target = word.to_lowercase();
    references
        .entries
        .iter()
        .filter(|entry| contains_word(entry, &target))
        .map(|entry| ReferenceMatch {
            id: entry.id.clone(),
            name: entry.name.clone(),
            kind: entry.kind,
        })
        .collect()
}

/// Whether a case-folded word equals one whole token of the name or an alias.
/// Entry names are authored text, so the fold must go beyond what
/// `eq_ignore_ascii_case` covers.
fn contains_word(entry: &ReferenceEntry, target: &str) -> bool {
    let name_hit = entry
        .name
        .split_whitespace()
        .any(|token| token.to_lowercase() == target);
    let alias_hit = entry.aliases.iter().any(|alias| {
        alias
            .split_whitespace()
            .any(|token| token.to_lowercase() == target)
    });
    name_hit || alias_hit
}

/// Replace the open document's references record and return what is now stored.
/// Marks the document modified. The autosave path picks the record up through
/// `build_rite_file` rather than writing the file itself.
pub fn save_references(state: &AppState, next: References) -> Result<References, String> {
    let mut stored_references = state.references.lock().map_err(|e| e.to_string())?;
    (*stored_references) = next;
    let saved = (*stored_references).clone();
    drop(stored_references);

    let mut modified = state.is_modified.lock().map_err(|e| e.to_string())?;
    (*modified) = true;

    Ok(saved)
}

/// The open document's references record.
///
/// Returns no Result, so lock poisoning panics here instead of mapping to a
/// string for the writer.
pub fn load_references(state: &AppState) -> References {
    state.references.lock().unwrap().clone()
}

#[tauri::command]
pub fn retrieve_references(state: tauri::State<AppState>) -> Result<References, String> {
    Ok(load_references(&state))
}

#[tauri::command]
pub fn update_references(
    references: References,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    save_references(&state, references).map(|_| ())
}
