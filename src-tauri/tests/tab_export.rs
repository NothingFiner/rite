//! Tab characters and first-line indent in the exports (SPEC.md 5.18,
//! S-017…S-019).
//!
//! The exporters are pure, so each test renders a document and reads the package
//! back with the same `zip` crate that wrote it, as `tests/epub_export.rs` does.

use rite_lib::document::{Document, Element, Paragraph, Section, SectionType, TextRun, TextStyle};
use rite_lib::export_docx::document_to_docx;
use rite_lib::export_epub::document_to_epub;
use std::io::{Cursor, Read};
use zip::ZipArchive;

fn paragraph(id: &str, text: &str, first_line_indent: Option<f32>) -> Paragraph {
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
        first_line_indent,
    }
}

/// One visible section, one paragraph holding a tab between two words and an
/// explicit half-inch first-line indent.
fn sample_document() -> Document {
    Document {
        title: "A Novel".to_string(),
        author: "Ada Lovelace".to_string(),
        author_contact: String::new(),
        has_toc: false,
        sections: vec![Section {
            id: "s1".to_string(),
            title: "The Arrival".to_string(),
            section_type: SectionType::Chapter,
            hidden: false,
            paragraphs: vec![paragraph("p1", "A\tB", Some(0.5))],
        }],
    }
}

/// Every entry in a zip package, decompressed to text.
fn entries(bytes: Vec<u8>) -> Vec<(String, String)> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("a valid zip package");
    let mut out = Vec::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).expect("entry");
        let name = file.name().to_string();
        let mut content = String::new();
        file.read_to_string(&mut content).expect("utf-8 entry");
        out.push((name, content));
    }
    out
}

fn entry<'a>(entries: &'a [(String, String)], name: &str) -> &'a str {
    entries
        .iter()
        .find(|(entry_name, _)| entry_name == name)
        .map(|(_, content)| content.as_str())
        .unwrap_or_else(|| panic!("missing package entry {name}"))
}

#[test]
fn s_017_docx_export_writes_a_tab_element_and_no_literal_tab() {
    let package = entries(document_to_docx(&sample_document()));
    let document_xml = entry(&package, "word/document.xml");

    let tab_at = document_xml
        .find("<w:tab/>")
        .unwrap_or_else(|| panic!("no <w:tab/> in word/document.xml"));
    assert!(
        document_xml[..tab_at].contains(">A<"),
        "the text before the tab must come first"
    );
    assert!(
        document_xml[tab_at..].contains(">B<"),
        "the text after the tab must follow it"
    );
    assert!(
        !document_xml.contains('\t'),
        "a literal tab inside <w:t> is not a tab to Word"
    );
}

#[test]
fn s_018_docx_export_writes_the_first_line_indent_in_twips() {
    let package = entries(document_to_docx(&sample_document()));
    let document_xml = entry(&package, "word/document.xml");

    // 0.5 in = 720 twips.
    assert!(
        document_xml.contains("w:firstLine=\"720\""),
        "expected <w:ind w:firstLine=\"720\"/> in word/document.xml"
    );
}

#[test]
fn s_019_epub_export_preserves_the_tab_and_the_indent() {
    let package = entries(document_to_epub(&sample_document()));
    let xhtml = entry(&package, "OEBPS/sec-1.xhtml");

    // A raw tab or its XML numeric reference are the same character to a reader.
    assert!(
        xhtml.contains("A\tB") || xhtml.contains("A&#9;B"),
        "the tab character must survive into the section XHTML"
    );

    let all: String = package
        .iter()
        .map(|(_, content)| content.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        all.contains("pre-wrap"),
        "the package must preserve whitespace or the tab collapses"
    );
    assert!(
        all.contains("text-indent") && (all.contains("48px") || all.contains("0.5in")),
        "the half-inch first-line indent must reach the reader"
    );
}
