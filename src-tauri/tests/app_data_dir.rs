//! App data directory resolution — behaviour tests (SPEC.md S-016 … S-018).
//!
//! Tauri v2 changed `app_data_dir()` from `Option<PathBuf>` to a `Result`. The
//! migration's rule is that an unresolvable app data directory is **surfaced**,
//! not swallowed into a fallback: both the roles dir (user-authored roles) and
//! the index sidecar dir (history/index state) must fail with a message that
//! names the app data directory, because the alternative is silently reading and
//! writing somewhere the user will never find.
//!
//! The commands themselves take an `AppHandle`, which cannot be pointed at a
//! bad path, so the resolvers are split into `*_in(Option<PathBuf>)` seams. That
//! is also what keeps these tests free of the Tauri runtime.

use rite_lib::llm::{list_roles_from, roles_dir_in};
use rite_lib::sidecar::indexes_dir_in;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

/// What every unresolved-directory error must say, so a user reading a toast
/// learns which directory failed rather than seeing a bare OS error.
fn mentions_app_data_dir(message: &str) -> bool {
    message.to_lowercase().contains("app data dir")
}

/// A base directory holding one user role file, in the frontmatter format
/// `load_user_roles` parses.
fn base_with_user_role(name: &str, description: &str, persona: &str) -> (TempDir, PathBuf) {
    let dir = TempDir::new().expect("scratch dir");
    let roles = dir.path().join("roles");
    fs::create_dir_all(&roles).expect("roles dir");
    fs::write(
        roles.join(format!("{}.md", name)),
        format!("---\nname: {}\ndescription: {}\n---\n\n{}\n", name, description, persona),
    )
    .expect("role file");
    let base = dir.path().to_path_buf();
    (dir, base)
}

// ---------------------------------------------------------------- S-016 roles

#[test]
fn s_016_roles_dir_names_the_app_data_dir_when_the_base_is_unresolved() {
    let error = roles_dir_in(None).expect_err("an unresolved app data dir must be an error");

    assert!(
        mentions_app_data_dir(&error),
        "the error must name the app data directory, got {error:?}"
    );
}

#[test]
fn s_016_roles_dir_resolves_under_the_base_and_creates_it() {
    let dir = TempDir::new().expect("scratch dir");
    let base = dir.path().to_path_buf();

    let resolved = roles_dir_in(Some(base.clone())).expect("a resolved base must yield the roles dir");

    assert_eq!(resolved, base.join("roles"), "roles live directly under app data");
    assert!(
        resolved.is_dir(),
        "the roles dir must be created on first use, otherwise saving a role fails"
    );
}

// -------------------------------------------------------------- S-017 sidecar

#[test]
fn s_017_indexes_dir_names_the_app_data_dir_when_the_base_is_unresolved() {
    let error = indexes_dir_in(None).expect_err("an unresolved app data dir must be an error");

    assert!(
        mentions_app_data_dir(&error),
        "the error must name the app data directory, got {error:?}"
    );
}

#[test]
fn s_017_indexes_dir_resolves_under_the_base_without_creating_it() {
    let dir = TempDir::new().expect("scratch dir");
    let base = dir.path().to_path_buf();

    let resolved = indexes_dir_in(Some(base.clone())).expect("a resolved base must yield the indexes dir");

    assert_eq!(resolved, base.join("indexes"), "sidecars live under app_data_dir/indexes");
    assert!(
        !resolved.exists(),
        "reading history must not create an empty directory as a side effect"
    );
}

// ------------------------------------------------------------------ S-018 roles

#[test]
fn s_018_list_roles_returns_built_ins_when_no_user_dir_exists_yet() {
    // A fresh install: the base resolves, but `roles/` was never created.
    let dir = TempDir::new().expect("scratch dir");
    let base = dir.path().to_path_buf();

    let roles = list_roles_from(Some(base)).expect("a fresh install must not be an error");

    assert!(!roles.is_empty(), "built-in roles must still load");
    assert!(
        roles.iter().all(|role| role.is_built_in),
        "a missing user dir must not produce user roles"
    );
    assert!(
        roles.iter().any(|role| role.name == "Writing Assistant"),
        "the default writing assistant is part of the built-ins"
    );
}

#[test]
fn s_018_list_roles_names_the_app_data_dir_when_the_base_is_unresolved() {
    let error = list_roles_from(None).expect_err("an unresolved app data dir must be an error");

    assert!(
        mentions_app_data_dir(&error),
        "the error must name the app data directory, got {error:?}"
    );
}

#[test]
fn s_018_a_user_role_overrides_the_built_in_of_the_same_name() {
    let (_dir, base) = base_with_user_role("Critic", "my critic", "be brutal");

    let roles = list_roles_from(Some(base)).expect("a readable user dir must load");

    let critics: Vec<_> = roles.iter().filter(|role| role.name == "Critic").collect();
    assert_eq!(
        critics.len(),
        1,
        "a user role replaces the built-in of the same name, it does not duplicate it"
    );
    assert!(!critics[0].is_built_in, "the surviving Critic is the user's");
    assert_eq!(critics[0].description, "my critic");
    assert!(
        roles.iter().any(|role| role.name == "Writing Assistant" && role.is_built_in),
        "user roles are merged over the built-ins, not instead of them"
    );
}

#[test]
fn s_018_user_roles_are_listed_in_name_order() {
    let (_dir, base) = base_with_user_role("Beta Reader", "a friend", "be kind");

    let roles = list_roles_from(Some(base)).expect("a readable user dir must load");

    let names: Vec<&str> = roles.iter().map(|role| role.name.as_str()).collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(names, sorted, "the merged list is sorted by name ascending");
    assert!(names.contains(&"Beta Reader"), "the user role is present");
}
