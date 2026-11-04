//! Native application menu.
//!
//! Why the menu is defined as data: the definition is a plain-data seam, so the
//! contract (which items exist, which ids this app owns) can be asserted without
//! a runtime. [`build_menu`] is the only place that touches Tauri's menu types,
//! and [`menu_event`] is the single authority on which ids this app owns: the
//! File items plus undo/redo and the on-demand word menu's item emit the
//! [`MENU_EVENT_NAME`] window event, while native items (quit, hide, clipboard,
//! window) and separators never emit — the OS or the webview handles them.
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
pub fn spelling_state(_check: &dyn SpellingCheck, _word: &str) -> SpellingState {
    todo!("S-008: flagged/learned/can_ignore for the right-clicked word")
}

/// Run an app-owned spelling item. Returns an error for an id this does not own.
pub fn apply_spelling_action(
    _check: &dyn SpellingCheck,
    _id: &str,
    _word: &str,
) -> Result<(), String> {
    todo!("S-009/S-010: learn, unlearn or ignore the word the menu was opened on")
}

/// The menu popped over a right-clicked word.
///
/// Plain data on purpose: the contract (order, ids, which items are native) is
/// assertable without a runtime, and building the real menu needs a `Manager`.
pub fn word_menu_definition(_spelling: SpellingState) -> Vec<MenuNode> {
    todo!("S-001/S-002/S-003/S-014: thesaurus, edit items, then spelling items")
}

/// Pop the word menu at the click point, in window coordinates.
///
/// `x` and `y` come from the browser's `contextmenu` event, which reports
/// viewport pixels; the webview fills the window, so they are window pixels.
#[tauri::command]
pub fn show_word_menu<R: Runtime>(
    _window: tauri::Window<R>,
    _x: f64,
    _y: f64,
    _word: String,
) -> Result<(), String> {
    todo!("S-008: ask the spell checker about `word`, then pop the menu it yields")
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
