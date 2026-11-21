//! The reference lookup: whole-word containment over the record (S-097 … S-101),
//! and the word-menu item that opens it (S-102 … S-104).
//!
//! One binary rather than two, because `cargo test` stops after the first
//! failing target. Split apart, a red matcher would hide the menu item's tests
//! from anything that reads the runner's output.
//!
//! The lookup is looser than link resolution, which needs whole-text equality,
//! and looser than the mention scan. A negative case carries a word that must
//! match beside it, or an unimplemented scan would pass it.

use rite_lib::menu::{
    menu_event, word_menu_definition_with_reference, MenuEvent, MenuNode, SpellingState,
    LEARN_SPELLING_ITEM_ID, LOOK_UP_REFERENCE_ITEM_ID, MENU_EVENT_NAME, THESAURUS_ITEM_ID,
};
use rite_lib::references::{
    entries_for_word, ReferenceEntry, ReferenceKind, ReferenceMatch, References,
};

fn entry(id: &str, kind: ReferenceKind, name: &str, aliases: &[&str]) -> ReferenceEntry {
    ReferenceEntry {
        id: id.to_string(),
        kind,
        name: name.to_string(),
        definition: String::new(),
        aliases: aliases.iter().map(|alias| alias.to_string()).collect(),
        tags: Vec::new(),
        facts: Vec::new(),
        included_sections: Vec::new(),
        excluded_sections: Vec::new(),
    }
}

/// The record 5.19 is written against. A full name, the shorter name sharing its
/// first word, an alias on the shorter one, and a place sharing the surname.
fn record() -> References {
    References {
        entries: vec![
            entry("e-qualen", ReferenceKind::Character, "Izildar Qualen", &[]),
            entry("e-izildar", ReferenceKind::Character, "Izildar", &["Izi"]),
            entry("e-square", ReferenceKind::Place, "Qualen Square", &[]),
        ],
    }
}

fn sorted_ids(matches: &[ReferenceMatch]) -> Vec<String> {
    let mut ids: Vec<String> = matches.iter().map(|found| found.id.clone()).collect();
    ids.sort();
    ids
}

#[test]
fn s_097_should_match_a_whole_word_inside_a_name_ignoring_case() {
    let upper = entries_for_word(&record(), "IZILDAR");
    let lower = entries_for_word(&record(), "izildar");

    assert_eq!(sorted_ids(&upper), vec!["e-izildar", "e-qualen"]);
    assert_eq!(sorted_ids(&lower), sorted_ids(&upper));
}

#[test]
fn s_098_should_return_both_entries_that_contain_qualen() {
    let found = entries_for_word(&record(), "Qualen");

    assert_eq!(sorted_ids(&found), vec!["e-qualen", "e-square"]);
}

#[test]
fn s_099_should_return_the_entry_that_owns_izi_as_an_alias() {
    let found = entries_for_word(&record(), "Izi");

    assert_eq!(sorted_ids(&found), vec!["e-izildar"]);
}

#[test]
fn s_100_should_report_each_match_with_its_name_and_kind() {
    let found = entries_for_word(&record(), "Qualen");
    let reported: Vec<(&str, ReferenceKind)> = found
        .iter()
        .map(|matched| (matched.name.as_str(), matched.kind))
        .collect();

    assert!(
        reported.contains(&("Qualen Square", ReferenceKind::Place)),
        "the place must arrive with its own name and kind: {reported:?}"
    );
    assert!(
        reported.contains(&("Izildar Qualen", ReferenceKind::Character)),
        "the character must arrive with its own name and kind: {reported:?}"
    );
}

#[test]
fn s_101_should_not_match_a_word_that_is_only_a_fragment_of_a_name() {
    let fragment = entries_for_word(&record(), "zild");
    let control = entries_for_word(&record(), "Izildar");

    assert!(
        fragment.is_empty(),
        "a fragment of a name is not the word: {fragment:?}"
    );
    assert_eq!(sorted_ids(&control), vec!["e-izildar", "e-qualen"]);
}

/// A word the system checker flags, so the spelling section is present too and
/// the lookup item's place among the other app-owned items is exercised.
const FLAGGED: SpellingState = SpellingState {
    flagged: true,
    learned: false,
    can_ignore: true,
};

fn item_ids(nodes: &[MenuNode]) -> Vec<&'static str> {
    nodes
        .iter()
        .filter_map(|node| match node {
            MenuNode::Item { id, .. } => Some(*id),
            _ => None,
        })
        .collect()
}

#[test]
fn s_102_should_offer_the_lookup_when_the_word_matches_an_entry() {
    let ids = item_ids(&word_menu_definition_with_reference(FLAGGED, true));

    assert!(
        ids.contains(&LOOK_UP_REFERENCE_ITEM_ID),
        "a matching word should offer the lookup: {ids:?}"
    );
}

#[test]
fn s_103_should_omit_the_lookup_when_the_word_matches_no_entry() {
    let no_match = item_ids(&word_menu_definition_with_reference(FLAGGED, false));
    let control = item_ids(&word_menu_definition_with_reference(FLAGGED, true));

    assert!(
        !no_match.contains(&LOOK_UP_REFERENCE_ITEM_ID),
        "an unmatched word must not offer a lookup with nothing in it: {no_match:?}"
    );
    assert!(
        control.contains(&LOOK_UP_REFERENCE_ITEM_ID),
        "the same menu with a match must offer it, or the omission means nothing: {control:?}"
    );
}

#[test]
fn s_104_should_relay_the_lookup_under_its_own_id_and_leave_the_other_routes_alone() {
    assert_eq!(
        menu_event(LOOK_UP_REFERENCE_ITEM_ID),
        Some(MenuEvent {
            name: MENU_EVENT_NAME,
            id: LOOK_UP_REFERENCE_ITEM_ID,
        })
    );
    assert_eq!(
        menu_event(THESAURUS_ITEM_ID),
        Some(MenuEvent {
            name: MENU_EVENT_NAME,
            id: THESAURUS_ITEM_ID,
        })
    );
    assert_eq!(
        menu_event(LEARN_SPELLING_ITEM_ID),
        Some(MenuEvent {
            name: MENU_EVENT_NAME,
            id: LEARN_SPELLING_ITEM_ID,
        })
    );
}
