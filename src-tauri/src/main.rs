#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod diff;
mod document;
mod export_docx;
mod export_text;
mod history;
mod llm;
mod retrieval;
mod sidecar;
mod state;
mod structure;
mod summary;

use commands::{
    apply_text_style, autosave_document, change_section_type, delete_section,
    diff_against_current, get_document, list_history, merge_paragraphs, move_section,
    open_document, reconstruct_version, redo, rename_section, replace_all, replace_current,
    restore_version, save_document, save_snapshot, search_document, split_paragraph,
    sync_document, undo,
};
use export_docx::export_docx;
use export_text::export_text;
use llm::{llm_cancel, llm_chat, llm_chat_stream, llm_list_models, list_roles, save_role, delete_role};
use retrieval::{embed_texts, reembed_document, retrieve_passages};
use state::AppState;
use structure::structural_signals;
use summary::{retrieve_stale_summary_section_ids, retrieve_summaries, summarize_and_store_section};

/// Turn on continuous spell checking in the WKWebView before it is created.
///
/// Why this exists: wry/Tauri builds its WKWebView with continuous spell
/// checking OFF by default (Tauri issue #7705), so even though the editor sheet
/// carries `spellcheck="true"`, the red misspelling squiggle never paints. The
/// `spellcheck` HTML attribute alone doesn't flip the *native* WebKit setting
/// that gates the indicator.
///
/// Why NSUserDefaults and not a post-hoc selector: WebKit reads
/// `WebContinuousSpellCheckingEnabled` (and `WebGrammarCheckingEnabled`) from
/// the user defaults when a webview is constructed. Setting it here, at the
/// very top of `main()` and before `tauri::Builder`, means the WKWebView rite
/// creates is born with the flag on — squiggles paint on the *same* launch,
/// with no relaunch. Setting it later (e.g. in `.setup()`) only takes effect
/// after a restart, because the webview already exists by then.
///
/// The rest of the spellcheck story comes free with this flag: with continuous
/// spell checking on, WKWebView's own right-click context menu offers
/// Learn/Ignore/Unlearn Spelling on squiggle-marked words — and clicking Learn
/// clears the marker — so no custom ignore-list command is needed (the 5.8b
/// `objc`/`NSSpellChecker` path was planned for this, then found unnecessary).
/// There is no JS API for any of that, which is why the menu can't be driven
/// from the web side; the native menu already covers it. Verified manually
/// 2026-10-02 in `npx tauri dev` — squiggle rendering and the native menu
/// aren't observable from unit tests (no live WKWebView there).
#[cfg(target_os = "macos")]
// objc 0.2's `msg_send!`/`sel_impl!` macros emit `cfg(cargo-clippy)` checks
// that the modern `unexpected_cfgs` lint flags. It's a known wart of the old
// crate (the macros predate Cargo's cfg-checking); scoped here so the rest of
// the crate keeps a clean build.
#[allow(unexpected_cfgs)]
fn enable_continuous_spellcheck() {
    use objc::class;
    use objc::msg_send;
    use objc::runtime::Object;
    use objc::sel;
    use objc::sel_impl;

    // NSString allocations need an autorelease pool so the temporary key
    // strings don't leak for the lifetime of the process. Every Objective-C
    // message send is `unsafe` (raw pointer dispatch), so the pool body is one
    // `unsafe` block — the only foreign calls here are the well-known
    // `NSUserDefaults`/`NSString` selectors below.
    objc::rc::autoreleasepool(|| unsafe {
        let defaults: *mut Object =
            msg_send![class!(NSUserDefaults), standardUserDefaults];

        // `NSString stringWithUTF8String:` builds the defaults key from a C
        // string. It reads up to a null terminator, so a Rust `&str` (which is
        // *not* null-terminated) can't be handed to it directly — wrap it in a
        // `CString`. The NSString copies the bytes, so the `CString` can drop
        // right after the `msg_send!` returns.
        let make_key = |cstr: &str| -> *mut Object {
            let null_terminated = std::ffi::CString::new(cstr)
                .expect("spellcheck defaults keys contain no interior NUL");
            msg_send![
                class!(NSString),
                stringWithUTF8String: null_terminated.as_ptr()
            ]
        };

        let spell_key = make_key("WebContinuousSpellCheckingEnabled");
        let _: () = msg_send![defaults, setBool: true forKey: spell_key];

        let grammar_key = make_key("WebGrammarCheckingEnabled");
        let _: () = msg_send![defaults, setBool: true forKey: grammar_key];
    });
}

/// No-op on non-macOS platforms — spellcheck enabling is macOS-only (it's a
/// WebKit/WKWebView native setting). Kept so `main()` can call it
/// unconditionally without a `#[cfg]` at the call site.
#[cfg(not(target_os = "macos"))]
fn enable_continuous_spellcheck() {}

fn main() {
    enable_continuous_spellcheck();
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            get_document,
            delete_section,
            rename_section,
            change_section_type,
            move_section,
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
            restore_version,
            diff_against_current,
            sync_document,
            undo,
            redo,
            export_text,
            export_docx,
            list_roles,
            llm_chat,
            llm_chat_stream,
            llm_list_models,
            llm_cancel,
            save_role,
            delete_role,
            embed_texts,
            reembed_document,
            retrieve_passages,
            structural_signals,
            summarize_and_store_section,
            retrieve_summaries,
            retrieve_stale_summary_section_ids,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
