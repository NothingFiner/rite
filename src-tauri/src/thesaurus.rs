//! Thesaurus lookup (roadmap 5.11).
//!
//! The dataset is one brotli-compressed TSV of English WordNet 2020 senses,
//! built offline by `scripts/build-thesaurus.py` and bundled with
//! `include_bytes!`. Each row is a *sense*: lemma, part-of-speech code, sense
//! number, gloss, synonyms, antonyms — tab-separated, no header.
//!
//! Rows are the unit of grouping because WordNet attaches antonyms to the
//! **sense**, not the word: "light" the adjective is the antonym of "heavy",
//! "light" the illumination is not.
//!
//! Everything here is runtime-free so `cargo test` can drive it: [`parse_dataset`]
//! takes a `&str`, [`bundled`] owns the one decode, and only
//! [`thesaurus_lookup`] touches Tauri.

use serde::Serialize;

/// One meaning of a word, with the words it is related to.
///
/// Serialised camelCase (`partOfSpeech`, `senseNumber`) so the webview reads
/// JavaScript-shaped fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sense {
    /// Display form of WordNet's part-of-speech code: "noun", "verb",
    /// "adjective" or "adverb".
    pub part_of_speech: String,
    /// 1-based position of this sense among the word's senses in WordNet.
    pub sense_number: u32,
    /// The synset definition.
    pub gloss: String,
    /// The other lemmas in this sense's synset (the headword is excluded).
    pub synonyms: Vec<String>,
    /// Lemmas named as antonyms of *this sense*; empty when WordNet has none.
    pub antonyms: Vec<String>,
}

/// One headword and every sense the dataset has for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WordEntry {
    /// The headword as spelled in the dataset.
    pub word: String,
    pub senses: Vec<Sense>,
}

/// A parsed dataset, indexed by lowercased lemma.
pub struct Thesaurus {
    entries: Vec<WordEntry>,
}

impl Thesaurus {
    /// The entry for `word`, ignoring case. `None` means WordNet has no such
    /// word — a normal answer, not a failure.
    pub fn lookup(&self, _word: &str) -> Option<&WordEntry> {
        todo!("index the dataset by lowercased lemma (SPEC S-001, S-002)")
    }

    /// How many headwords the dataset holds.
    pub fn headword_count(&self) -> usize {
        todo!("count indexed headwords (SPEC S-001)")
    }
}

/// Parse the TSV payload. Rows that do not have six tab-separated fields (or
/// that have an empty lemma) are skipped; the rest still load.
pub fn parse_dataset(_tsv: &str) -> Thesaurus {
    todo!("parse the flattened WordNet TSV (SPEC S-003, S-009)")
}

/// The dataset bundled with the app: `src-tauri/assets/thesaurus.tsv.br`,
/// decoded and indexed once for the process lifetime.
pub fn bundled() -> &'static Thesaurus {
    todo!("decode the bundled brotli asset once (SPEC S-001)")
}

/// Look a word up. A word that is not in WordNet is `Ok(None)`; a query with no
/// word in it at all is an error.
#[tauri::command]
pub fn thesaurus_lookup(_word: String) -> Result<Option<WordEntry>, String> {
    todo!("look the word up in the bundled dataset (SPEC S-007, S-008)")
}
