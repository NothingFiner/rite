#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod document;
mod history;
mod state;

use commands::{
    apply_text_style, autosave_document, change_section_type, delete_section, get_document,
    list_history, merge_paragraphs, open_document, reconstruct_version, redo, rename_section,
    replace_all, replace_current, save_document, save_snapshot, search_document, split_paragraph,
    sync_document, undo,
};
use state::AppState;

fn main() {
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            get_document,
            delete_section,
            rename_section,
            change_section_type,
            apply_text_style,
            split_paragraph,
            merge_paragraphs,
            search_document,
            replace_current,
            replace_all,
            save_document,
            open_document,
            autosave_document,
            save_snapshot,
            list_history,
            reconstruct_version,
            sync_document,
            undo,
            redo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
