//! Native application menu.
//!
//! Why the menu is defined as data: the definition is a plain-data seam, so the
//! contract (which items exist, which ids this app owns) can be asserted without
//! a runtime. [`build_menu`] is the only place that touches Tauri's menu types,
//! and [`menu_event`] is the single authority on which ids this app owns: the
//! File items plus undo/redo and the on-demand word menu's `thesaurus` item
//! emit the [`MENU_EVENT_NAME`] window event, while native items (quit, hide,
//! clipboard, window) and separators never emit — the OS or the webview handles
//! them. The word menu's spelling items take a different route: the system
//! spell checker has no JS API, so [`show_word_menu`] handles them in Rust.
//!
//! Tauri v2 needs a `Manager` to create any menu object (v1 menu types were
//! plain structs), so `build_menu` and `app_menu` take one and return a
//! `Result`. The definition, the ids and the event mapping are unchanged.

use tauri::menu::{
    ContextMenu, IsMenuItem, Menu, MenuBuilder, MenuItem, PredefinedMenuItem, Submenu,
    SubmenuBuilder,
};
use tauri::{Manager, Runtime};

/// One node of a menu: a separator, an app-owned item, or a native item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MenuNode {
    /// A non-interactive separator.
    Separator,
    /// An app-owned item. Activating it emits a `menu` event carrying `id`.
    Item {
        id: &'static str,
        label: &'static str,
        accelerator: Option<&'static str>,
    },
    /// A native OS item. The OS handles it; it emits no event.
    Native {
        label: &'static str,
        item: NativeItem,
    },
}

/// The native items this app uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeItem {
    Quit,
    Hide,
    Cut,
    Copy,
    Paste,
    SelectAll,
    EnterFullScreen,
    Minimize,
    CloseWindow,
}

/// The full menu definition, one vector per submenu.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MenuDefinition {
    pub app: Vec<MenuNode>,
    pub file: Vec<MenuNode>,
    pub edit: Vec<MenuNode>,
    pub window: Vec<MenuNode>,
}

/// The event an app-owned menu item produces.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MenuEvent {
    pub name: &'static str,
    pub id: &'static str,
}

/// The window event name the frontend listens for.
pub const MENU_EVENT_NAME: &str = "menu";

/// Every id the right-click word menu owns, beside the static menu items.
///
/// The thesaurus route re-emits to the frontend (the popover lives in JS); the
/// spelling routes are handled entirely in Rust, because the system spell
/// checker has no JS API.
pub const WORD_MENU_ITEM_IDS: [&str; 4] = [
    THESAURUS_ITEM_ID,
    LEARN_SPELLING_ITEM_ID,
    UNLEARN_SPELLING_ITEM_ID,
    IGNORE_SPELLING_ITEM_ID,
];

/// The id of the thesaurus item on the right-click word menu.
///
/// This id never appears in the static application menu: it is only offered
/// for a single word, so it is built on demand by [`show_word_menu`]. It still
/// flows through [`menu_event`], so activation travels the same window event
/// as every other app-owned item.
pub const THESAURUS_ITEM_ID: &str = "thesaurus";

/// The id of the spell-checker items on the right-click word menu.
///
/// App-owned like [`THESAURUS_ITEM_ID`]: Tauri v2 has no predefined spelling
/// item, so the action runs in Rust against the system spell checker.
pub const LEARN_SPELLING_ITEM_ID: &str = "learn_spelling";
pub const UNLEARN_SPELLING_ITEM_ID: &str = "unlearn_spelling";
pub const IGNORE_SPELLING_ITEM_ID: &str = "ignore_spelling";

/// What the spell checker knows about the word under the pointer.
///
/// Plain data: the word menu is a function of this and nothing else, so every
/// ordering rule is assertable without a webview, a runtime or AppKit.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SpellingState {
    /// The checker marks the word as misspelled.
    pub flagged: bool,
    /// The word is in the user's learned words.
    pub learned: bool,
    /// An ignore can be recorded against the webview's own spell-check
    /// document. False when WebKit will not report its tag, in which case an
    /// Ignore item could not clear the marker and is left out.
    pub can_ignore: bool,
}

/// The spell checker, as far as the word menu needs it.
///
/// A trait rather than direct `NSSpellChecker` calls so tests can drive the
/// menu without touching the user's real learned-words list (`learn()` mutates
/// it), and so the whole menu is testable on a machine with no WKWebView.
pub trait SpellingCheck {
    /// Whether the checker marks `word` as misspelled.
    fn is_flagged(&self, word: &str) -> bool;
    /// Whether `word` is already in the user's learned words.
    fn has_learned(&self, word: &str) -> bool;
    /// Whether an ignore can be recorded at all (see [`SpellingState::can_ignore`]).
    fn can_ignore(&self) -> bool;
    /// Add `word` to the user's learned words.
    fn learn(&self, word: &str);
    /// Remove `word` from the user's learned words.
    fn unlearn(&self, word: &str);
    /// Ignore `word` for the webview's spell-check document, without learning it.
    fn ignore(&self, word: &str);
}

/// Ask the checker about `word`: the one query the word menu makes.
pub fn spelling_state(check: &dyn SpellingCheck, word: &str) -> SpellingState {
    SpellingState {
        flagged: check.is_flagged(word),
        learned: check.has_learned(word),
        can_ignore: check.can_ignore(),
    }
}

/// Run an app-owned spelling item. Returns an error for an id this does not own.
pub fn apply_spelling_action(check: &dyn SpellingCheck, id: &str, word: &str) -> Result<(), String> {
    match id {
        LEARN_SPELLING_ITEM_ID => check.learn(word),
        UNLEARN_SPELLING_ITEM_ID => check.unlearn(word),
        IGNORE_SPELLING_ITEM_ID => check.ignore(word),
        _ => return Err(format!("not a spelling action id: {id}")),
    }
    Ok(())
}

/// The menu popped over a right-clicked word.
///
/// Plain data on purpose: the contract (order, ids, which items are native) is
/// assertable without a runtime, and building the real menu needs a `Manager`.
pub fn word_menu_definition(spelling: SpellingState) -> Vec<MenuNode> {
    // Thesaurus first (it is why the menu is popped), then the standard edit
    // items the OS handles, then — only for a flagged word — the spelling
    // section. Separators land at indices 1 and 6 of the full menu; a word
    // the checker accepts ends at Select All with no trailing separator.
    let mut nodes = vec![
        MenuNode::Item {
            id: THESAURUS_ITEM_ID,
            label: "Thesaurus…",
            accelerator: None,
        },
        MenuNode::Separator,
        MenuNode::Native {
            label: "Cut",
            item: NativeItem::Cut,
        },
        MenuNode::Native {
            label: "Copy",
            item: NativeItem::Copy,
        },
        MenuNode::Native {
            label: "Paste",
            item: NativeItem::Paste,
        },
        MenuNode::Native {
            label: "Select All",
            item: NativeItem::SelectAll,
        },
    ];
    if spelling.flagged {
        nodes.push(MenuNode::Separator);
        if spelling.learned {
            nodes.push(MenuNode::Item {
                id: UNLEARN_SPELLING_ITEM_ID,
                label: "Unlearn Spelling",
                accelerator: None,
            });
        } else {
            nodes.push(MenuNode::Item {
                id: LEARN_SPELLING_ITEM_ID,
                label: "Learn Spelling",
                accelerator: None,
            });
        }
        // Only offered when an ignore can be recorded against the webview's
        // spell-check document — an Ignore that cannot take effect must not
        // ship (see `SpellingState::can_ignore`).
        if spelling.can_ignore {
            nodes.push(MenuNode::Item {
                id: IGNORE_SPELLING_ITEM_ID,
                label: "Ignore Spelling",
                accelerator: None,
            });
        }
    }
    nodes
}

/// Pop the word menu at the click point, in window coordinates.
///
/// `x` and `y` come from the browser's `contextmenu` event, which reports
/// viewport pixels; the webview fills the window, so they are window pixels.
#[tauri::command]
pub fn show_word_menu<R: Runtime>(
    window: tauri::Window<R>,
    x: f64,
    y: f64,
    word: String,
) -> Result<(), String> {
    let checker = system_spell_check(&window);
    let state = spelling_state(checker.as_ref(), &word);

    let menu = Menu::new(&window).map_err(|error| error.to_string())?;
    // Build whatever the plain-data definition says, the same way `submenu`
    // builds the static menu, and keep the entries alive until the popup has
    // run (muda keeps owning refs to what it is given).
    let entries = word_menu_definition(state)
        .iter()
        .map(|node| node_entry(&window, node))
        .collect::<tauri::Result<Vec<Box<dyn IsMenuItem<R>>>>>()
        .map_err(|error| error.to_string())?;
    for entry in &entries {
        menu.append(entry.as_ref()).map_err(|error| error.to_string())?;
    }

    // Spelling actions run here, never the frontend: the system spell checker
    // has no JS API. This handler fires for menu events from ANY menu (the
    // menu bar included), and each `show_word_menu` replaces the previous
    // registration, so it matches only the spelling ids — `thesaurus` is
    // relayed to the frontend by `run`'s app-wide handler, and native items
    // are handled by the OS — and no-ops on everything else.
    window.on_menu_event(move |_window, event| {
        let id = event.id().0.as_str();
        if matches!(
            id,
            LEARN_SPELLING_ITEM_ID | UNLEARN_SPELLING_ITEM_ID | IGNORE_SPELLING_ITEM_ID
        ) {
            if let Err(error) = apply_spelling_action(checker.as_ref(), id, &word) {
                // Unreachable for these ids (they are the owned ones); logged
                // rather than swallowed so a future id mix-up is visible.
                eprintln!("word-menu spelling action failed: {error}");
            }
        }
    });

    menu.popup_at(window, tauri::LogicalPosition::new(x, y))
        .map_err(|error| error.to_string())
}

/// The system spell checker behind the word menu: the real [`NSSpellChecker`]
/// path on macOS, a stand-in elsewhere — see the cfg'd `spelling_impl`.
///
/// [NSSpellChecker]: https://developer.apple.com/documentation/appkit/nsspellchecker
pub fn system_spell_check<R: Runtime>(
    window: &tauri::Window<R>,
) -> Box<dyn SpellingCheck + Send + Sync> {
    spelling_impl::system_spell_check(window)
}

/// Read the webview's spell-check document tag, once, before the first word
/// menu is ever popped.
///
/// Separate from [`system_spell_check`] because it needs the window at startup
/// and because it is fire-and-forget: the answer arrives on the event loop and
/// [`SpellingCheck::can_ignore`] reports `false` until it does.
pub fn prime_spell_document_tag<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    spelling_impl::prime_spell_document_tag(window)
}

/// The macOS spell-check path behind [`system_spell_check`].
///
/// objc 0.2's macros emit `cfg(cargo-clippy)` checks that the
/// `unexpected_cfgs` lint flags; scoped to this module so the rest of the
/// crate keeps a clean build (same reasoning as
/// `lib.rs::enable_continuous_spellcheck`).
#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
mod spelling_impl {
    use crate::menu::SpellingCheck;
    use objc::msg_send;
    use objc::runtime::{BOOL, NO, Object};
    use objc::{class, sel};
    use objc::sel_impl;
    use std::sync::OnceLock;
    use tauri::Runtime;

    /// The system spell checker, via `NSSpellChecker`.
    ///
    /// Only the spell-document tag is stored: the checker itself is reached
    /// through `sharedSpellChecker` on every call, so no object pointer
    /// outlives a call and a `MacSpellChecker` can sit inside the
    /// `on_menu_event` closure, which must stay `Send + Sync`.
    struct MacSpellChecker {
        /// The webview's spell-check document tag, when WebKit reports it.
        tag: Option<isize>,
    }

    impl MacSpellChecker {
        fn for_window<R: Runtime>(_window: &tauri::Window<R>) -> Self {
            Self {
                tag: SPELL_DOCUMENT_TAG.get().copied(),
            }
        }
    }

    impl SpellingCheck for MacSpellChecker {
        fn is_flagged(&self, word: &str) -> bool {
            objc::rc::autoreleasepool(|| unsafe {
                let checker: *mut Object = msg_send![class!(NSSpellChecker), sharedSpellChecker];
                let ns = ns_string(word);
                let nil: *mut Object = std::ptr::null_mut();
                let mut word_count: isize = 0;
                #[repr(C)]
                struct NSRange {
                    location: usize,
                    length: usize,
                }
                let range: NSRange = msg_send![
                    checker,
                    checkSpellingOfString: ns
                    startingAt: 0usize
                    language: nil
                    wrap: NO
                    inSpellDocumentWithTag: self.tag.unwrap_or(0)
                    wordCount: &mut word_count
                ];
                // A single word was asked about, so a flagged answer starts
                // at offset 0; NSNotFound (with nothing flagged) is not 0.
                range.location == 0 && range.location != usize::MAX
            })
        }

        fn has_learned(&self, word: &str) -> bool {
            objc::rc::autoreleasepool(|| unsafe {
                let checker: *mut Object = msg_send![class!(NSSpellChecker), sharedSpellChecker];
                let ns = ns_string(word);
                let in_dictionaries: BOOL = msg_send![
                    checker,
                    isWordInUserDictionaries: ns caseSensitive: NO
                ];
                in_dictionaries != NO
            })
        }

        fn can_ignore(&self) -> bool {
            self.tag.is_some()
        }

        fn learn(&self, word: &str) {
            objc::rc::autoreleasepool(|| unsafe {
                let checker: *mut Object = msg_send![class!(NSSpellChecker), sharedSpellChecker];
                let ns = ns_string(word);
                let _: () = msg_send![checker, learnWord: ns];
            })
        }

        fn unlearn(&self, word: &str) {
            objc::rc::autoreleasepool(|| unsafe {
                let checker: *mut Object = msg_send![class!(NSSpellChecker), sharedSpellChecker];
                let ns = ns_string(word);
                let _: () = msg_send![checker, unlearnWord: ns];
            })
        }

        fn ignore(&self, word: &str) {
            objc::rc::autoreleasepool(|| unsafe {
                // The flag gates the item, so the tag is present whenever an
                // Ignore is offered; the `is_some` check keeps a missing tag
                // from firing against a made-up document tag that would not
                // clear the webview's marker.
                if let Some(tag) = self.tag {
                    let checker: *mut Object =
                        msg_send![class!(NSSpellChecker), sharedSpellChecker];
                    let ns = ns_string(word);
                    let _: () = msg_send![checker, ignoreWord: ns inSpellDocumentWithTag: tag];
                }
            })
        }
    }

    /// Read the webview's spell-check document tag, if WebKit reports one.
    ///
    /// `_spellCheckerDocumentTag` is a private, underscored WKWebView
    /// property — a single property read with no side effects (verified
    /// 2026-11-03 against the live class). It is guarded by
    /// `respondsToSelector:` because it may vanish in a future WebKit; a
    /// `None` answer then drops the Ignore item (S-014) — never offer one
    /// that cannot take effect.
    /// The tag WebKit uses for this webview's spell-check document, once seen.
    ///
    /// `with_webview` hands the platform webview to a callback on the event
    /// loop; it does not run inline, so the answer cannot be read synchronously
    /// from a command running on the main thread without deadlocking the
    /// dispatch. Instead the tag is read once, early (see
    /// [`prime_spell_document_tag`]), and remembered here. Until it is known no
    /// Ignore item is offered — the fallback S-014 asks for — rather than an
    /// item that cannot take effect.
    static SPELL_DOCUMENT_TAG: OnceLock<isize> = OnceLock::new();

    /// Read the webview's spell-check document tag and remember it.
    ///
    /// Called once at startup. `_spellCheckerDocumentTag` is a private
    /// property, so the send is guarded by `respondsToSelector:`; a WebKit that
    /// stops publishing it simply leaves the tag unset.
    pub fn prime_spell_document_tag<R: Runtime>(window: &tauri::WebviewWindow<R>) {
        let _ = window.with_webview(|platform| {
            let wkwebview = platform.inner() as *mut Object;
            if wkwebview.is_null() {
                return;
            }
            if let Some(tag) = unsafe { read_spell_document_tag(wkwebview) } {
                let _ = SPELL_DOCUMENT_TAG.set(tag);
            }
        });
    }

    /// The private-property read itself. Every call is a message send, so it is
    /// `unsafe` and must run inside an autorelease pool.
    unsafe fn read_spell_document_tag(wkwebview: *mut Object) -> Option<isize> {
        objc::rc::autoreleasepool(|| {
            let responds: BOOL =
                msg_send![wkwebview, respondsToSelector: sel!(_spellCheckerDocumentTag)];
            if responds == NO {
                return None;
            }
            Some(msg_send![wkwebview, _spellCheckerDocumentTag])
        })
    }

    /// An autoreleased `NSString` for `value`; must run inside an autorelease
    /// pool, and can drop right after the message send that takes it.
    ///
    /// `stringWithUTF8String:` reads up to a NUL terminator and a Rust `&str`
    /// is not null-terminated, so wrap it in a `CString` first — the same
    /// pattern `lib.rs::enable_continuous_spellcheck` uses for the
    /// NSUserDefaults keys.
    unsafe fn ns_string(value: &str) -> *mut Object {
        let null_terminated = std::ffi::CString::new(value)
            .expect("spell-checked words contain no interior NUL");
        msg_send![class!(NSString), stringWithUTF8String: null_terminated.as_ptr()]
    }

    pub fn system_spell_check<R: Runtime>(
        window: &tauri::Window<R>,
    ) -> Box<dyn SpellingCheck + Send + Sync> {
        Box::new(MacSpellChecker::for_window(window))
    }
}

/// The non-macOS path behind [`system_spell_check`]: no system spell checker
/// is wired for the word menu on this platform, so a stand-in answers false
/// and does nothing. The menu still pops (thesaurus + standard edit items)
/// but offers no spelling section.
#[cfg(not(target_os = "macos"))]
mod spelling_impl {
    use crate::menu::SpellingCheck;
    use tauri::Runtime;

    /// No system spell checker is wired on this platform, so there is no tag
    /// to read. Kept so `run` can prime unconditionally.
    pub fn prime_spell_document_tag<R: Runtime>(_window: &tauri::WebviewWindow<R>) {}

    /// A stand-in for platforms with no wired checker.
    struct NoSpellChecker;

    impl SpellingCheck for NoSpellChecker {
        fn is_flagged(&self, _word: &str) -> bool {
            false
        }

        fn has_learned(&self, _word: &str) -> bool {
            false
        }

        fn can_ignore(&self) -> bool {
            false
        }

        fn learn(&self, _word: &str) {}

        fn unlearn(&self, _word: &str) {}

        fn ignore(&self, _word: &str) {}
    }

    pub fn system_spell_check<R: Runtime>(
        _window: &tauri::Window<R>,
    ) -> Box<dyn SpellingCheck + Send + Sync> {
        Box::new(NoSpellChecker)
    }
}

/// The canonical menu definition.
pub fn definition() -> MenuDefinition {
    MenuDefinition {
        app: vec![
            MenuNode::Native {
                label: "Quit rite",
                item: NativeItem::Quit,
            },
            MenuNode::Native {
                label: "Hide rite",
                item: NativeItem::Hide,
            },
        ],
        file: vec![
            MenuNode::Item {
                id: "new",
                label: "New…",
                accelerator: Some("CmdOrCtrl+N"),
            },
            MenuNode::Item {
                id: "open",
                label: "Open…",
                accelerator: Some("CmdOrCtrl+O"),
            },
            MenuNode::Separator,
            MenuNode::Item {
                id: "save",
                label: "Save",
                accelerator: Some("CmdOrCtrl+S"),
            },
            MenuNode::Item {
                id: "save_as",
                label: "Save As…",
                accelerator: Some("CmdOrCtrl+Shift+S"),
            },
            MenuNode::Separator,
            MenuNode::Item {
                id: "import",
                label: "Import…",
                accelerator: None,
            },
            MenuNode::Item {
                id: "export_plain_text",
                label: "Export .txt",
                accelerator: None,
            },
            MenuNode::Item {
                id: "export_markdown",
                label: "Export .md",
                accelerator: None,
            },
            MenuNode::Item {
                id: "export_docx",
                label: "Export .docx",
                accelerator: None,
            },
            MenuNode::Item {
                id: "export_epub",
                label: "Export .epub",
                accelerator: None,
            },
        ],
        edit: vec![
            MenuNode::Item {
                id: "undo",
                label: "Undo",
                accelerator: Some("CmdOrCtrl+Z"),
            },
            MenuNode::Item {
                id: "redo",
                label: "Redo",
                accelerator: Some("CmdOrCtrl+Shift+Z"),
            },
            MenuNode::Separator,
            MenuNode::Native {
                label: "Cut",
                item: NativeItem::Cut,
            },
            MenuNode::Native {
                label: "Copy",
                item: NativeItem::Copy,
            },
            MenuNode::Native {
                label: "Paste",
                item: NativeItem::Paste,
            },
            MenuNode::Native {
                label: "Select All",
                item: NativeItem::SelectAll,
            },
        ],
        window: vec![
            MenuNode::Native {
                label: "Minimize",
                item: NativeItem::Minimize,
            },
            MenuNode::Native {
                label: "Fullscreen",
                item: NativeItem::EnterFullScreen,
            },
            MenuNode::Native {
                label: "Close Window",
                item: NativeItem::CloseWindow,
            },
        ],
    }
}

/// The event for an activated menu item id, or `None` when this app does not own it.
///
/// Read straight from [`definition`], so the data is the single source of
/// truth: exactly the File items plus undo/redo own an event, as does the
/// on-demand word menu's [`THESAURUS_ITEM_ID`]; everything else — separators,
/// native items, unknown strings — yields `None`.
pub fn menu_event(menu_item_id: &str) -> Option<MenuEvent> {
    // The word menu is not in `definition` (it is built on demand, never in
    // the menu bar), so its ids are recognised here beside the static items.
    if let Some(id) = WORD_MENU_ITEM_IDS
        .iter()
        .find(|candidate| **candidate == menu_item_id)
    {
        return Some(MenuEvent {
            name: MENU_EVENT_NAME,
            id,
        });
    }
    let definition = definition();
    definition
        .file
        .iter()
        .chain(definition.edit.iter())
        .find_map(|node| match node {
            MenuNode::Item { id, .. } if *id == menu_item_id => Some(MenuEvent {
                name: MENU_EVENT_NAME,
                id: *id,
            }),
            _ => None,
        })
}

/// Build the native menu described by `definition`: the app submenu first,
/// then File, Edit and Window.
///
/// Separators render as native separators, app-owned items render as items whose
/// id is the node's `id` (accelerator attached only when defined), and native
/// items map onto Tauri's predefined OS-handled items.
pub fn build_menu<R: Runtime, M: Manager<R>>(
    manager: &M,
    definition: &MenuDefinition,
) -> tauri::Result<Menu<R>> {
    let app = submenu(manager, "rite", &definition.app)?;
    let file = submenu(manager, "File", &definition.file)?;
    let edit = submenu(manager, "Edit", &definition.edit)?;
    let window = submenu(manager, "Window", &definition.window)?;

    MenuBuilder::new(manager)
        .items(&[
            &app as &dyn IsMenuItem<R>,
            &file as &dyn IsMenuItem<R>,
            &edit as &dyn IsMenuItem<R>,
            &window as &dyn IsMenuItem<R>,
        ])
        .build()
}

/// One submenu: its title plus one entry per definition node, in order.
fn submenu<R: Runtime, M: Manager<R>>(
    manager: &M,
    title: &str,
    nodes: &[MenuNode],
) -> tauri::Result<Submenu<R>> {
    let entries = nodes
        .iter()
        .map(|node| node_entry(manager, node))
        .collect::<tauri::Result<Vec<Box<dyn IsMenuItem<R>>>>>()?;
    let refs: Vec<&dyn IsMenuItem<R>> = entries.iter().map(|entry| entry.as_ref()).collect();
    SubmenuBuilder::new(manager, title).items(&refs).build()
}

/// Renders one data node as the Tauri menu entry it represents.
fn node_entry<R: Runtime, M: Manager<R>>(
    manager: &M,
    node: &MenuNode,
) -> tauri::Result<Box<dyn IsMenuItem<R>>> {
    Ok(match node {
        MenuNode::Separator => Box::new(PredefinedMenuItem::separator(manager)?),
        MenuNode::Item {
            id,
            label,
            accelerator,
        } => Box::new(MenuItem::with_id(manager, *id, *label, true, *accelerator)?),
        MenuNode::Native { item, .. } => native_item(manager, *item)?,
    })
}

/// Maps the app's native items onto the Tauri predefined items the OS acts on.
///
/// Every variant has a v2 counterpart, so the match is exhaustive and a new
/// `NativeItem` that v2 cannot express is a compile error, not a dropped menu
/// row.
fn native_item<R: Runtime, M: Manager<R>>(
    manager: &M,
    item: NativeItem,
) -> tauri::Result<Box<dyn IsMenuItem<R>>> {
    Ok(match item {
        NativeItem::Quit => Box::new(PredefinedMenuItem::quit(manager, None)?),
        NativeItem::Hide => Box::new(PredefinedMenuItem::hide(manager, None)?),
        NativeItem::Cut => Box::new(PredefinedMenuItem::cut(manager, None)?),
        NativeItem::Copy => Box::new(PredefinedMenuItem::copy(manager, None)?),
        NativeItem::Paste => Box::new(PredefinedMenuItem::paste(manager, None)?),
        NativeItem::SelectAll => Box::new(PredefinedMenuItem::select_all(manager, None)?),
        NativeItem::EnterFullScreen => Box::new(PredefinedMenuItem::fullscreen(manager, None)?),
        NativeItem::Minimize => Box::new(PredefinedMenuItem::minimize(manager, None)?),
        NativeItem::CloseWindow => Box::new(PredefinedMenuItem::close_window(manager, None)?),
    })
}

/// The menu `run` installs on the app builder.
pub fn app_menu<R: Runtime, M: Manager<R>>(manager: &M) -> tauri::Result<Menu<R>> {
    build_menu(manager, &definition())
}
