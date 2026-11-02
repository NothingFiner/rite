//! Native application menu.
//!
//! STUB — signatures only. The menu data and the builder are filled in by the
//! implementer; the tests in `src-tauri/tests/menu.rs` describe the required
//! behaviour. See SPEC.md.
//!
//! Why the menu is defined as data: Tauri v1's `Menu` exposes no getters, so a
//! built menu cannot be inspected. A plain-data definition is the test seam;
//! `build_menu` is the only place that touches Tauri's menu types.

use tauri::Menu;

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
    MenuDefinition::default()
}

/// The event for an activated menu item id, or `None` when this app does not own it.
pub fn menu_event(_menu_item_id: &str) -> Option<MenuEvent> {
    None
}

/// Build the native menu described by `definition`.
pub fn build_menu(_definition: &MenuDefinition) -> Menu {
    Menu::new()
}

/// The menu `run` installs on the app builder.
pub fn app_menu() -> Menu {
    build_menu(&definition())
}
