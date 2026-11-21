//! The word-menu item: present for a matching word, absent otherwise, and
//! relayed under its own id (S-102 … S-104).
//!
//! Contents rather than rendering, for the reason `tests/menu.rs` gives: a built
//! menu needs a `Manager` on the main thread. S-103 tests an absence, so the
//! matching case rides beside it.

use rite_lib::menu::{
    menu_event, word_menu_definition_with_reference, MenuEvent, MenuNode, SpellingState,
    LEARN_SPELLING_ITEM_ID, LOOK_UP_REFERENCE_ITEM_ID, MENU_EVENT_NAME, THESAURUS_ITEM_ID,
};

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
