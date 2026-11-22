//! The reference lookup: whole-word containment over the record (S-097 … S-101)
//! and the `References` submenu that shows it (S-102 … S-104, S-108 … S-110).
//!
//! One binary rather than two, because `cargo test` stops after the first
//! failing target. Split apart, a red matcher would hide the menu's tests from
//! anything that reads the runner's output.
//!
//! The lookup is looser than link resolution, which needs whole-text equality,
//! and looser than the mention scan. A negative case carries a word that must
//! match beside it, or an unimplemented scan would pass it.

use rite_lib::menu::{
    lookup_entry_id, lookup_item_id, menu_event, word_menu_definition_with_reference, MenuEvent,
    MenuNode, SpellingState, LEARN_SPELLING_ITEM_ID, LOOK_UP_REFERENCE_ITEM_ID, MENU_EVENT_NAME,
    REFERENCE_SUBMENU_LABEL, THESAURUS_ITEM_ID,
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
/// the submenu's place among the other app-owned items is exercised.
const FLAGGED: SpellingState = SpellingState {
    flagged: true,
    learned: false,
    can_ignore: true,
};

/// The one submenu in a word menu, whatever else the menu holds.
fn submenu(nodes: &[MenuNode]) -> Option<(&'static str, &[MenuNode])> {
    nodes.iter().find_map(|node| match node {
        MenuNode::Submenu { label, items } => Some((*label, items.as_slice())),
        _ => None,
    })
}

fn lookup_labels(items: &[MenuNode]) -> Vec<String> {
    items
        .iter()
        .filter_map(|node| match node {
            MenuNode::LookupItem { label, .. } => Some(label.clone()),
            _ => None,
        })
        .collect()
}

fn lookup_ids(items: &[MenuNode]) -> Vec<String> {
    items
        .iter()
        .filter_map(|node| match node {
            MenuNode::LookupItem { id, .. } => Some(id.clone()),
            _ => None,
        })
        .collect()
}

fn menu_for(matches: &[ReferenceMatch]) -> Vec<MenuNode> {
    word_menu_definition_with_reference(FLAGGED, matches)
}

#[test]
fn s_102_should_offer_the_references_submenu_when_the_word_matches_an_entry() {
    let matches = entries_for_word(&record(), "Qualen");
    let nodes = menu_for(&matches);

    let found = submenu(&nodes).expect("a matching word should offer the submenu");
    assert_eq!(
        found.0, REFERENCE_SUBMENU_LABEL,
        "the submenu is labelled so the entries are not bare rows"
    );
    assert_eq!(
        found.1.len(),
        2,
        "both entries the word belongs to belong in the submenu"
    );
    assert!(
        matches!(nodes.first(), Some(MenuNode::Item { id, .. }) if *id == THESAURUS_ITEM_ID),
        "the thesaurus stays first: {nodes:?}"
    );
}

#[test]
fn s_103_should_omit_the_submenu_when_the_word_matches_no_entry() {
    let empty: Vec<ReferenceMatch> = Vec::new();
    let none = menu_for(&empty);
    let one = menu_for(&entries_for_word(&record(), "Izi"));

    assert!(
        submenu(&none).is_none(),
        "an unmatched word must not open a submenu with nothing in it: {none:?}"
    );
    assert!(
        submenu(&one).is_some(),
        "the same menu with a match must offer it, or the omission means nothing"
    );
}

#[test]
fn s_104_should_relay_a_lookup_id_under_that_same_id_leaving_other_routes_alone() {
    let id = lookup_item_id("e-queln");

    assert_eq!(
        lookup_entry_id(&id),
        Some("e-queln"),
        "the relay must read the entry back out of the id it emitted"
    );
    assert_eq!(
        menu_event(&id),
        None,
        "one recogniser owns the prefix; the fixed-id table must not also match it"
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
    assert_eq!(
        lookup_entry_id(THESAURUS_ITEM_ID),
        None,
        "a fixed route is not a lookup id"
    );
}

#[test]
fn s_108_should_group_the_matches_under_one_submenu_node() {
    let two = menu_for(&entries_for_word(&record(), "Qualen"));
    let one = menu_for(&entries_for_word(&record(), "Izi"));

    assert_eq!(
        two.len(),
        one.len(),
        "a second match must not add a row to the popup: {two:?}"
    );
    let submenus = two
        .iter()
        .filter(|node| matches!(node, MenuNode::Submenu { .. }))
        .count();
    assert_eq!(submenus, 1, "one submenu groups them all: {two:?}");
}

#[test]
fn s_109_should_label_each_item_with_its_entry_name_and_kind() {
    let nodes = menu_for(&entries_for_word(&record(), "Qualen"));
    let (_, items) = submenu(&nodes).expect("Qualen matches two entries");

    assert_eq!(
        lookup_labels(items),
        vec![
            "Izildar Qualen (Character)".to_string(),
            "Qualen Square (Place)".to_string(),
        ],
        "the record's order, and each label carrying the kind that tells them apart"
    );
}

#[test]
fn s_110_should_give_each_item_an_id_that_names_its_entry() {
    let nodes = menu_for(&entries_for_word(&record(), "Qualen"));
    let (_, items) = submenu(&nodes).expect("Qualen matches two entries");

    assert_eq!(
        lookup_ids(items),
        vec![
            lookup_item_id("e-qualen"),
            lookup_item_id("e-square"),
        ],
        "each id names the entry it opens, in the record's order"
    );
    for id in lookup_ids(items) {
        let entry_id = lookup_entry_id(&id).expect("a lookup id parses back to its entry");
        assert!(
            entry_id.starts_with('e'),
            "the parsed id is the entry's own: {entry_id}"
        );
    }
    assert_eq!(
        lookup_entry_id(LOOK_UP_REFERENCE_ITEM_ID),
        None,
        "the bare prefix names no entry, so it opens nothing"
    );
}
