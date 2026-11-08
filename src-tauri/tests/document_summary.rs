//! The document-level recap (SPEC.md 5.20b, S-030 … S-033).
//!
//! The overview page's summary is the manuscript's, not a section's: the model
//! reads every section in order under its title, and the staleness baseline is
//! the whole document. These sentences drive the pure half — the ordering and
//! naming rules, the hash, and the entry the frontend renders — plus the
//! sidecar field that carries it. No network and no Tauri state.

use rite_lib::document::{Document, Element, Paragraph, Section, SectionType, TextRun};
use rite_lib::sidecar::Sidecar;
use rite_lib::summary::{build_document_summary_entry, document_text, document_text_hash, SectionSummary};

fn paragraph(text: &str) -> Paragraph {
    Paragraph {
        id: format!("p-{}", text.len()),
        elements: vec![Element {
            text_run: TextRun {
                content: text.to_string(),
                text_style: Default::default(),
            },
        }],
        left_indent: None,
        right_indent: None,
        first_line_indent: None,
    }
}

fn section(id: &str, title: &str, section_type: SectionType, paragraphs: Vec<Paragraph>) -> Section {
    Section {
        id: id.to_string(),
        title: title.to_string(),
        section_type,
        hidden: false,
        paragraphs,
    }
}

/// Three sections in one chapter, in manuscript order, with a title-less
/// chapter in the middle — the shape that catches an order or a naming bug.
fn manuscript() -> Document {
    Document {
        title: "A Novel".into(),
        author: "Author".into(),
        author_contact: String::new(),
        has_toc: false,
        sections: vec![
            section(
                "c1",
                "The Arrival",
                SectionType::Chapter,
                vec![paragraph("The door opened on an empty street.")],
            ),
            section("s1", "Interlude", SectionType::Section, vec![paragraph("A pause.")]),
            section("c2", "", SectionType::Chapter, vec![paragraph("The letter is opened.")]),
        ],
    }
}

#[test]
fn s_030_a_sidecar_without_a_document_summary_loads_with_none() {
    // Every sidecar written before 5.20b — schema v2 included — has no
    // `documentSummary` key. It must load, not fail, and read as "not
    // generated yet".
    let json = r#"{
        "schemaVersion": 2,
        "sectionHashes": {},
        "vectors": [],
        "summaries": {}
    }"#;

    let sidecar: Sidecar = serde_json::from_str(json).expect("a pre-5.20b sidecar loads");

    assert_eq!(sidecar.document_summary, None);
}

#[test]
fn s_030_a_document_summary_round_trips_through_the_sidecar() {
    let stored = SectionSummary {
        section_id: String::new(),
        section_hash: 42,
        summary: "A whole-manuscript recap.".to_string(),
    };

    let sidecar = Sidecar::new(Default::default(), Vec::new(), Default::default())
        .with_document_summary(Some(stored.clone()));

    let json = serde_json::to_string(&sidecar).expect("the sidecar serializes");
    let back: Sidecar = serde_json::from_str(&json).expect("and reads back");

    assert_eq!(back.document_summary, Some(stored));
}

#[test]
fn s_031_document_text_lists_every_section_in_manuscript_order() {
    let text = document_text(&manuscript());

    let arrival = text.find("The Arrival").expect("the first chapter's title is in the input");
    let interlude = text.find("Interlude").expect("the section title is in the input");
    let second_chapter = text.find("The letter is opened.").expect("the last section's text is in the input");

    assert!(arrival < interlude, "sections keep manuscript order");
    assert!(interlude < second_chapter, "sections keep manuscript order");

    // The text the model reads is the source prose, under each heading.
    assert!(text.contains("The door opened on an empty street."));
    assert!(text.contains("A pause."));
}

#[test]
fn s_031_document_text_names_an_untitled_chapter_by_its_number() {
    // A Chapter's stored title is only its subtitle and may be empty (5.9), so
    // a bare join would give the model a blank heading for chapter two.
    let text = document_text(&manuscript());

    assert!(
        text.contains("Chapter 2"),
        "the second chapter is named by its derived number: {text}"
    );
}

#[test]
fn s_032_hash_is_stable_for_the_same_document() {
    assert_eq!(
        document_text_hash(&manuscript()),
        document_text_hash(&manuscript())
    );
}

#[test]
fn s_032_hash_changes_when_any_section_text_changes() {
    let before = document_text_hash(&manuscript());

    let mut edited = manuscript();
    edited.sections[1].paragraphs = vec![paragraph("A longer pause, rewritten.")];

    assert_ne!(before, document_text_hash(&edited));
}

#[test]
fn s_033_no_stored_summary_reads_as_none_not_an_error() {
    // A view's empty state, unlike the Summaries Feedback Target, which turns
    // an empty store into an error on purpose.
    assert_eq!(build_document_summary_entry(None, &manuscript()), None);
}

#[test]
fn s_033_a_current_document_summary_is_returned_unstale() {
    let doc = manuscript();
    let stored = SectionSummary {
        section_id: String::new(),
        section_hash: document_text_hash(&doc),
        summary: "Four characters, one letter, no sender.".to_string(),
    };

    let entry = build_document_summary_entry(Some(&stored), &doc).expect("a stored summary is returned");

    assert_eq!(entry.summary, "Four characters, one letter, no sender.");
    assert!(!entry.stale, "the manuscript it was generated from is unchanged");
}

#[test]
fn s_033_a_document_summary_of_an_edited_manuscript_is_stale() {
    let stored = SectionSummary {
        section_id: String::new(),
        section_hash: document_text_hash(&manuscript()),
        summary: "Four characters, one letter, no sender.".to_string(),
    };

    let mut edited = manuscript();
    edited.sections[2].paragraphs = vec![paragraph("The letter is burned unopened.")];

    let entry = build_document_summary_entry(Some(&stored), &edited).expect("a stored summary is returned");

    assert!(entry.stale, "any section edit invalidates the whole-manuscript recap");
}

// --- The command surface (S-040, S-041) ------------------------------------
//
// S-030 … S-033 pin the pure half, and they pass against a read that only calls
// `build_document_summary_entry` and a generation command that does nothing. The
// app's own path is the command pair, so these two sentences drive it: a
// generation stores what the model returned, and a failed generation leaves the
// stored recap alone.
//
// No network, no model: `stub_model` is a throwaway OpenAI-compatible endpoint
// on port 0 that answers one POST with a canned completion (or a 500) and hands
// back the request body it saw. Nothing here names a storage field, so the
// implementation is free to put the recap wherever it likes.

use rite_lib::state::AppState;
use rite_lib::summary::{retrieve_document_summary, summarize_and_store_document};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::JoinHandle;
use tauri::Manager;

/// The recap the canned completion returns. Distinctive enough that finding it
/// in a response proves it came from the model, not from a fixture in the test.
const STUB_RECAP: &str = "STUB-RECAP: one arrival, one letter, no sender.";

fn mock_app_with(doc: Document) -> tauri::App<tauri::test::MockRuntime> {
    let app = tauri::test::mock_builder()
        .manage(AppState::new())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app builds without a window or event loop");
    *app.state::<AppState>().document.lock().unwrap() = doc;
    app
}

/// A one-request OpenAI-compatible endpoint. Returns its base URL (the model
/// client appends `/v1/chat/completions`) and a handle yielding the raw request
/// the server received, so a sentence can assert on what the model was sent.
fn stub_model(status: u16, reply: &'static str) -> (String, JoinHandle<Vec<u8>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port is free");
    let port = listener.local_addr().expect("the bound address is readable").port();
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("the model client connects once");
        let raw = read_request(&mut stream);
        let reason = if status == 200 { "OK" } else { "Internal Server Error" };
        let response = format!(
            "HTTP/1.1 {status} {reason}\r\n\
             Content-Type: application/json\r\n\
             Content-Length: {}\r\n\
             Connection: close\r\n\r\n\
             {reply}",
            reply.len()
        );
        stream
            .write_all(response.as_bytes())
            .expect("the stub answers the request");
        stream.flush().expect("the stub flushes its answer");
        raw
    });
    (format!("http://127.0.0.1:{port}"), handle)
}

/// Read one HTTP request off the wire: headers, then exactly `Content-Length`
/// bytes of body.
fn read_request(stream: &mut std::net::TcpStream) -> Vec<u8> {
    let mut raw = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let read = stream.read(&mut chunk).expect("the request is readable");
        if read == 0 {
            return raw;
        }
        raw.extend_from_slice(&chunk[..read]);
        if let Some(head_end) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&raw[..head_end]).to_lowercase();
            let length: usize = head
                .lines()
                .find_map(|line| line.strip_prefix("content-length:"))
                .and_then(|value| value.trim().parse().ok())
                .unwrap_or(0);
            if raw.len() >= head_end + 4 + length {
                return raw;
            }
        }
    }
}

fn canned_completion(recap: &str) -> &'static str {
    // The wire shape `llm_chat` parses: choices[0].message.content. Built to a
    // leak so the stub can hand back a `&'static str`.
    Box::leak(
        format!(r#"{{"choices":[{{"message":{{"content":"{recap}"}}}}]}}"#).into_boxed_str(),
    )
}

#[test]
fn s_040_generating_the_document_summary_stores_what_the_model_returned() {
    let (endpoint, request) = stub_model(200, canned_completion(STUB_RECAP));
    let app = mock_app_with(manuscript());

    let stored = tauri::async_runtime::block_on(summarize_and_store_document(
        endpoint,
        None,
        "stub-model".to_string(),
        app.state::<AppState>(),
        app.handle().clone(),
    ))
    .expect("the stub model answers, so generating the document summary succeeds");

    assert_eq!(
        stored.summary, STUB_RECAP,
        "the stored recap is the text the model returned"
    );

    // The model reads the whole manuscript — every section, in order, under the
    // title the writer sees — not the overview note and not one section of it.
    let body = String::from_utf8_lossy(&request.join().expect("the stub thread finishes")).to_string();
    for expected in [
        "Chapter 1: The Arrival",
        "Interlude",
        "Chapter 2",
        "The door opened on an empty street.",
        "A pause.",
        "The letter is opened.",
    ] {
        assert!(
            body.contains(expected),
            "the request to the model must carry {expected:?}, got: {body}"
        );
    }

    // The app's own read returns it, fresh: the manuscript has not changed since.
    let entry = retrieve_document_summary(app.state::<AppState>())
        .expect("reading the document summary is not an error once one exists")
        .expect("a generated document summary reads back");
    assert_eq!(entry.summary, STUB_RECAP);
    assert!(!entry.stale, "nothing has been edited since the generation");

    // And any section edit makes that same read report it stale.
    {
        let state = app.state::<AppState>();
        let mut doc = state.document.lock().unwrap();
        doc.sections[1].paragraphs = vec![paragraph("A longer pause.")];
    }
    let after_edit = retrieve_document_summary(app.state::<AppState>())
        .expect("reading the document summary stays a non-error")
        .expect("the generated document summary is still stored");
    assert_eq!(after_edit.summary, STUB_RECAP);
    assert!(
        after_edit.stale,
        "editing any section invalidates the whole-manuscript recap"
    );
}

#[test]
fn s_041_a_failed_model_call_leaves_the_stored_recap_untouched() {
    let (endpoint, good) = stub_model(200, canned_completion(STUB_RECAP));
    let app = mock_app_with(manuscript());

    tauri::async_runtime::block_on(summarize_and_store_document(
        endpoint,
        None,
        "stub-model".to_string(),
        app.state::<AppState>(),
        app.handle().clone(),
    ))
    .expect("the first generation succeeds against the answering stub");
    good.join().expect("the stub thread finishes");

    // Now the model fails: a real HTTP error, not a stub that refuses to run.
    let (broken, bad) = stub_model(500, "the model is down");
    let error = tauri::async_runtime::block_on(summarize_and_store_document(
        broken,
        None,
        "stub-model".to_string(),
        app.state::<AppState>(),
        app.handle().clone(),
    ))
    .expect_err("a 500 from the model is a failure the writer is told about");
    bad.join().expect("the stub thread finishes");

    assert!(
        error.contains("500"),
        "the error names what went wrong at the endpoint, got: {error}"
    );

    // The recap the writer already had survives the failed attempt.
    let entry = retrieve_document_summary(app.state::<AppState>())
        .expect("reading the document summary is still not an error")
        .expect("the earlier document summary is still stored");
    assert_eq!(
        entry.summary, STUB_RECAP,
        "a failed regeneration must not discard the recap that was already stored"
    );
    assert!(!entry.stale, "the manuscript has not changed, only the model call failed");
}
