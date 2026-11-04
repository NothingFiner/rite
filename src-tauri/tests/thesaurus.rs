//! Thesaurus dataset, lookup and word menu (SPEC.md S-001 … S-013).
//!
//! The dataset sentences drive the bundled asset (the real thing: 139,857 sense
//! rows) and a small inline fixture for the parsing rules, so a failure says
//! which contract broke rather than "something in 11 MB of WordNet".
//!
//! The menu sentences read `word_menu_definition()` — plain data — because a
//! built Tauri menu needs a `Manager`, and on macOS `muda` panics unless the
//! menu is created on the main thread, which a test worker thread is not.

use rite_lib::menu::{
    definition, menu_event, word_menu_definition, MenuEvent, MenuNode, MENU_EVENT_NAME,
    THESAURUS_ITEM_ID,
};
use rite_lib::thesaurus::{bundled, parse_dataset, thesaurus_lookup};

/// Four rows of the real format: two senses of "light" as an adjective, one as
/// a noun with no antonyms, and one for "sad". Tabs separate the six fields.
const FIXTURE: &str = "\
light\ta\t1\tof comparatively little weight or density\t\theavy
light\ta\t2\tnot great in degree or quantity\t\t
light\tn\t1\tthe quality of being luminous\tvisible light,illumination\t
sad\ta\t1\texperiencing or showing sorrow\tunhappy,downhearted\thappy
";

fn fixture() -> rite_lib::thesaurus::Thesaurus {
    parse_dataset(FIXTURE)
}

#[test]
fn s_001_bundled_dataset_indexes_more_than_eighty_thousand_headwords() {
    let count = bundled().headword_count();
    assert!(
        count >= 80_000,
        "the bundled WordNet flattening should hold at least 80,000 single-word \
         headwords, found {count} — is the asset truncated?"
    );
}

#[test]
fn s_002_lookup_ignores_the_query_case() {
    let thesaurus = bundled();
    let lower = thesaurus.lookup("the").expect("WordNet has the word `the`");
    let shouted = thesaurus
        .lookup("THE")
        .expect("`THE` must find the same entry as `the`");
    assert_eq!(shouted.word, lower.word);
    assert_eq!(shouted.senses.len(), lower.senses.len());
}

#[test]
fn s_003_each_sense_carries_its_part_of_speech_number_and_gloss() {
    let thesaurus = fixture();
    let entry = thesaurus.lookup("light").expect("the fixture defines light");
    assert_eq!(entry.word, "light");
    assert_eq!(entry.senses.len(), 3, "one group per sense row");

    let first = &entry.senses[0];
    assert_eq!(first.part_of_speech, "adjective");
    assert_eq!(first.sense_number, 1);
    assert!(
        first.gloss.contains("little weight"),
        "the gloss is the synset definition, got {:?}",
        first.gloss
    );

    assert_eq!(entry.senses[2].part_of_speech, "noun");
    assert_eq!(entry.senses[2].sense_number, 1);
}

#[test]
fn s_004_parts_of_speech_are_named_and_satellite_adjectives_are_adjectives() {
    let thesaurus = parse_dataset(
        "alpha\tn\t1\ta noun\t\t\nalpha\tv\t1\ta verb\t\t\nalpha\ta\t1\tan adjective\t\t\n\
         alpha\ts\t1\ta satellite adjective\t\t\nalpha\tr\t1\tan adverb\t\t\n",
    );
    let named: Vec<&str> = thesaurus
        .lookup("alpha")
        .expect("the fixture defines alpha")
        .senses
        .iter()
        .map(|sense| sense.part_of_speech.as_str())
        .collect();
    assert_eq!(named, ["noun", "verb", "adjective", "adjective", "adverb"]);
}

#[test]
fn s_005_synonyms_never_repeat_the_headword() {
    let thesaurus = fixture();
    let entry = thesaurus.lookup("light").expect("the fixture defines light");
    let noun = &entry.senses[2];
    assert_eq!(noun.synonyms, ["visible light", "illumination"]);
    for sense in &entry.senses {
        assert!(
            !sense.synonyms.iter().any(|synonym| synonym == "light"),
            "a sense must not offer the headword as its own synonym: {sense:?}"
        );
    }
}

#[test]
fn s_006_antonyms_are_per_sense_and_empty_when_wordnet_has_none() {
    let thesaurus = fixture();
    let entry = thesaurus.lookup("light").expect("the fixture defines light");
    assert_eq!(entry.senses[0].antonyms, ["heavy"]);
    assert!(
        entry.senses[2].antonyms.is_empty(),
        "the illumination sense has no antonym, got {:?}",
        entry.senses[2].antonyms
    );

    let sad = thesaurus.lookup("sad").expect("the fixture defines sad");
    assert_eq!(sad.senses[0].antonyms, ["happy"]);
}

#[test]
fn s_007_an_unknown_word_is_no_entry_not_an_error() {
    let thesaurus = fixture();
    assert!(thesaurus.lookup("zzzznotaword").is_none());
    assert!(
        thesaurus_lookup("zzzznotaword".to_string()).is_ok(),
        "a word WordNet does not have is an ordinary answer"
    );
    assert_eq!(thesaurus_lookup("zzzznotaword".to_string()), Ok(None));
}

#[test]
fn s_008_an_empty_query_is_an_error_naming_it_invalid() {
    for query in ["", " ", "\t\n  "] {
        let result = thesaurus_lookup(query.to_string());
        let message = result.expect_err("an empty query is not a lookup");
        let lower = message.to_lowercase();
        assert!(
            lower.contains("invalid") || lower.contains("no word"),
            "the error should say the query is invalid, got {message:?}"
        );
    }
}

#[test]
fn s_009_a_malformed_row_is_skipped_and_the_rest_still_loads() {
    let thesaurus = parse_dataset(
        "good\tn\t1\ta good word\t\t\n\
         broken row with no tabs\n\
         too\tfew\tfields\n\
         \tn\t1\ta row with an empty lemma\t\t\n\
         better\tn\t1\tanother good word\t\t\n",
    );
    assert!(thesaurus.lookup("good").is_some(), "the row before the junk");
    assert!(thesaurus.lookup("better").is_some(), "the row after the junk");
    assert!(thesaurus.lookup("too").is_none(), "a five-field row is malformed");
    assert_eq!(thesaurus.headword_count(), 2);
}

#[test]
fn s_010_the_dataset_ships_with_its_attribution() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("assets")
        .join("WORDNET-attribution.txt");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("missing attribution at {}: {error}", path.display()));
    assert!(
        text.contains("English WordNet 2020"),
        "the attribution must name the source WordNet"
    );
    assert!(
        text.contains("CC BY 4.0"),
        "the attribution must name the licence"
    );
}

#[test]
fn s_011_the_word_menu_is_one_thesaurus_item() {
    let items = word_menu_definition();
    assert_eq!(
        items.len(),
        1,
        "the right-click menu is one item, got {items:?}"
    );
    assert_eq!(
        items[0],
        MenuNode::Item {
            id: THESAURUS_ITEM_ID,
            label: "Thesaurus…",
            accelerator: None,
        }
    );
}

#[test]
fn s_012_the_thesaurus_id_routes_through_menu_event() {
    assert_eq!(
        menu_event(THESAURUS_ITEM_ID),
        Some(MenuEvent {
            name: MENU_EVENT_NAME,
            id: THESAURUS_ITEM_ID,
        })
    );
    assert_eq!(
        menu_event("thesaurus_extra"),
        None,
        "the routing must match the id exactly"
    );
}

#[test]
fn s_013_the_static_application_menu_gains_no_thesaurus_item() {
    let menu = definition();
    let ids: Vec<&str> = menu
        .app
        .iter()
        .chain(menu.file.iter())
        .chain(menu.edit.iter())
        .chain(menu.window.iter())
        .filter_map(|node| match node {
            MenuNode::Item { id, .. } => Some(*id),
            _ => None,
        })
        .collect();
    assert!(
        !ids.contains(&THESAURUS_ITEM_ID),
        "the word menu is on demand only; the menu bar must not offer it: {ids:?}"
    );
    assert!(ids.contains(&"save"), "sanity: the known ids are present");
}
