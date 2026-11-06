//! Native application menu — behaviour tests (SPEC.md S-001 … S-025).
//!
//! The menu is specified as plain data, and the tests inspect the data
//! (`definition()` / `menu_event`).
//!
//! v1 could also inspect a *built* menu, because its menu types were plain
//! structs. v2 cannot: a menu object needs a `Manager`, and on macOS the
//! underlying `muda` crate panics unless it is created on the main thread —
//! which a `cargo test` worker thread is not. So the four tests that used to
//! render a built menu now lock the data that build reads, and the built menu
//! itself is covered by the manual QA checklist in SPEC.md. Nothing about the
//! menu contract was weakened: the ids, labels, order and event mapping are all
//! still asserted here.
//!
//! Every test asserts; none of them relies on a helper panic to fail. A panic
//! would be a broken test, not a red behaviour.

use rite_lib::menu::{definition, menu_event, MenuEvent, MenuNode, NativeItem, MENU_EVENT_NAME};
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
    // v2 builds from exactly this data; see the module comment for why the built
    // menu is not asserted here.
    let definition = definition();
    for (name, nodes) in [
        ("app", &definition.app),
        ("File", &definition.file),
        ("Edit", &definition.edit),
        ("Window", &definition.window),
    ] {
        assert!(!nodes.is_empty(), "the {name} submenu must define nodes");
    }

    let kinds: Vec<&str> = definition
        .file
        .iter()
        .map(|node| match node {
            MenuNode::Separator => "separator",
            MenuNode::Item { .. } => "item",
            MenuNode::Native { .. } => "native",
        })
        .collect();

    assert_eq!(kinds.first(), Some(&"item"), "the File menu opens on Open");
    assert!(
        kinds.contains(&"separator"),
        "the File menu groups its items with separators"
    );
    assert!(
        !kinds.contains(&"native"),
        "every File item is app-owned; an OS-handled item would emit no event"
    );
}

#[test]
fn s_007_should_install_the_canonical_menu_on_the_app_builder() {
    // `run()` installs `app_menu()`, which builds `definition()`. Neither the
    // builder's menu field nor a built menu is reachable from here, so this locks
    // the input instead: the canonical definition is complete, and every id it
    // declares for File or Edit is one the event mapper really routes.
    let definition = definition();
    assert!(
        !definition.app.is_empty(),
        "the app submenu must not be empty"
    );

    let mut routed = 0;
    for node in definition.file.iter().chain(definition.edit.iter()) {
        if let MenuNode::Item { id, .. } = node {
            assert_eq!(
                menu_event(id).map(|event| event.id),
                Some(*id),
                "every File/Edit item must be routed to the frontend"
            );
            routed += 1;
        }
    }
    assert!(routed >= 10, "the File and Edit menus own the app's items");
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
    assert!(
        separators > 0,
        "the menus must define separators as separators"
    );

    // A separator is data, not an id: it carries no id of its own, so nothing
    // reaches the event mapper from it.
    assert!(
        definition
            .file
            .iter()
            .any(|node| matches!(node, MenuNode::Separator)),
        "the File submenu must contain separators"
    );
    assert_eq!(menu_event("separator"), None);
}

#[test]
fn s_010_should_ignore_an_id_it_does_not_own_without_panicking() {
    // Guard against a vacuously green stub: the mapper must own something first.
    assert!(
        menu_event("save").is_some(),
        "the mapper must own at least one id"
    );

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

    // The app submenu holds only OS-handled items, so nothing in it routes.
    assert!(
        definition()
            .app
            .iter()
            .all(|node| matches!(node, MenuNode::Native { .. })),
        "every application-menu item is OS-handled"
    );
    assert_eq!(menu_event("quit"), None);
    assert_eq!(menu_event("hide"), None);
}
