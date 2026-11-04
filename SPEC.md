# SPEC — Restored word menu (roadmap 5.15): standard items and spelling actions

Approved sentences, one per behaviour, each with the layer that proves it. Every
sentence is observable and testable on its own, and every test name in the repo
starts with its ID (see `.workflow/TESTING.md`).

Supersedes the 5.11 thesaurus spec, which is preserved in git history at
`17ba6d3` (PR #16).

## Context

### Why this exists

Roadmap 5.11 took over the right-click menu over a single word in the editor:
`useThesaurus` calls `preventDefault()` and asks Rust to pop a native menu. That
menu contains **one** item, `Thesaurus…`. The menu it replaced was **WKWebView's
own**, which offered Cut, Copy, Paste, Select All, Look Up and — on a flagged
word — Learn/Ignore/Unlearn Spelling. So on any single word (that is, almost
everywhere in the editor) the standard editing items and the spelling actions
disappeared.

This item restores them. It is not a new menu system: it adds items to the word
menu the thesaurus already pops.

### What can and cannot be restored

- **Cut, Copy, Paste, Select All** must be Tauri `PredefinedMenuItem`s, i.e. the
  OS/native items the application Edit menu already uses (`menu.rs`
  `native_item()`). This is not a preference: `editorDisplay.vue`'s `onPaste`
  handler strips pasted content to plain text, and it runs because the *browser*
  raises a `paste` event. JavaScript cannot synthesise a paste with clipboard
  contents, so an app-owned Paste would paste nothing or stale data. Cut and
  Copy have the same character — they act on the focused webview's selection.
- **Look Up** (the system dictionary) has no Tauri equivalent and no API. Out of
  scope.
- **Change Spelling…** (the suggestions list) is likewise WebKit's own. Out of
  scope.
- **Learn / Unlearn / Ignore Spelling** are not exposed as predefined items
  either, so they must be app-owned. They are reachable through `NSSpellChecker`
  (the `objc` crate is already a macOS-only dependency of this crate).

### How the spell-checker state actually works

Two different scopes, which is why both actions are needed:

- `NSSpellChecker.learnWord(_:)` writes the user's **global** learned-words list
  for the language. WebKit consults it, so learning clears the squiggle
  everywhere, in every document and application.
- `ignoreWord(_:inSpellDocumentWithTag:)` is keyed on a **spell-document tag** —
  a handle identifying one spell-checking session. WebKit owns that session, so
  an ignore must be recorded under *WebKit's* tag or the marker will not clear.

Verified on this machine (2026-11-03, swift probe against the live
`NSSpellChecker` and `WKWebView` classes):

```
ignore the word under tag 4242 -> flagged under 4242: false, under 9999: true, under 0: true
learnWord                      -> flagged under 0: false, under 7777: false
unlearnWord                    -> flagged again
WKWebView selectors            -> "ignoreSpelling:", "changeSpelling:", "checkSpelling:",
                                  "_spellCheckerDocumentTag"
WKWebView spell document tag   -> 1
```

So `_spellCheckerDocumentTag` **is** readable at runtime and Ignore **can** clear
the marker. It is a private, underscored accessor — a single property read with
no side effects. If a future WebKit stops publishing it, the fallback is to omit
the Ignore item (S-014): never ship a menu item that cannot take effect.

### Testability seams (no test layer has a live WKWebView)

1. **The menu is plain data.** `word_menu_definition(spelling)` returns
   `Vec<MenuNode>` — the same node type the static application menu uses, so
   order and item kinds are assertable without building a real menu (which in
   Tauri v2 needs a `Manager` and, for `muda` popups, the macOS main thread).
2. **The menu takes state, it does not query.** `spelling_state(&dyn
   SpellingCheck, word)` performs the queries; the definition is a pure function
   of the resulting `SpellingState`. Tests drive the state directly.
3. **The spell checker is a trait.** `SpellingCheck` is implemented for real by
   the macOS `NSSpellChecker` path and by a fake in tests. **Tests must never
   touch the real checker**: `learnWord` mutates the user's system dictionary,
   and a test that learns "zzqqxwv" would dirty a real person's machine.
4. `apply_spelling_action(check, id, word)` is the single place that turns a menu
   id into a checker call, so S-009/S-010 are testable through the seam.

The command itself gains the word: `show_word_menu(window, x, y, word)`.

### Amendments to existing tests (made by the spec author)

- `src-tauri/tests/thesaurus.rs` `s_011_the_word_menu_is_one_thesaurus_item`
  asserted the word menu was **exactly one item**. It is no longer, so it now
  asserts the thesaurus item is *present* with that id and label. Its intent —
  the popover is reachable from the word menu — is unchanged.
- `src/composables/useThesaurus.test.js` S-018 asserted the exact payload
  `{ x, y }`. The payload gains `word`, so the assertion gains it too.
- `src/composables/useThesaurus.js` passes the **core** word (leading and
  trailing punctuation stripped — the same value the lookup uses), not the raw
  slice including a trailing comma.

### Manual QA (not automatable)

- Cut / Copy / Paste / Select All from the word menu act on the editor exactly as
  the keyboard does; Paste still arrives as a browser `paste` event, so
  `onPaste` strips it to plain text.
- Learn clears the squiggle immediately; Unlearn restores it.
- Ignore clears the squiggle and leaves the word unlearned.
- A flagged word with no suggestions still gets the spelling items.

## Sentences

### Rust — the menu's shape (plain data, no runtime needed)

- **S-001** (rust): over a word the spell checker flags and the user has not learned, the word menu should be, in order: `Thesaurus…`, a separator, `Cut`, `Copy`, `Paste`, `Select All`, a separator, `Learn Spelling`, `Ignore Spelling`.
- **S-002** (rust): over a word the spell checker flags and the user has learned, the spelling section should be `Unlearn Spelling` and `Ignore Spelling`.
- **S-003** (rust): over a word the spell checker does not flag, the menu should end at `Select All` — no trailing separator, no spelling item.
- **S-004** (rust): `Cut`, `Copy`, `Paste` and `Select All` should be native predefined items, so activating any of them raises no `menu` event; only `thesaurus`, `learn_spelling`, `unlearn_spelling` and `ignore_spelling` are app-owned.
- **S-005** (rust): `Thesaurus…` should keep id `thesaurus` and still route through `menu_event`, and the static application menu should still not contain it.
- **S-006** (rust): the menu should be built from the same plain-data node types as the static application menu, with every app-owned item carrying a non-empty id and label and separators used only where the order says they are.
- **S-007** (rust): the definition should be a pure function of the word's spelling state — misspelled or not, learned or not — so no test needs a live webview, and asking for the same state twice yields the same menu.

### Rust — the spell-checker seam

- **S-008** (rust): the word menu should ask the spell checker about the right-clicked word through one seam — `spelling_state(check, word)`, which records what it asked and returns flagged/learned/ignorable — and hand that answer to the definition, rather than the definition querying anything itself.
- **S-009** (rust): activating `Learn Spelling` should add the word to the spell checker's learned words, and `Unlearn Spelling` should remove it.
- **S-010** (rust): activating `Ignore Spelling` should ignore the word for the webview's own spell-check document, leaving it unlearned.
- **S-014** (rust): when the spell checker cannot be pointed at the webview's spell-check document, the menu should omit `Ignore Spelling` rather than offer an item that cannot take effect, and still offer `Learn Spelling`.

### Frontend

- **S-011** (unit): the takeover should pass the click point's word — the same core the lookup uses, with leading and trailing punctuation stripped — to `show_word_menu` alongside the pointer position.
- **S-012** (unit): a right-click that is not a single word in the editor should still send no word-menu command and leave the native menu alone.
- **S-013** (e2e): right-clicking a word should call `show_word_menu` with `x`, `y` and the stripped word, and leave the document text unchanged.
