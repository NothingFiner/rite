//! The real system spell checker, exercised for the answers it gives.
//!
//! Every other test drives the `SpellingCheck` *fake*, which is right — it makes
//! the menu rules exact and keeps the user's dictionary untouched. But a fake
//! never runs a single line of the macOS implementation, and that gap let two
//! defects through in 5.15:
//!
//! - the module did not compile at all (the headless harness builds Linux, where
//!   the `#[cfg(not(target_os = "macos"))]` stand-in is what got compiled), and
//! - it sent `isWordInUserDictionaries:caseSensitive:`, which no NSSpellChecker
//!   responds to, terminating the app the first time a word was right-clicked.
//!
//! The second is the interesting one: a wrong selector is not a wrong answer, it
//! is a crash, and only asking the runtime can catch it. So these tests do two
//! things — *execute* the read-only calls, and *ask about* the mutating ones.
//!
//! What they must NEVER do: `learn`, `unlearn` or `ignore`. Those mutate the
//! running user's system-wide learned words, so a test that called them would
//! dirty a real person's machine (and a test that crashed midway would leave the
//! word learned for good).

use rite_lib::menu::system_spell_check_readonly;

/// A word no dictionary contains, so every spell checker must flag it. Chosen so
/// it cannot be a valid word by accident (no vowel structure, no affix).
const NONSENSE: &str = "zzqqxwv";

/// The opposite fixture: a common word that must never be flagged.
const REAL_WORD: &str = "the";

#[test]
fn the_read_only_checker_cannot_ignore_anything() {
    // No webview, so no spell-check document, so no Ignore item may be offered.
    // This is also what keeps `ignore` unreachable on this path.
    assert!(
        !system_spell_check_readonly().can_ignore(),
        "a checker with no spell-check document must not claim it can ignore"
    );
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{NONSENSE, REAL_WORD};
    use rite_lib::menu::{
        missing_spell_checker_selectors, spell_checker_responds, system_spell_check_readonly,
    };

    #[test]
    fn every_selector_the_module_sends_is_one_the_checker_answers() {
        // The guard for the calls a test may not execute: `learn`, `unlearn` and
        // `ignore` write to the running user's system dictionary, so they are
        // asked about with `instancesRespondToSelector:` rather than sent. A typo
        // in the module fails this test instead of terminating the app.
        let missing = missing_spell_checker_selectors();
        assert!(
            missing.is_empty(),
            "NSSpellChecker cannot answer {missing:?}; sending one terminates the app"
        );
    }

    #[test]
    fn a_selector_that_does_not_exist_is_reported_missing() {
        // Proves the probe above is not vacuously true: this is exactly the
        // plausible-looking name that took the application down, so the runtime
        // must confess it does not answer it.
        assert!(
            !spell_checker_responds("isWordInUserDictionaries:caseSensitive:"),
            "if this ever answers, the probe is not really asking the runtime"
        );
        assert!(!spell_checker_responds("zzzNotASelector:"));
    }

    #[test]
    fn the_system_checker_flags_nonsense_and_accepts_a_real_word() {
        let checker = system_spell_check_readonly();

        // The calls that crashed when their selector was wrong: an unrecognised
        // selector here terminates the test process, which is the signal we want.
        assert!(
            checker.is_flagged(NONSENSE),
            "{NONSENSE} is not a word; the system checker must flag it"
        );
        assert!(
            !checker.is_flagged(REAL_WORD),
            "{REAL_WORD} is a word; the system checker must accept it"
        );
    }

    #[test]
    fn a_word_the_test_has_not_learned_is_not_reported_as_learned() {
        // Read-only: `learn` is never called from a test, because it writes to
        // the running user's system dictionary.
        assert!(
            !system_spell_check_readonly().has_learned(NONSENSE),
            "{NONSENSE} must not be in the user's learned words"
        );
    }
}

/// Not macOS: the stand-in answers without a system spell checker, and says so
/// consistently — nothing flagged, nothing learned, nothing ignorable, no
/// selector answerable. Kept so this file has tests on every platform rather
/// than an empty binary.
#[cfg(not(target_os = "macos"))]
mod everywhere_else {
    use super::{NONSENSE, REAL_WORD};
    use rite_lib::menu::{
        missing_spell_checker_selectors, spell_checker_responds, system_spell_check_readonly,
        SPELL_CHECKER_SELECTORS,
    };

    #[test]
    fn with_no_system_checker_every_selector_is_missing() {
        assert_eq!(
            missing_spell_checker_selectors().len(),
            SPELL_CHECKER_SELECTORS.len()
        );
        assert!(!spell_checker_responds("hasLearnedWord:"));
    }

    #[test]
    fn the_stand_in_answers_consistently_without_a_checker() {
        let checker = system_spell_check_readonly();
        assert!(!checker.is_flagged(NONSENSE));
        assert!(!checker.is_flagged(REAL_WORD));
        assert!(!checker.has_learned(NONSENSE));
        assert!(!checker.can_ignore());
    }
}
