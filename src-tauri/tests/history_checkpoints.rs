//! A history row is written only when the manuscript changed (SPEC.md revision 4,
//! S-075 … S-083).
//!
//! History rows are what the writer browses and restores. A row that duplicates
//! the state before it costs file size and costs real history to compaction,
//! because the embedded list is capped at `max_snapshots`. The three writers share
//! one rule: compare the document with `AppState::last_history_state` (the
//! baseline autosave keeps) and store nothing when that comparison is empty.
//!
//! Several tests below take a no-change save or checkpoint as setup. Without that
//! step the claim passes on its own, because a path that records a row per call
//! satisfies it.
//!
//! Driven through a mock app (the pattern in `tests/save_as_title.rs`) because the
//! commands take `AppHandle` + `State<AppState>`. A second app is built wherever
//! the test has to prove what came off disk rather than what stayed in memory.

use rite_lib::commands::{autosave_document, open_document, save_document, save_snapshot};
use rite_lib::document::{Document, Element, Paragraph, Section, SectionType, TextRun, TextStyle};
use rite_lib::history::{self, HistoryRecord};
use rite_lib::state::AppState;
use std::fs;
use tauri::test::MockRuntime;
use tauri::Manager;

type MockApp = tauri::App<MockRuntime>;

fn mock_app() -> MockApp {
    tauri::test::mock_builder()
        .manage(AppState::new())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app builds without a window or event loop")
}

fn mock_app_with(doc: Document) -> MockApp {
    let app = mock_app();
    set_document(&app, doc);
    app
}

fn doc_with_text(text: &str) -> Document {
    Document {
        title: "T".to_string(),
        author: "A".to_string(),
        author_contact: "C".to_string(),
        has_toc: false,
        sections: vec![Section {
            id: "s1".to_string(),
            section_type: SectionType::Section,
            title: String::new(),
            hidden: false,
            paragraphs: vec![Paragraph {
                id: "p1".to_string(),
                elements: vec![Element {
                    text_run: TextRun {
                        content: text.to_string(),
                        text_style: TextStyle::default(),
                    },
                }],
                left_indent: None,
                right_indent: None,
                first_line_indent: None,
            }],
        }],
    }
}

fn scratch_path(dir: &tempfile::TempDir, name: &str) -> String {
    dir.path().join(name).to_string_lossy().into_owned()
}

fn set_document(app: &MockApp, doc: Document) {
    let state = app.state::<AppState>();
    let mut current = state.document.lock().unwrap();
    current.clone_from(&doc);
}

fn save(app: &MockApp, path: &str) {
    save_document(
        path.to_string(),
        app.handle().clone(),
        app.state::<AppState>(),
    )
    .expect("save_document writes the file");
}

/// The history as it came off disk, so an assertion cannot be satisfied by state
/// that a failed write left behind in memory.
fn rows_on_disk(path: &str) -> Vec<HistoryRecord> {
    let json = fs::read_to_string(path).expect("the saved file is readable");
    history::read_rite_file(&json)
        .expect("the saved file parses as a .rite")
        .history
}

#[test]
fn s_075_the_first_save_records_one_row_and_a_repeat_save_records_none() {
    let dir = tempfile::tempdir().expect("scratch dir");
    let path = scratch_path(&dir, "novel.rite");
    // `Document::default()` equals the baseline `AppState::new` starts at, so a
    // first save that compares content alone would leave this file with no
    // restore point at all.
    let app = mock_app();

    save(&app, &path);
    assert_eq!(
        rows_on_disk(&path).len(),
        1,
        "the first save of a document is the only restore point that file will ever get"
    );

    save(&app, &path);
    assert_eq!(
        rows_on_disk(&path).len(),
        1,
        "a second save of the same content adds no row"
    );
}

#[test]
fn s_076_a_save_of_a_just_opened_document_records_no_row() {
    let dir = tempfile::tempdir().expect("scratch dir");
    let path = scratch_path(&dir, "novel.rite");

    let writer = mock_app_with(doc_with_text("One"));
    save(&writer, &path);
    drop(writer);

    let reader = mock_app();
    open_document(
        path.clone(),
        reader.handle().clone(),
        reader.state::<AppState>(),
    )
    .expect("open_document loads the file");
    save(&reader, &path);

    assert_eq!(
        rows_on_disk(&path).len(),
        1,
        "opening a file sets the baseline, so saving it straight back adds no row"
    );
}

#[test]
fn s_077_an_unchanged_save_leaves_the_file_on_disk_untouched() {
    let dir = tempfile::tempdir().expect("scratch dir");
    let path = scratch_path(&dir, "novel.rite");
    let app = mock_app_with(doc_with_text("One"));
    save(&app, &path);

    // Replacing the file with a marker catches any write at all, including one
    // whose bytes would have come out identical.
    fs::write(&path, "untouched").expect("the scratch file is writable");
    save(&app, &path);

    let after = fs::read_to_string(&path).expect("the file is still there");
    assert!(
        after == "untouched",
        "a save with nothing to record must not rewrite the .rite"
    );
}

#[test]
fn s_078_a_save_of_changed_content_adds_one_row_that_restores_it() {
    let dir = tempfile::tempdir().expect("scratch dir");
    let path = scratch_path(&dir, "novel.rite");
    let app = mock_app_with(doc_with_text("One"));
    save(&app, &path);
    save(&app, &path);

    set_document(&app, doc_with_text("Two"));
    save(&app, &path);

    let history = rows_on_disk(&path);
    assert_eq!(
        history.len(),
        2,
        "one row for the first save and one for the edit"
    );
    let newest = history
        .last()
        .expect("the history has a newest row")
        .timestamp()
        .to_string();
    let restored =
        history::reconstruct_version(&newest, &history).expect("the newest row restores a document");
    assert_eq!(
        restored,
        doc_with_text("Two"),
        "the newest row must hold the content that was saved, not an earlier state"
    );
}

#[test]
fn s_079_a_manual_checkpoint_of_changed_content_adds_one_row() {
    let dir = tempfile::tempdir().expect("scratch dir");
    let path = scratch_path(&dir, "novel.rite");
    let app = mock_app_with(doc_with_text("One"));
    save(&app, &path);

    let unchanged =
        save_snapshot(app.state::<AppState>()).expect("a checkpoint on a saved document succeeds");
    assert_eq!(
        unchanged, None,
        "a checkpoint taken with no edit between has nothing to record"
    );

    set_document(&app, doc_with_text("Two"));
    let recorded = save_snapshot(app.state::<AppState>())
        .expect("the checkpoint succeeds")
        .expect("an edit gives the checkpoint something to record");

    let history = rows_on_disk(&path);
    assert_eq!(history.len(), 2, "the first save plus the one checkpoint");
    assert_eq!(
        history.last().expect("the history has a newest row").timestamp(),
        recorded,
        "the returned timestamp must name the row that was added"
    );
}

#[test]
fn s_080_a_manual_checkpoint_with_nothing_to_record_writes_nothing() {
    let dir = tempfile::tempdir().expect("scratch dir");
    let path = scratch_path(&dir, "novel.rite");
    let app = mock_app_with(doc_with_text("One"));
    save(&app, &path);
    fs::write(&path, "untouched").expect("the scratch file is writable");

    let recorded =
        save_snapshot(app.state::<AppState>()).expect("a checkpoint on a saved document succeeds");

    assert_eq!(
        recorded, None,
        "an unchanged document has no version for the checkpoint to add"
    );
    let after = fs::read_to_string(&path).expect("the file is still there");
    assert!(
        after == "untouched",
        "a checkpoint that records nothing must not rewrite the .rite"
    );
}

#[test]
fn s_081_a_save_to_a_new_path_writes_the_document_without_a_row() {
    let dir = tempfile::tempdir().expect("scratch dir");
    let first = scratch_path(&dir, "first.rite");
    let second = scratch_path(&dir, "second.rite");
    let app = mock_app_with(doc_with_text("One"));
    save(&app, &first);
    fs::write(&second, "untouched").expect("the scratch file is writable");

    save(&app, &second);

    let written = fs::read_to_string(&second).expect("the new path holds a file");
    assert_ne!(
        written, "untouched",
        "a save to a path the app has not written must put the document there"
    );
    let file = history::read_rite_file(&written).expect("the new file parses as a .rite");
    assert_eq!(
        file.document,
        doc_with_text("One"),
        "the new file holds the whole document, not just a history record"
    );
    assert_eq!(
        file.history.len(),
        1,
        "unchanged content gives the new file no extra history row"
    );
}

#[test]
fn s_082_a_save_after_an_autosave_journalled_a_change_records_no_row() {
    let dir = tempfile::tempdir().expect("scratch dir");
    let path = scratch_path(&dir, "novel.rite");
    let app = mock_app_with(doc_with_text("One"));
    save(&app, &path);

    set_document(&app, doc_with_text("Two"));
    let state = app.state::<AppState>();
    let mut modified = state.is_modified.lock().unwrap();
    modified.clone_from(&true);
    drop(modified);
    autosave_document(app.handle().clone(), app.state::<AppState>())
        .expect("autosave journals the edit");
    assert_eq!(
        rows_on_disk(&path).len(),
        2,
        "the autosave journals one row for the edit"
    );

    save(&app, &path);
    assert_eq!(
        rows_on_disk(&path).len(),
        2,
        "the save sees the state autosave already journalled"
    );
}

#[test]
fn s_083_a_save_after_a_recorded_checkpoint_records_no_row() {
    let dir = tempfile::tempdir().expect("scratch dir");
    let path = scratch_path(&dir, "novel.rite");
    let app = mock_app_with(doc_with_text("One"));
    save(&app, &path);

    set_document(&app, doc_with_text("Two"));
    let recorded = save_snapshot(app.state::<AppState>()).expect("the checkpoint succeeds");
    assert!(
        recorded.is_some(),
        "an edit gives the checkpoint something to record"
    );
    assert_eq!(
        rows_on_disk(&path).len(),
        2,
        "the first save plus the checkpoint"
    );

    save(&app, &path);
    assert_eq!(
        rows_on_disk(&path).len(),
        2,
        "the save sees the state the checkpoint already recorded"
    );
}
