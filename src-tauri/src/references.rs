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

/// Replace the open document's references record and return what is now stored.
pub fn save_references(_state: &AppState, _next: References) -> Result<References, String> {
    todo!()
}

/// The open document's references record.
pub fn load_references(_state: &AppState) -> References {
    todo!()
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
