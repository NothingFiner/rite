#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod document;
mod state;

use commands::{
    apply_delta, apply_format, autosave, delete_heading, get_document, insert_heading,
    merge_paragraphs, open_document, redo, rename_section, replace_all, replace_current,
    save_document, search_document, set_paragraph_style, split_paragraph, sync_document, undo,
};
use state::AppState;

fn main() {
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            get_document,
            apply_delta,
            insert_heading,
            delete_heading,
            rename_section,
            apply_format,
            split_paragraph,
            merge_paragraphs,
            set_paragraph_style,
            search_document,
            replace_current,
            replace_all,
            save_document,
            open_document,
            autosave,
            sync_document,
            undo,
            redo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
