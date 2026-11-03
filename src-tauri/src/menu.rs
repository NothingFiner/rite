//! Native application menu.
//!
//! Why the menu is defined as data: Tauri v1's `Menu` exposes no getters, so a
//! built menu cannot be inspected. A plain-data definition is the test seam;
//! [`build_menu`] is the only place that touches Tauri's menu types, and
//! [`menu_event`] is the single authority on which ids this app owns: the
//! File items plus undo/redo emit the [`MENU_EVENT_NAME`] window event, while
//! native items (quit, hide, clipboard, window) and separators never emit —
//! the OS or the webview handles them.

use tauri::{CustomMenuItem, Menu, MenuEntry, MenuItem, Submenu};

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
/// truth: exactly the File items plus undo/redo own an event; everything else
/// — separators, native items, unknown strings — yields `None`.
pub fn menu_event(menu_item_id: &str) -> Option<MenuEvent> {
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
/// Separators render as native separators, app-owned items render as custom
/// items whose `id_str` is the node's `id` (accelerator attached only when
/// defined), and native items map onto Tauri's OS-handled items.
pub fn build_menu(definition: &MenuDefinition) -> Menu {
    Menu::with_items([
        Submenu::new("rite", Menu::with_items(definition.app.iter().map(node_entry))).into(),
        Submenu::new("File", Menu::with_items(definition.file.iter().map(node_entry))).into(),
        Submenu::new("Edit", Menu::with_items(definition.edit.iter().map(node_entry))).into(),
        Submenu::new(
            "Window",
            Menu::with_items(definition.window.iter().map(node_entry)),
        )
        .into(),
    ])
}

/// Renders one data node as the Tauri menu entry it represents.
fn node_entry(node: &MenuNode) -> MenuEntry {
    match node {
        MenuNode::Separator => MenuItem::Separator.into(),
        MenuNode::Item {
            id,
            label,
            accelerator,
        } => {
            let item = CustomMenuItem::new(*id, *label);
            match accelerator {
                Some(acc) => item.accelerator(*acc),
                None => item,
            }
            .into()
        }
        MenuNode::Native { item, .. } => menu_item(*item).into(),
    }
}

/// Maps the app's native items onto the Tauri items the OS acts on.
fn menu_item(item: NativeItem) -> MenuItem {
    match item {
        NativeItem::Quit => MenuItem::Quit,
        NativeItem::Hide => MenuItem::Hide,
        NativeItem::Cut => MenuItem::Cut,
        NativeItem::Copy => MenuItem::Copy,
        NativeItem::Paste => MenuItem::Paste,
        NativeItem::SelectAll => MenuItem::SelectAll,
        NativeItem::EnterFullScreen => MenuItem::EnterFullScreen,
        NativeItem::Minimize => MenuItem::Minimize,
        NativeItem::CloseWindow => MenuItem::CloseWindow,
    }
}

/// The menu `run` installs on the app builder.
pub fn app_menu() -> Menu {
    build_menu(&definition())
}
