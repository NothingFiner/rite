//! Native application menu.
//!
//! Why the menu is defined as data: the definition is a plain-data seam, so the
//! contract (which items exist, which ids this app owns) can be asserted without
//! a runtime. [`build_menu`] is the only place that touches Tauri's menu types,
//! and [`menu_event`] is the single authority on which ids this app owns: the
//! File items plus undo/redo emit the [`MENU_EVENT_NAME`] window event, while
//! native items (quit, hide, clipboard, window) and separators never emit —
//! the OS or the webview handles them.
//!
//! Tauri v2 needs a `Manager` to create any menu object (v1 menu types were
//! plain structs), so `build_menu` and `app_menu` take one and return a
//! `Result`. The definition, the ids and the event mapping are unchanged.

use tauri::menu::{
    IsMenuItem, Menu, MenuBuilder, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder,
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
