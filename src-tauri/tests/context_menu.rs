//! The restored word menu (SPEC.md S-001 … S-010, S-014).
//!
//! Everything here reads plain data. `word_menu_definition` takes a
//! [`SpellingState`] and returns `MenuNode`s, so order and item kinds are
//! assertable without a runtime — building a real menu needs a `Manager`, and a
//! `muda` popup needs the macOS main thread, neither of which exists in a
//! `cargo test` process.
//!
//! The spell checker is driven through the `SpellingCheck` trait with a fake.
//! That is deliberate: the real implementation calls `NSSpellChecker.learnWord`,
//! which writes the running user's system dictionary, so a test must never touch
//! it.

use std::cell::RefCell;

use rite_lib::menu::{
    apply_spelling_action, definition, menu_event, spelling_state, word_menu_definition, MenuEvent,
    MenuNode, NativeItem, SpellingCheck, SpellingState, IGNORE_SPELLING_ITEM_ID,
    LEARN_SPELLING_ITEM_ID, MENU_EVENT_NAME, THESAURUS_ITEM_ID, UNLEARN_SPELLING_ITEM_ID,
};

/// A spell checker that answers from a fixed script and records what it was told.
struct FakeSpelling {
    flagged: Vec<String>,
    learned: RefCell<Vec<String>>,
    ignored: RefCell<Vec<String>>,
    can_ignore: bool,
    asked: RefCell<Vec<String>>,
}

impl FakeSpelling {
    fn new(flagged: &[&str], learned: &[&str], can_ignore: bool) -> Self {
        Self {
            flagged: flagged.iter().map(|word| word.to_string()).collect(),
            learned: RefCell::new(learned.iter().map(|word| word.to_string()).collect()),
            ignored: RefCell::new(Vec::new()),
            can_ignore,
            asked: RefCell::new(Vec::new()),
        }
    }

    fn learned(&self) -> Vec<String> {
        self.learned.borrow().clone()
    }

    fn ignored(&self) -> Vec<String> {
        self.ignored.borrow().clone()
    }
}

impl SpellingCheck for FakeSpelling {
    fn is_flagged(&self, word: &str) -> bool {
        self.asked.borrow_mut().push(word.to_string());
        self.flagged.iter().any(|candidate| candidate == word)
    }

    fn has_learned(&self, word: &str) -> bool {
        self.asked.borrow_mut().push(word.to_string());
        self.learned.borrow().iter().any(|candidate| candidate == word)
    }

    fn can_ignore(&self) -> bool {
        self.can_ignore
    }

    fn learn(&self, word: &str) {
        self.learned.borrow_mut().push(word.to_string());
    }

    fn unlearn(&self, word: &str) {
        self.learned.borrow_mut().retain(|candidate| candidate != word);
    }

    fn ignore(&self, word: &str) {
        self.ignored.borrow_mut().push(word.to_string());
    }
}

/// The flagged word, not learned, with an ignore available: the fullest menu.
const FLAGGED: SpellingState = SpellingState {
    flagged: true,
    learned: false,
    can_ignore: true,
};

/// A menu node's visible text; separators are shown as `---`.
fn label(node: &MenuNode) -> String {
    match node {
        MenuNode::Separator => "---".to_string(),
        MenuNode::Item { label, .. } => (*label).to_string(),
        MenuNode::Native { label, .. } => (*label).to_string(),
    }
}

fn labels(nodes: &[MenuNode]) -> Vec<String> {
    nodes.iter().map(label).collect()
}

#[test]
fn s_001_a_flagged_unlearned_word_gets_the_standard_items_and_learn_and_ignore() {
    let menu = word_menu_definition(FLAGGED);

    assert_eq!(
        labels(&menu),
        vec![
            "Thesaurus…",
            "---",
            "Cut",
            "Copy",
            "Paste",
            "Select All",
            "---",
            "Learn Spelling",
            "Ignore Spelling",
        ],
        "a flagged, unlearned word gets the full menu, in this order"
    );
}

#[test]
fn s_002_a_flagged_learned_word_offers_unlearn_instead_of_learn() {
    let menu = word_menu_definition(SpellingState {
        flagged: true,
        learned: true,
        can_ignore: true,
    });

    assert_eq!(
        labels(&menu),
        vec![
            "Thesaurus…",
            "---",
            "Cut",
            "Copy",
            "Paste",
            "Select All",
            "---",
            "Unlearn Spelling",
            "Ignore Spelling",
        ],
        "an already-learned word is offered Unlearn, not Learn"
    );
}

#[test]
fn s_003_a_correctly_spelled_word_gets_no_spelling_section() {
    let menu = word_menu_definition(SpellingState {
        flagged: false,
        learned: false,
        can_ignore: true,
    });

    assert_eq!(
        labels(&menu),
        vec![
            "Thesaurus…",
            "---",
            "Cut",
            "Copy",
            "Paste",
            "Select All",
        ],
        "a word the checker accepts ends at Select All: no trailing separator, no spelling item"
    );
}

#[test]
fn s_004_the_edit_items_are_native_and_own_no_menu_event() {
    let menu = word_menu_definition(FLAGGED);

    let native: Vec<NativeItem> = menu
        .iter()
        .filter_map(|node| match node {
            MenuNode::Native { item, .. } => Some(*item),
            _ => None,
        })
        .collect();
    assert_eq!(
        native,
        vec![
            NativeItem::Cut,
            NativeItem::Copy,
            NativeItem::Paste,
            NativeItem::SelectAll,
        ],
        "the edit items must be the OS-handled items: a JS-driven Paste cannot \
         deliver clipboard contents, and onPaste only runs because the browser \
         raises the event"
    );

    // Nothing the OS handles may route through the app's menu event.
    for unowned in ["cut", "copy", "paste", "select_all", "Cut", "Paste"] {
        assert_eq!(
            menu_event(unowned),
            None,
            "{unowned} is a native item and must raise no menu event"
        );
    }

    // The app-owned items are exactly these four, and each one is recognised.
    let owned: Vec<&str> = menu
        .iter()
        .filter_map(|node| match node {
            MenuNode::Item { id, .. } => Some(*id),
            _ => None,
        })
        .collect();
    assert_eq!(
        owned,
        vec![
            THESAURUS_ITEM_ID,
            LEARN_SPELLING_ITEM_ID,
            IGNORE_SPELLING_ITEM_ID,
        ],
        "only the thesaurus and the spelling actions are app-owned"
    );
    for id in owned {
        assert_eq!(
            menu_event(id),
            Some(MenuEvent {
                name: MENU_EVENT_NAME,
                id,
            }),
            "{id} is app-owned, so activating it must raise the menu event"
        );
    }
    assert_eq!(
        menu_event(UNLEARN_SPELLING_ITEM_ID),
        Some(MenuEvent {
            name: MENU_EVENT_NAME,
            id: UNLEARN_SPELLING_ITEM_ID,
        }),
        "unlearn is only offered on an already-learned word, but it is still app-owned"
    );
}

#[test]
fn s_005_the_thesaurus_item_stays_on_the_word_menu_and_out_of_the_menu_bar() {
    assert_eq!(
        menu_event(THESAURUS_ITEM_ID),
        Some(MenuEvent {
            name: MENU_EVENT_NAME,
            id: THESAURUS_ITEM_ID,
        }),
        "Thesaurus… still travels the same window event"
    );

    let menu = word_menu_definition(FLAGGED);
    assert!(
        menu.iter().any(|node| matches!(
            node,
            MenuNode::Item {
                id: THESAURUS_ITEM_ID,
                ..
            }
        )),
        "the word menu still offers Thesaurus…, got {:?}",
        labels(&menu)
    );

    let definition = definition();
    let bar = definition
        .app
        .iter()
        .chain(definition.file.iter())
        .chain(definition.edit.iter())
        .chain(definition.window.iter());
    for node in bar {
        if let MenuNode::Item { id, .. } = node {
            assert_ne!(
                *id, THESAURUS_ITEM_ID,
                "the thesaurus belongs to the word menu, not the static menu bar"
            );
        }
    }
}

#[test]
fn s_006_every_item_carries_an_id_and_a_label_and_separators_only_divide_groups() {
    let menu = word_menu_definition(FLAGGED);

    for node in &menu {
        match node {
            MenuNode::Separator => {}
            MenuNode::Item { id, label, .. } => {
                assert!(!id.is_empty(), "an app-owned item needs an id: {node:?}");
                assert!(
                    !label.trim().is_empty(),
                    "an app-owned item needs a label: {node:?}"
                );
            }
            MenuNode::Native { label, .. } => {
                assert!(
                    !label.trim().is_empty(),
                    "a native item needs a label: {node:?}"
                );
            }
        }
    }

    let separators: Vec<usize> = menu
        .iter()
        .enumerate()
        .filter(|(_, node)| matches!(node, MenuNode::Separator))
        .map(|(index, _)| index)
        .collect();
    assert_eq!(
        separators,
        vec![1, 6],
        "exactly two rules: one under Thesaurus…, one above the spelling actions"
    );
}

#[test]
fn s_007_the_menu_is_a_pure_function_of_the_spelling_state() {
    // Same state, same menu — twice, with nothing in between.
    assert_eq!(
        word_menu_definition(FLAGGED),
        word_menu_definition(FLAGGED),
        "the definition must not depend on anything but the state it is given"
    );

    // And each field of the state changes what the writer sees, which is the
    // proof the definition is a function of the state rather than a constant:
    // `learned` flips Learn to Unlearn, `can_ignore` decides whether Ignore is
    // offered, and `flagged` decides whether the section exists at all.
    let learned = SpellingState {
        learned: true,
        ..FLAGGED
    };
    let no_ignore = SpellingState {
        can_ignore: false,
        ..FLAGGED
    };
    let accepted = SpellingState {
        flagged: false,
        ..FLAGGED
    };
    assert_ne!(word_menu_definition(FLAGGED), word_menu_definition(learned));
    assert_ne!(word_menu_definition(FLAGGED), word_menu_definition(no_ignore));
    assert_ne!(word_menu_definition(FLAGGED), word_menu_definition(accepted));
}

#[test]
fn s_008_the_state_comes_from_one_query_about_the_clicked_word() {
    let fake = FakeSpelling::new(&["teh"], &[], true);

    let state = spelling_state(&fake, "teh");
    assert_eq!(
        state,
        SpellingState {
            flagged: true,
            learned: false,
            can_ignore: true,
        },
        "every field is the checker's answer for the clicked word"
    );

    let asked = fake.asked.borrow().clone();
    assert!(
        !asked.is_empty(),
        "the seam must actually ask the checker, not guess"
    );
    assert!(
        asked.iter().all(|word| word == "teh"),
        "it must ask about the right-clicked word, got {asked:?}"
    );

    // And that answer is what builds the menu: no second query, no divergence.
    assert_eq!(
        labels(&word_menu_definition(state)),
        labels(&word_menu_definition(FLAGGED)),
        "the menu built from the queried state is the flagged menu"
    );
}

#[test]
fn s_009_learn_adds_the_word_and_unlearn_removes_it() {
    let fake = FakeSpelling::new(&["teh"], &[], true);

    apply_spelling_action(&fake, LEARN_SPELLING_ITEM_ID, "teh").expect("learn is ours");
    assert_eq!(
        fake.learned(),
        vec!["teh".to_string()],
        "Learn Spelling adds the word to the user's learned words"
    );

    apply_spelling_action(&fake, UNLEARN_SPELLING_ITEM_ID, "teh").expect("unlearn is ours");
    assert!(
        fake.learned().is_empty(),
        "Unlearn Spelling takes it out again, got {:?}",
        fake.learned()
    );
    assert!(
        fake.ignored().is_empty(),
        "neither action may ignore the word"
    );
}

#[test]
fn s_010_ignore_marks_the_document_and_leaves_the_word_unlearned() {
    let fake = FakeSpelling::new(&["teh"], &[], true);

    apply_spelling_action(&fake, IGNORE_SPELLING_ITEM_ID, "teh").expect("ignore is ours");

    assert_eq!(
        fake.ignored(),
        vec!["teh".to_string()],
        "Ignore Spelling records the word against the webview's spell-check document"
    );
    assert!(
        fake.learned().is_empty(),
        "ignore must not learn the word: it is a document decision, not a global one"
    );
}

#[test]
fn s_014_without_a_spell_document_the_menu_drops_ignore_rather_than_offering_a_no_op() {
    let menu = word_menu_definition(SpellingState {
        can_ignore: false,
        ..FLAGGED
    });

    let items = labels(&menu);
    assert!(
        !items.iter().any(|label| label == "Ignore Spelling"),
        "an ignore that could not clear the marker must not be offered, got {items:?}"
    );
    assert_eq!(
        items,
        vec![
            "Thesaurus…",
            "---",
            "Cut",
            "Copy",
            "Paste",
            "Select All",
            "---",
            "Learn Spelling",
        ],
        "the fallback still offers Learn Spelling, so the writer can clear the marker"
    );

    // A learned word in the same situation still gets Unlearn, never a dead item.
    let learned_menu = labels(&word_menu_definition(SpellingState {
        learned: true,
        can_ignore: false,
        ..FLAGGED
    }));
    assert_eq!(
        learned_menu.last().map(String::as_str),
        Some("Unlearn Spelling")
    );
}
