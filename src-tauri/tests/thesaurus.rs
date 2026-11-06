//! Thesaurus dataset, lookup and word menu (SPEC.md S-001 … S-013).
//!
//! The dataset sentences drive the bundled asset (the real thing: 139,857 sense
//! rows) and a small inline fixture for the parsing rules, so a failure says
//! which contract broke rather than "something in 11 MB of WordNet".
//!
//! The menu sentences read `word_menu_definition()` — plain data — because a
//! built Tauri menu needs a `Manager`, and on macOS `muda` panics unless the
//! menu is created on the main thread, which a test worker thread is not.
//!
//! 5.15 grew that menu from one item to a full one; the sentence below now
//! checks the thesaurus item is *present*, which is the part 5.11 owns.

use rite_lib::menu::{
    definition, menu_event, word_menu_definition, MenuEvent, MenuNode, SpellingState,
    MENU_EVENT_NAME, THESAURUS_ITEM_ID,
};
use rite_lib::thesaurus::{bundled, parse_dataset, parse_irregulars, thesaurus_lookup};

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
    // WordNet has no determiners, so the example word has to be a real lemma:
    // "happy" has four sense rows in the bundled asset.
    let lower = thesaurus
        .lookup("happy")
        .expect("WordNet has the word `happy`");
    let shouted = thesaurus
        .lookup("HAPPY")
        .expect("`HAPPY` must find the same entry as `happy`");
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
    // A word the spell checker accepts: the smallest menu 5.15 builds.
    let menu = word_menu_definition(SpellingState {
        flagged: false,
        learned: false,
        can_ignore: true,
    });
    assert!(
        menu.iter().any(|node| matches!(
            node,
            MenuNode::Item {
                id: THESAURUS_ITEM_ID,
                label: "Thesaurus…",
                ..
            }
        )),
        "the right-click menu offers Thesaurus…, got {menu:?}"
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

// --- Inflected forms (S-039 … S-042) -----------------------------------------
//
// WordNet holds lemmas, not inflections: the dataset has `thread` and
// `encampment`, never `threading` or `encampments`. A writer right-clicks what
// they typed, so lookup has to walk back to a lemma — but only to a lemma the
// dataset actually has, which is what keeps an unknown word unknown.

/// A dataset with exactly the lemmas the inflection rules need, so the rules are
/// tested independently of whatever WordNet happens to contain.
const LEMMAS: &str = "\
thread\tn\t1\ta fine cord of spun fibre\t\t
encampment\tn\t1\ta site where troops are camped\t\t
story\tn\t1\tan account of imaginary events\t\t
box\tn\t1\ta container with a flat base\t\t
make\tv\t1\tto create or produce\t\t
stop\tv\t1\tto halt\t\t
stopped\ta\t1\t(of a nose) blocked\t\t
writer\tn\t1\ta person who writes\t\t
";

fn lemmas() -> rite_lib::thesaurus::Thesaurus {
    parse_dataset(LEMMAS)
}

#[test]
fn s_039_a_plural_noun_finds_its_singular_lemma() {
    let thesaurus = lemmas();
    for (typed, lemma) in [
        ("encampments", "encampment"),
        ("stories", "story"),
        ("boxes", "box"),
    ] {
        let entry = thesaurus
            .lookup(typed)
            .unwrap_or_else(|| panic!("{typed} should find {lemma}"));
        assert_eq!(entry.word, lemma, "{typed} must resolve to {lemma}");
    }

    // The writer's own words, against the real bundled dataset.
    assert_eq!(
        bundled().lookup("encampments").map(|entry| entry.word.as_str()),
        Some("encampment")
    );
    assert_eq!(
        bundled().lookup("stories").map(|entry| entry.word.as_str()),
        Some("story")
    );
}

#[test]
fn s_040_an_inflected_verb_finds_its_lemma() {
    let thesaurus = lemmas();
    for (typed, lemma) in [("threading", "thread"), ("threaded", "thread"), ("makes", "make")] {
        let entry = thesaurus
            .lookup(typed)
            .unwrap_or_else(|| panic!("{typed} should find {lemma}"));
        assert_eq!(entry.word, lemma, "{typed} must resolve to {lemma}");
    }

    // The gerund that started this: against the real bundled dataset.
    assert_eq!(
        bundled().lookup("threading").map(|entry| entry.word.as_str()),
        Some("thread")
    );
}

#[test]
fn s_041_a_word_with_its_own_entry_beats_an_inflection_of_another() {
    // "stopped" is a WordNet adjective in its own right; the writer asked for
    // that word, not for "stop".
    assert_eq!(lemmas().lookup("stopped").map(|entry| entry.word.as_str()), Some("stopped"));
    assert_eq!(
        bundled().lookup("stopped").map(|entry| entry.word.as_str()),
        Some("stopped")
    );

    // And no candidate may conjure a lemma the dataset does not have.
    assert!(lemmas().lookup("zzzznotaword").is_none());
    assert!(lemmas().lookup("encampmentish").is_none());
}

#[test]
fn s_042_a_possessive_finds_its_lemma() {
    let thesaurus = lemmas();
    assert_eq!(thesaurus.lookup("writer's").map(|entry| entry.word.as_str()), Some("writer"));
    // A typographic apostrophe is what macOS smart punctuation produces.
    assert_eq!(thesaurus.lookup("writer’s").map(|entry| entry.word.as_str()), Some("writer"));
}

// --- Irregular forms (S-043, S-044) ------------------------------------------
//
// Regular rules cannot reach "ran", "mice" or "written": they are not lemmas and
// no suffix rule produces the lemma. English WordNet records them as non-lemma
// Form entries, so the generator ships a 4,322-pair surface → lemma table beside
// the dataset. Lookup tries the word itself, then the table, then the rules.

const IRREGULAR: &str = "\
ran\trun
mice\tmouse
children\tchild
went\tgo
written\twrite
xyzzy\tabsent
";

fn lemmas_with_irregulars() -> rite_lib::thesaurus::Thesaurus {
    let mut thesaurus = parse_dataset(
        "run\tv\t1\tto move quickly\t\t\n\
         mouse\tn\t1\ta small rodent\t\t\n\
         child\tn\t1\ta young person\t\t\n\
         go\tv\t1\tto move from one place to another\t\t\n\
         write\tv\t1\tto set down in writing\t\t\n\
         better\ta\t1\tof superior quality\t\t\n",
    );
    thesaurus.set_irregulars(parse_irregulars(IRREGULAR));
    thesaurus
}

#[test]
fn s_043_an_irregular_form_finds_its_lemma() {
    let thesaurus = lemmas_with_irregulars();
    for (typed, lemma) in [
        ("ran", "run"),
        ("mice", "mouse"),
        ("children", "child"),
        ("went", "go"),
        ("written", "write"),
    ] {
        let entry = thesaurus
            .lookup(typed)
            .unwrap_or_else(|| panic!("{typed} should find {lemma}"));
        assert_eq!(entry.word, lemma, "{typed} must resolve to {lemma}");
    }

    // And against the real bundled dataset. "written" is left out on purpose:
    // WordNet carries it as a lemma of its own, so S-041's exact-entry rule
    // wins there, and S-044 pins that.
    for (typed, lemma) in [
        ("ran", "run"),
        ("mice", "mouse"),
        ("children", "child"),
        ("went", "go"),
    ] {
        assert_eq!(
            bundled().lookup(typed).map(|entry| entry.word.as_str()),
            Some(lemma),
            "{typed} must resolve to {lemma} in the shipped dataset"
        );
    }
}

#[test]
fn s_044_an_exact_entry_beats_an_irregular_pair_that_the_dataset_cannot_honour() {
    let thesaurus = lemmas_with_irregulars();

    // "better" is a lemma in its own right; WordNet also pairs it with "well",
    // but the writer asked for the adjective they typed.
    assert_eq!(
        thesaurus.lookup("better").map(|entry| entry.word.as_str()),
        Some("better")
    );

    // The fixture maps "xyzzy" to "absent", which the dataset does not contain:
    // a dangling pair must not invent an entry.
    assert!(thesaurus.lookup("xyzzy").is_none());

    // The shipped table carries no pair whose lemma is missing.
    assert_eq!(
        bundled().lookup("better").map(|entry| entry.word.as_str()),
        Some("better")
    );

    // "written" is both an irregular form of "write" and a lemma of its own:
    // the writer asked for the word they typed, so the exact entry wins.
    assert_eq!(
        bundled().lookup("written").map(|entry| entry.word.as_str()),
        Some("written")
    );
}
