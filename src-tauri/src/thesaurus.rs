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

use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::sync::OnceLock;

use brotli::reader::Decompressor;
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
    /// One entry per headword, keyed by its lowercase form so lookups ignore
    /// the query's case; `WordEntry.word` keeps the dataset's own spelling.
    entries: HashMap<String, WordEntry>,
}

impl Thesaurus {
    /// The entry for `word`, ignoring case. `None` means WordNet has no such
    /// word — a normal answer, not a failure.
    pub fn lookup(&self, word: &str) -> Option<&WordEntry> {
        self.entries.get(&word.to_lowercase())
    }

    /// How many headwords the dataset holds.
    pub fn headword_count(&self) -> usize {
        self.entries.len()
    }
}

/// Parse the TSV payload. Rows that are not six tab-separated fields with a
/// non-empty lemma, a numeric sense number and a known part-of-speech code are
/// skipped individually; the rest still load.
pub fn parse_dataset(tsv: &str) -> Thesaurus {
    let mut entries: HashMap<String, WordEntry> = HashMap::new();
    for row in tsv.lines() {
        let fields = row.split('\t').collect::<Vec<_>>();
        let [lemma, pos, sense_number, gloss, synonyms, antonyms] = fields.as_slice() else {
            // Not exactly six fields (counting a trailing tab's empty sixth) —
            // a malformed row, not a data stop.
            continue;
        };
        if lemma.is_empty() {
            continue;
        }
        let sense_number: u32 = match sense_number.parse() {
            Ok(number) => number,
            Err(_) => continue,
        };
        let part_of_speech = match *pos {
            "n" => "noun",
            "v" => "verb",
            "a" | "s" => "adjective",
            "r" => "adverb",
            _ => continue,
        };
        let key = lemma.to_lowercase();
        let entry = entries
            .entry(key.clone())
            .or_insert_with(|| WordEntry {
                // The first spelling seen for this key is the one the entry
                // reports; later rows differing only in case do not rename it.
                word: lemma.to_string(),
                senses: Vec::new(),
            });
        entry.senses.push(Sense {
            part_of_speech: part_of_speech.to_string(),
            sense_number,
            gloss: gloss.to_string(),
            synonyms: related_items(synonyms, lemma, &key),
            antonyms: related_items(antonyms, lemma, &key),
        });
    }
    Thesaurus { entries }
}

/// Comma-separated relation list: trim the items, drop empty segments,
/// duplicates and anything equal to the headword itself (however cased).
fn related_items(raw: &str, lemma: &str, key: &str) -> Vec<String> {
    let mut items: Vec<String> = Vec::new();
    for item in raw.split(',') {
        let item = item.trim();
        if item.is_empty()
            || item.eq_ignore_ascii_case(lemma)
            || item.eq_ignore_ascii_case(key)
            || items.iter().any(|kept| kept == item)
        {
            continue;
        }
        items.push(item.to_string());
    }
    items
}

/// Read-buffer size for the one brotli decode. The plain-text dataset behind
/// the 2.5 MB asset is ~30 MB, so the default 4 KiB would do thousands of
/// decompressor rounds; 64 KiB trades a small allocation for those rounds.
const DECODE_BUFFER_BYTES: usize = 64 * 1024;

/// The dataset bundled with the app: `src-tauri/assets/thesaurus.tsv.br`,
/// decoded and indexed once for the process lifetime.
pub fn bundled() -> &'static Thesaurus {
    static BUNDLED: OnceLock<Thesaurus> = OnceLock::new();
    BUNDLED.get_or_init(|| {
        let mut decompressed = Vec::new();
        Decompressor::new(Cursor::new(include_bytes!(
            "../assets/thesaurus.tsv.br"
        )), DECODE_BUFFER_BYTES)
        .read_to_end(&mut decompressed)
        .expect("bundled thesaurus asset does not decode");
        let tsv = String::from_utf8(decompressed)
            .expect("bundled thesaurus asset is not UTF-8");
        parse_dataset(&tsv)
    })
}

/// Look a word up. A word that is not in WordNet is `Ok(None)`; a query with no
/// word in it at all is an error.
#[tauri::command]
pub fn thesaurus_lookup(word: String) -> Result<Option<WordEntry>, String> {
    let word = word.trim();
    if word.is_empty() {
        return Err("invalid thesaurus query: no word given".to_string());
    }
    Ok(bundled().lookup(word).cloned())
}
