//! Binary entry point.
//!
//! The application itself lives in the library target (`src/lib.rs`): the
//! module tree, the managed state, and the command handler list are all there
//! so that integration tests under `src-tauri/tests/` can import them. Keep
//! this file a shell — re-declaring `mod` here would compile every module (and
//! every inline `#[cfg(test)]` module) a second time.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    rite_lib::run();
}
