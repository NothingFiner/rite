//! EPUB export (SPEC.md S-001…S-018).
//!
//! Integration tests for `rite_lib::export_epub`. The pure renderer
//! (`document_to_epub`) is called directly; the two `#[tauri::command]` cases
//! go through a mock app because `State<AppState>` cannot be built by hand
//! (see `tests/smoke.rs` for the pattern).
//!
//! The tests read the produced package back with the same `zip` crate the
//! exporter writes it with, and assert on the *structural* invariants an EPUB
//! reader relies on — `epubcheck` is not available in CI, so "valid package"
//! is spelled out as: mimetype first and stored, a container pointing at the
//! OPF, an OPF whose manifest and spine agree with the archive, and nav
//! entries for exactly the visible sections.

use rite_lib::document::{Document, Element, Paragraph, Section, SectionType, TextRun, TextStyle};
use rite_lib::export_epub::{document_to_epub, export_epub};
use rite_lib::state::AppState;
use std::io::{Cursor, Read};
use tauri::Manager;
use zip::ZipArchive;

// --- helpers ---------------------------------------------------------------

fn para(id: &str, text: &str) -> Paragraph {
    Paragraph {
        id: id.to_string(),
        elements: vec![Element {
            text_run: TextRun {
                content: text.to_string(),
                text_style: TextStyle::default(),
            },
        }],
        left_indent: None,
        right_indent: None,
        first_line_indent: None,
    }
}

fn styled_para(id: &str, runs: Vec<(&str, TextStyle)>) -> Paragraph {
    Paragraph {
        id: id.to_string(),
        elements: runs
            .into_iter()
            .map(|(content, text_style)| Element {
                text_run: TextRun {
                    content: content.to_string(),
                    text_style,
                },
            })
            .collect(),
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

/// Two visible chapters with a hidden chapter and a hidden section interleaved
/// between them, so the same document exercises ordering, skipping and
/// contiguous chapter numbering.
///
/// ```text
/// 1. Chapter "The Arrival"      visible   -> "Chapter 1: The Arrival"
/// 2. Chapter "Cut Chapter"      hidden    -> skipped entirely
/// 3. Chapter ""                 visible   -> "Chapter 2"   (no colon)
/// 4. Section "Notes"            hidden    -> skipped entirely
/// ```
fn sample_document() -> Document {
    let mut hidden_chapter = section(
        "s2",
        "Cut Chapter",
        SectionType::Chapter,
        vec![para("p3", "HIDDEN-CH-BODY must not reach a reader.")],
    );
    hidden_chapter.hidden = true;

    let mut hidden_section = section(
        "s4",
        "Notes",
        SectionType::Section,
        vec![para("p6", "HIDDEN-SEC-BODY must not reach a reader.")],
    );
    hidden_section.hidden = true;

    Document {
        title: "A Novel".to_string(),
        author: "Ada Lovelace".to_string(),
        author_contact: "SECRET-CONTACT-INFO\n1 Writer's Lane".to_string(),
        has_toc: false,
        sections: vec![
            section(
                "s1",
                "The Arrival",
                SectionType::Chapter,
                vec![
                    styled_para(
                        "p1",
                        vec![
                            ("It was a dark", TextStyle::default()),
                            (" and stormy night.", TextStyle { bold: true, ..Default::default() }),
                        ],
                    ),
                    styled_para(
                        "p2",
                        vec![
                            ("plain ", TextStyle::default()),
                            (
                                "italic underline",
                                TextStyle { italic: true, underline: true, ..Default::default() },
                            ),
                        ],
                    ),
                ],
            ),
            hidden_chapter,
            section(
                "s3",
                "",
                SectionType::Chapter,
                vec![para("p5", "BODY-TWO after the hidden chapter.")],
            ),
            hidden_section,
        ],
    }
}

fn entry_names(bytes: &[u8]) -> Vec<String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("the export is a readable zip");
    (0..archive.len())
        .map(|i| {
            archive
                .by_index(i)
                .expect("index in range")
                .name()
                .to_string()
        })
        .collect()
}

fn entry_text(bytes: &[u8], name: &str) -> String {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("the export is a readable zip");
    let mut file = archive
        .by_name(name)
        .unwrap_or_else(|_| panic!("package is missing the entry {name}"));
    let mut out = String::new();
    file.read_to_string(&mut out)
        .unwrap_or_else(|e| panic!("entry {name} is not utf-8: {e}"));
    out
}

/// Every entry, concatenated — for "must not appear anywhere" assertions.
fn all_text(bytes: &[u8]) -> String {
    entry_names(bytes)
        .iter()
        .filter(|n| n.ends_with(".xhtml") || n.ends_with(".opf") || n.ends_with(".xml"))
        .map(|n| entry_text(bytes, n))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Values of `attr` on every exact `<tag …>` occurrence, in document order.
///
/// Hand-rolled because the crate has no XML parser (and this suite should not
/// add one just to read its own output). Tolerant of attribute order, quoting
/// style and whitespace; intolerant of missing attributes.
fn attrs(xml: &str, tag: &str, attr: &str) -> Vec<String> {
    let mut out = Vec::new();
    let needle = format!("<{tag}");
    let mut i = 0usize;
    while let Some(rel) = xml[i..].find(&needle) {
        let start = i + rel;
        let after = start + needle.len();
        let boundary_ok = match xml[after..].chars().next() {
            Some(c) => c.is_whitespace() || c == '>' || c == '/',
            None => false,
        };
        if boundary_ok {
            if let Some(end_rel) = xml[after..].find('>') {
                let tag_text = &xml[after..after + end_rel];
                if let Some(v) = attr_value(tag_text, attr) {
                    out.push(v);
                }
                i = after + end_rel;
                continue;
            }
        }
        i = after;
    }
    out
}

fn attr_value(tag_text: &str, attr: &str) -> Option<String> {
    let mut search = 0usize;
    while let Some(rel) = tag_text[search..].find(attr) {
        let start = search + rel;
        let boundary_ok = start == 0 || {
            let prev = tag_text.as_bytes()[start - 1];
            !prev.is_ascii_alphanumeric() && prev != b'_' && prev != b'-'
        };
        let after = start + attr.len();
        if boundary_ok {
            let rest = tag_text[after..].trim_start();
            if let Some(rest) = rest.strip_prefix('=') {
                let rest = rest.trim_start();
                if let Some(quote) = rest.chars().next() {
                    if quote == '"' || quote == '\'' {
                        if let Some(end_quote) = rest[1..].find(quote) {
                            return Some(rest[1..1 + end_quote].to_string());
                        }
                    }
                }
            }
        }
        search = after;
    }
    None
}

/// The XHTML entry whose body carries `marker`, plus its archive name.
fn entry_containing(bytes: &[u8], marker: &str) -> Option<(String, String)> {
    for name in entry_names(bytes) {
        if !name.ends_with(".xhtml") {
            continue;
        }
        let text = entry_text(bytes, &name);
        if text.contains(marker) {
            return Some((name, text));
        }
    }
    None
}

fn opf(bytes: &[u8]) -> String {
    entry_text(bytes, "OEBPS/content.opf")
}

// --- S-001…S-004: package structure ----------------------------------------

#[test]
fn s_001_first_entry_is_a_stored_mimetype() {
    let bytes = document_to_epub(&sample_document());

    let (name, compression) = {
        let mut archive = ZipArchive::new(Cursor::new(&bytes[..])).expect("readable zip");
        let first = archive.by_index(0).expect("the package has at least one entry");
        (first.name().to_string(), first.compression())
    };

    assert_eq!(name, "mimetype", "mimetype must be the FIRST entry in the archive");
    assert_eq!(
        compression,
        zip::CompressionMethod::Stored,
        "mimetype must be stored, never deflated — readers sniff it before parsing the zip"
    );
    assert_eq!(entry_text(&bytes, "mimetype"), "application/epub+zip");
}

#[test]
fn s_002_container_points_at_the_opf() {
    let bytes = document_to_epub(&sample_document());
    let container = entry_text(&bytes, "META-INF/container.xml");

    let paths = attrs(&container, "rootfile", "full-path");
    assert!(
        paths.iter().any(|p| p == "OEBPS/content.opf"),
        "container.xml must name OEBPS/content.opf as the rootfile, got {paths:?}"
    );
    assert!(
        container.contains("application/oebps-package+xml"),
        "the rootfile must carry the OPF media type, got:\n{container}"
    );
}

#[test]
fn s_003_opf_declares_epub_3_and_manifests_every_xhtml() {
    let bytes = document_to_epub(&sample_document());
    let opf = opf(&bytes);

    assert!(
        opf.contains("version=\"3.0\"") || opf.contains("version='3.0'"),
        "the package must declare EPUB 3.0, got:\n{opf}"
    );

    let hrefs = attrs(&opf, "item", "href");
    for name in entry_names(&bytes) {
        if !name.ends_with(".xhtml") {
            continue;
        }
        let file = name.rsplit('/').next().expect("entry has a basename");
        assert!(
            hrefs.iter().any(|h| h == file),
            "manifest is missing an item for {name}; manifest hrefs: {hrefs:?}"
        );
    }
}

#[test]
fn s_004_manifest_and_spine_agree_with_the_archive() {
    let bytes = document_to_epub(&sample_document());
    let opf = opf(&bytes);
    let archive_names = entry_names(&bytes);

    let ids = attrs(&opf, "item", "id");
    let hrefs = attrs(&opf, "item", "href");
    assert_eq!(ids.len(), hrefs.len(), "every manifest item needs both id and href");

    for href in &hrefs {
        let path = format!("OEBPS/{}", href.trim_start_matches("./"));
        assert!(
            archive_names.iter().any(|n| n == &path),
            "manifest declares {href} but the archive has no {path}; entries: {archive_names:?}"
        );
    }

    let spine = attrs(&opf, "itemref", "idref");
    assert!(!spine.is_empty(), "the sample document has visible sections, so the spine is not empty");
    for idref in &spine {
        assert!(
            ids.iter().any(|id| id == idref),
            "spine references {idref}, which the manifest never declares; ids: {ids:?}"
        );
    }
}

// --- S-005…S-016: content --------------------------------------------------

#[test]
fn s_005_one_xhtml_per_visible_section_in_document_order() {
    let bytes = document_to_epub(&sample_document());
    let opf = opf(&bytes);

    // The sample has two VISIBLE sections; the hidden chapter and hidden
    // section must not contribute a document. (The package may also carry
    // nav.xhtml and a title page, so the check is on body-bearing documents,
    // not on a raw .xhtml count.)
    let (first_file, _) = entry_containing(&bytes, "BODY-ONE").expect("the first chapter has a document");
    let (second_file, _) = entry_containing(&bytes, "BODY-TWO").expect("the second chapter has a document");

    let ids = attrs(&opf, "item", "id");
    let hrefs = attrs(&opf, "item", "href");
    let href_of = |file: &str| -> String {
        let basename = file.rsplit('/').next().expect("basename").to_string();
        let idx = hrefs
            .iter()
            .position(|h| *h == basename)
            .unwrap_or_else(|| panic!("no manifest item for {file}; hrefs: {hrefs:?}"));
        ids[idx].clone()
    };

    let spine = attrs(&opf, "itemref", "idref");
    let first = spine
        .iter()
        .position(|id| *id == href_of(&first_file))
        .expect("first chapter is in the spine");
    let second = spine
        .iter()
        .position(|id| *id == href_of(&second_file))
        .expect("second chapter is in the spine");
    assert!(first < second, "spine order must follow document order, got {spine:?}");
}

#[test]
fn s_006_each_paragraph_renders_as_a_p_with_its_text() {
    let bytes = document_to_epub(&sample_document());
    let (_, body) = entry_containing(&bytes, "BODY-ONE").expect("the first chapter has a document");

    assert!(
        body.contains("<p>") || body.contains("<p "),
        "paragraphs must render as <p> elements, got:\n{body}"
    );
    // Two runs of the first paragraph, in order, text preserved verbatim.
    let dark = body.find("It was a dark").expect("first run text is present");
    let stormy = body.find(" and stormy night.").expect("second run text is present");
    assert!(dark < stormy, "run text must keep document order");
    assert!(
        body.contains("plain ") && body.contains("italic underline"),
        "every paragraph of the section must render, got:\n{body}"
    );
}

#[test]
fn s_007_chapter_heading_carries_the_derived_number() {
    let bytes = document_to_epub(&sample_document());
    let (_, body) = entry_containing(&bytes, "BODY-ONE").expect("the first chapter has a document");

    assert!(
        body.contains("Chapter 1: The Arrival"),
        "a chapter heading must read 'Chapter 1: The Arrival', got:\n{body}"
    );
}

#[test]
fn s_008_subtitleless_chapter_has_no_trailing_colon() {
    let bytes = document_to_epub(&sample_document());
    let (_, body) = entry_containing(&bytes, "BODY-TWO").expect("the second chapter has a document");

    assert!(
        body.contains("Chapter 2"),
        "the subtitle-less chapter must render as 'Chapter 2', got:\n{body}"
    );
    assert!(
        !body.contains("Chapter 2:"),
        "an empty subtitle must not leave a trailing colon, got:\n{body}"
    );
}

#[test]
fn s_009_inline_formatting_maps_to_strong_em_and_u() {
    let bytes = document_to_epub(&sample_document());
    let (_, body) = entry_containing(&bytes, "BODY-ONE").expect("the first chapter has a document");

    assert!(body.contains("<strong>"), "bold runs must become <strong>, got:\n{body}");
    assert!(body.contains("<em>"), "italic runs must become <em>, got:\n{body}");
    assert!(body.contains("<u>"), "underlined runs must become <u>, got:\n{body}");
}

#[test]
fn s_010_markup_characters_are_escaped() {
    let mut doc = sample_document();
    doc.sections[0].paragraphs = vec![para("p1", "Fish & chips <tag> \"quoted\"")];

    let bytes = document_to_epub(&doc);
    let (_, body) = entry_containing(&bytes, "Fish").expect("the chapter has a document");

    assert!(body.contains("Fish &amp; chips"), "& must be escaped, got:\n{body}");
    assert!(body.contains("&lt;tag&gt;"), "< and > must be escaped, got:\n{body}");
    assert!(body.contains("&quot;quoted&quot;"), "\" must be escaped, got:\n{body}");
    assert!(!body.contains("<tag>"), "raw markup must never survive into the XHTML, got:\n{body}");
}

#[test]
fn s_011_hidden_sections_are_skipped_entirely() {
    let bytes = document_to_epub(&sample_document());
    let everything = all_text(&bytes);

    assert!(
        !everything.contains("HIDDEN-CH-BODY"),
        "a hidden section's body must not reach the package"
    );
    assert!(
        !everything.contains("HIDDEN-SEC-BODY"),
        "a hidden section's body must not reach the package"
    );
    assert!(!everything.contains("Cut Chapter"), "a hidden chapter must not be manifested");
    assert!(!everything.contains("Notes"), "a hidden section must not be manifested");

    // Nothing may reference them either: every manifest href must exist.
    for href in attrs(&opf(&bytes), "item", "href") {
        assert!(
            entry_names(&bytes).iter().any(|n| n == &format!("OEBPS/{}", href)),
            "manifest lists {href} for a hidden section"
        );
    }
}

#[test]
fn s_012_hidden_chapter_does_not_consume_a_number() {
    let bytes = document_to_epub(&sample_document());
    let everything = all_text(&bytes);

    assert!(
        everything.contains("Chapter 2"),
        "the chapter after the hidden one must be Chapter 2, got:\n{everything}"
    );
    assert!(
        !everything.contains("Chapter 3"),
        "a hidden chapter must not consume a number, so nothing may be Chapter 3"
    );
}

#[test]
fn s_013_nav_lists_every_visible_section_in_order() {
    let bytes = document_to_epub(&sample_document());
    let opf = opf(&bytes);
    let nav = entry_text(&bytes, "OEBPS/nav.xhtml");

    let nav_properties = attrs(&opf, "item", "properties");
    assert!(
        nav_properties.iter().any(|p| p.split_whitespace().any(|t| t == "nav")),
        "the navigation document must be marked properties=\"nav\", got {nav_properties:?}"
    );

    assert!(nav.contains("The Arrival"), "nav must list the visible chapter, got:\n{nav}");

    // One link per visible section, in document order: the first link must
    // point at the document that carries the first chapter's body.
    let nav_hrefs = attrs(&nav, "a", "href");
    assert_eq!(
        nav_hrefs.len(),
        2,
        "nav must have exactly one entry per visible section, got {nav_hrefs:?}"
    );
    let (first_file, _) = entry_containing(&bytes, "BODY-ONE").expect("the first chapter has a document");
    let first_target = nav_hrefs[0].trim_start_matches("./").rsplit('/').next().unwrap_or("");
    let first_source = first_file.rsplit('/').next().unwrap_or("");
    assert_eq!(
        first_target, first_source,
        "the first nav entry must point at the first chapter, got {nav_hrefs:?}"
    );

    assert!(!nav.contains("Cut Chapter"), "nav must not list a hidden chapter");
    assert!(!nav.contains("Notes"), "nav must not list a hidden section");
}

#[test]
fn s_014_title_page_carries_title_and_author_but_never_the_contact_block() {
    let bytes = document_to_epub(&sample_document());
    let everything = all_text(&bytes);

    assert!(everything.contains("A Novel"), "the title page must carry the document title");
    assert!(everything.contains("Ada Lovelace"), "the title page must carry the author");

    for name in entry_names(&bytes) {
        let text = entry_text(&bytes, &name);
        assert!(
            !text.contains("SECRET-CONTACT-INFO"),
            "authorContact is submission data and must never be exported; found it in {name}"
        );
    }
}

#[test]
fn s_015_package_metadata_falls_back_when_title_and_author_are_blank() {
    let mut doc = sample_document();
    doc.title = "  ".to_string();
    doc.author = String::new();

    let bytes = document_to_epub(&doc);
    let opf = opf(&bytes);

    assert!(opf.contains("Untitled"), "a blank title must fall back to 'Untitled', got:\n{opf}");
    assert!(
        opf.contains("Author Name"),
        "a blank author must fall back to 'Author Name', got:\n{opf}"
    );
}

#[test]
fn s_016_a_document_with_no_visible_sections_is_still_a_valid_package() {
    let mut doc = sample_document();
    for section in &mut doc.sections {
        section.hidden = true;
    }

    let bytes = document_to_epub(&doc);

    assert_eq!(entry_text(&bytes, "mimetype"), "application/epub+zip");
    assert!(!entry_text(&bytes, "META-INF/container.xml").is_empty());

    let opf = opf(&bytes);
    assert!(
        attrs(&opf, "itemref", "idref").is_empty(),
        "nothing visible means an empty spine, got {:?}",
        attrs(&opf, "itemref", "idref")
    );
    // Every manifest item must still resolve — an empty spine is not an excuse
    // for a dangling manifest entry.
    for href in attrs(&opf, "item", "href") {
        assert!(
            entry_names(&bytes).iter().any(|n| n == &format!("OEBPS/{}", href)),
            "manifest lists {href}, which the archive does not contain"
        );
    }
}

// --- S-017, S-018: the command ---------------------------------------------

fn mock_app_with(doc: Document) -> tauri::App<tauri::test::MockRuntime> {
    let app = tauri::test::mock_builder()
        .manage(AppState::new())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app builds without a window or event loop");
    *app.state::<AppState>().document.lock().unwrap() = doc;
    app
}

#[test]
fn s_017_export_writes_the_whole_package_and_leaves_no_scratch_files() {
    let doc = sample_document();
    let expected = document_to_epub(&doc);

    let dir = tempfile::tempdir().expect("scratch dir");
    let path = dir.path().join("novel.epub");

    let app = mock_app_with(doc);
    export_epub(path.to_string_lossy().into_owned(), app.state::<AppState>())
        .expect("export_epub writes the package");

    let written = std::fs::read(&path).expect("the .epub exists");
    assert_eq!(written, expected, "the file must be exactly the rendered package");

    let leftovers: Vec<String> = std::fs::read_dir(dir.path())
        .expect("readable scratch dir")
        .map(|e| e.expect("dir entry").file_name().to_string_lossy().into_owned())
        .filter(|n| n != "novel.epub")
        .collect();
    assert!(
        leftovers.is_empty(),
        "an atomic write must leave no temp/partial file behind, found {leftovers:?}"
    );
}

#[test]
fn s_017b_a_failed_export_leaves_no_partial_file() {
    let dir = tempfile::tempdir().expect("scratch dir");
    // A missing parent is what S-018 asserts an Err for; here the point is that
    // the failure leaves nothing half-written at the target path.
    let path = dir.path().join("missing-dir").join("novel.epub");

    let app = mock_app_with(sample_document());
    let result = export_epub(path.to_string_lossy().into_owned(), app.state::<AppState>());

    assert!(result.is_err(), "exporting into a missing directory must fail");
    assert!(!path.exists(), "a failed export must not leave a file at the target path");
}

#[test]
fn s_018_export_returns_err_when_the_target_directory_is_missing() {
    let dir = tempfile::tempdir().expect("scratch dir");
    let path = dir.path().join("no-such-directory").join("novel.epub");

    let app = mock_app_with(sample_document());
    let result = export_epub(path.to_string_lossy().into_owned(), app.state::<AppState>());

    let err = result.expect_err("a missing target directory must surface as Err");
    assert!(
        !err.is_empty(),
        "the error must carry the underlying io message, got an empty string"
    );
}
