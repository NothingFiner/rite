//! Native application menu — behaviour tests (SPEC.md S-001 … S-025).
//!
//! Tauri v1's `Menu` has no getters, so the menu is specified as plain data and
//! the tests inspect both the data (`definition()`) and the built structure
//! (`build_menu`). `Menu`, `Submenu` and `CustomMenuItem` are plain structs with
//! public fields, which is what makes the built menu inspectable here.
//!
//! Every test asserts; none of them relies on a helper panic to fail. A panic
//! would be a broken test, not a red behaviour.

use rite_lib::menu::{
    app_menu, build_menu, definition, menu_event, MenuEvent, MenuNode, NativeItem,
    MENU_EVENT_NAME,
};
use tauri::{Menu, MenuEntry, MenuItem};

const SEP: &str = "—";

fn labels(nodes: &[MenuNode]) -> Vec<&'static str> {
    nodes
        .iter()
        .map(|node| match node {
            MenuNode::Separator => SEP,
            MenuNode::Item { label, .. } => label,
            MenuNode::Native { label, .. } => label,
        })
        .collect()
}

fn item_ids(nodes: &[MenuNode]) -> Vec<&'static str> {
    nodes
        .iter()
        .filter_map(|node| match node {
            MenuNode::Item { id, .. } => Some(*id),
            _ => None,
        })
        .collect()
}

fn id_accels(nodes: &[MenuNode]) -> Vec<(&'static str, Option<&'static str>)> {
    nodes
        .iter()
        .filter_map(|node| match node {
            MenuNode::Item {
                id, accelerator, ..
            } => Some((*id, *accelerator)),
            _ => None,
        })
        .collect()
}

fn render_entry(entry: &MenuEntry) -> String {
    match entry {
        MenuEntry::CustomItem(item) => format!("item:{}", item.id_str),
        MenuEntry::NativeItem(MenuItem::Separator) => "separator".to_string(),
        MenuEntry::NativeItem(item) => format!("native:{item:?}"),
        MenuEntry::Submenu(sub) => format!("submenu:{}", sub.title),
    }
}

/// Each top-level submenu with its rendered entries, in order.
fn rendered_submenus(menu: &Menu) -> Vec<(String, Vec<String>)> {
    menu.items
        .iter()
        .filter_map(|entry| match entry {
            MenuEntry::Submenu(sub) => Some((
                sub.title.clone(),
                sub.inner.items.iter().map(render_entry).collect(),
            )),
            _ => None,
        })
        .collect()
}

/// A recursive rendering of a built menu. `Menu` has no `PartialEq`, so this is
/// how two menus are compared.
fn flatten(menu: &Menu) -> Vec<String> {
    let mut out = Vec::new();
    for entry in &menu.items {
        match entry {
            MenuEntry::Submenu(sub) => {
                out.push(format!("submenu:{}", sub.title));
                out.extend(flatten(&sub.inner));
            }
            other => out.push(render_entry(other)),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// File menu data
// ---------------------------------------------------------------------------

#[test]
fn s_001_should_expose_the_file_menu_as_ordered_plain_data() {
    let file = definition().file;
    assert!(!file.is_empty(), "the File menu must define nodes");

    let mut items = 0;
    let mut separators = 0;
    for node in &file {
        match node {
            MenuNode::Separator => separators += 1,
            MenuNode::Item { id, label, .. } => {
                items += 1;
                assert!(!id.is_empty(), "every item needs a stable id");
                assert!(!label.is_empty(), "every item needs a label");
            }
            _ => {}
        }
    }

    assert!(items > 0, "the File menu must define app-owned items");
    assert!(separators > 0, "the File menu must define separators");
    assert_eq!(
        items + separators,
        file.len(),
        "the File menu holds only separators and items"
    );
}

#[test]
fn s_002_should_list_the_file_items_in_order_with_separators() {
    assert_eq!(
        labels(&definition().file),
        vec![
            "New…",
            "Open…",
            SEP,
            "Save",
            "Save As…",
            SEP,
            "Import…",
            "Export .txt",
            "Export .md",
            "Export .docx",
            "Export .epub",
        ]
    );
}

#[test]
fn s_003_should_give_every_file_item_a_unique_id() {
    let ids = item_ids(&definition().file);
    assert!(!ids.is_empty(), "the File menu must define item ids");

    let mut unique = ids.clone();
    unique.sort_unstable();
    unique.dedup();
    assert_eq!(unique.len(), ids.len(), "duplicate id in {ids:?}");
}

#[test]
fn s_004_should_use_the_documented_file_ids() {
    assert_eq!(
        item_ids(&definition().file),
        vec![
            "new",
            "open",
            "save",
            "save_as",
            "import",
            "export_plain_text",
            "export_markdown",
            "export_docx",
            "export_epub",
        ]
    );
}

#[test]
fn s_005_should_accelerate_only_new_open_save_and_save_as() {
    assert_eq!(
        id_accels(&definition().file),
        vec![
            ("new", Some("CmdOrCtrl+N")),
            ("open", Some("CmdOrCtrl+O")),
            ("save", Some("CmdOrCtrl+S")),
            ("save_as", Some("CmdOrCtrl+Shift+S")),
            ("import", None),
            ("export_plain_text", None),
            ("export_markdown", None),
            ("export_docx", None),
            ("export_epub", None),
        ]
    );
}

// ---------------------------------------------------------------------------
// Native menu construction
// ---------------------------------------------------------------------------

#[test]
fn s_006_should_build_file_edit_and_window_submenus_matching_the_data() {
    let definition = definition();
    let menu = build_menu(&definition);

    let rendered = rendered_submenus(&menu);
    let titles: Vec<&str> = rendered.iter().map(|(title, _)| title.as_str()).collect();
    assert_eq!(titles, vec!["rite", "File", "Edit", "Window"]);
    assert_eq!(rendered.len(), 4, "one submenu per section plus the app menu");

    let (title, entries) = &rendered[1];
    assert_eq!(title, "File");
    assert_eq!(
        entries.len(),
        definition.file.len(),
        "the File submenu must hold one entry per data node"
    );

    let expected: Vec<String> = definition
        .file
        .iter()
        .map(|node| match node {
            MenuNode::Separator => "separator".to_string(),
            MenuNode::Item { id, .. } => format!("item:{id}"),
            other => format!("unexpected:{other:?}"),
        })
        .collect();

    assert_eq!(entries, &expected);
}

#[test]
fn s_007_should_install_the_canonical_menu_on_the_app_builder() {
    // `Builder`'s menu field is private, so the observable proxy is that
    // `app_menu()` — the value `run()` hands to `.menu()` — is the canonical
    // build. See SPEC.md.
    let installed = app_menu();
    assert!(
        !flatten(&installed).is_empty(),
        "the menu installed on the builder must not be empty"
    );
    assert_eq!(flatten(&installed), flatten(&build_menu(&definition())));
}

// ---------------------------------------------------------------------------
// Event mapping
// ---------------------------------------------------------------------------

#[test]
fn s_008_should_emit_the_menu_event_carrying_the_item_id() {
    assert_eq!(MENU_EVENT_NAME, "menu");

    let definition = definition();
    let app_owned: Vec<&str> = item_ids(&definition.file)
        .into_iter()
        .chain(item_ids(&definition.edit))
        .collect();
    assert_eq!(app_owned.len(), 11, "9 File items plus undo and redo");

    for id in app_owned {
        assert_eq!(
            menu_event(id),
            Some(MenuEvent {
                name: MENU_EVENT_NAME,
                id,
            }),
            "id {id:?} must produce a menu event"
        );
    }
}

#[test]
fn s_009_should_not_emit_an_event_for_a_separator() {
    let definition = definition();
    let mut separators = 0;
    for nodes in [&definition.file, &definition.edit, &definition.window] {
        for node in nodes {
            match node {
                MenuNode::Separator => separators += 1,
                MenuNode::Item { id, .. } => assert_ne!(*id, "separator"),
                MenuNode::Native { .. } => {}
            }
        }
    }
    assert!(separators > 0, "the menus must define separators as separators");

    // The built File submenu must render them as native separators, which
    // cannot produce an event.
    let rendered = rendered_submenus(&build_menu(&definition));
    assert_eq!(rendered.len(), 4);
    assert!(
        rendered[1].1.iter().any(|entry| entry == "separator"),
        "the File submenu must contain native separators"
    );

    // A separator has no id of its own, so no id reaches the event mapper.
    assert_eq!(menu_event("separator"), None);
}

#[test]
fn s_010_should_ignore_an_id_it_does_not_own_without_panicking() {
    // Guard against a vacuously green stub: the mapper must own something first.
    assert!(menu_event("save").is_some(), "the mapper must own at least one id");

    for unknown in ["", "not_a_menu_item", "quit", "cut", "minimize"] {
        assert_eq!(menu_event(unknown), None, "id {unknown:?} is not app-owned");
    }
}

// ---------------------------------------------------------------------------
// Edit menu
// ---------------------------------------------------------------------------

#[test]
fn s_011_should_list_the_edit_items_in_order() {
    assert_eq!(
        labels(&definition().edit),
        vec!["Undo", "Redo", SEP, "Cut", "Copy", "Paste", "Select All"]
    );
}

#[test]
fn s_012_should_own_undo_and_redo_with_their_accelerators() {
    let edit = definition().edit;

    assert_eq!(
        edit.get(0),
        Some(&MenuNode::Item {
            id: "undo",
            label: "Undo",
            accelerator: Some("CmdOrCtrl+Z"),
        })
    );
    assert_eq!(
        edit.get(1),
        Some(&MenuNode::Item {
            id: "redo",
            label: "Redo",
            accelerator: Some("CmdOrCtrl+Shift+Z"),
        })
    );
}

#[test]
fn s_013_should_leave_cut_copy_paste_and_select_all_to_the_webview() {
    let natives: Vec<(&'static str, NativeItem)> = definition()
        .edit
        .iter()
        .filter_map(|node| match node {
            MenuNode::Native { label, item } => Some((*label, *item)),
            _ => None,
        })
        .collect();

    assert_eq!(
        natives,
        vec![
            ("Cut", NativeItem::Cut),
            ("Copy", NativeItem::Copy),
            ("Paste", NativeItem::Paste),
            ("Select All", NativeItem::SelectAll),
        ]
    );

    for id in ["cut", "copy", "paste", "select_all"] {
        assert_eq!(menu_event(id), None, "{id} is native and must not emit");
    }
}

// ---------------------------------------------------------------------------
// Window menu and application menu
// ---------------------------------------------------------------------------

#[test]
fn s_014_should_list_the_window_items_in_order() {
    assert_eq!(
        labels(&definition().window),
        vec!["Minimize", "Fullscreen", "Close Window"]
    );
}

#[test]
fn s_015_should_make_every_window_item_native() {
    let window = definition().window;
    assert!(!window.is_empty(), "the Window menu must define its items");

    let natives: Vec<NativeItem> = window
        .iter()
        .filter_map(|node| match node {
            MenuNode::Native { item, .. } => Some(*item),
            _ => None,
        })
        .collect();

    assert_eq!(
        natives,
        vec![
            NativeItem::Minimize,
            NativeItem::EnterFullScreen,
            NativeItem::CloseWindow,
        ],
        "every Window item must be native"
    );

    for id in ["minimize", "fullscreen", "close_window"] {
        assert_eq!(menu_event(id), None);
    }
}

#[test]
fn s_025_should_put_the_application_menu_first_with_quit_and_hide() {
    assert_eq!(
        definition().app,
        vec![
            MenuNode::Native {
                label: "Quit rite",
                item: NativeItem::Quit,
            },
            MenuNode::Native {
                label: "Hide rite",
                item: NativeItem::Hide,
            },
        ]
    );

    let rendered = rendered_submenus(&build_menu(&definition()));
    assert_eq!(rendered.len(), 4);
    assert_eq!(
        rendered.first().map(|(title, _)| title.as_str()),
        Some("rite"),
        "the application submenu must come first"
    );
    assert_eq!(menu_event("quit"), None);
    assert_eq!(menu_event("hide"), None);
}
