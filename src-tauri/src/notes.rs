//! Document-level notes (SPEC.md 5.17).
//!
//! A `Notes` value is stored inside the `.rite` file, beside the document and
//! its embedded history. It is deliberately NOT part of `Document`. Notes are
//! authoring aids about the manuscript, not manuscript prose, so they must not
//! reach the text exports, the word count or the version-history snapshots.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The document's notes. `sections` is keyed by section id and holds markdown
/// source. A section with no note simply has no key. `orphaned` is one draft
/// that collects notes from deleted sections.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Notes {
    #[serde(default)]
    pub overview: String,
    #[serde(default)]
    pub sections: HashMap<String, String>,
    #[serde(default)]
    pub orphaned: String,
}
