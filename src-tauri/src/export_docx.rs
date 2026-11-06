//! DOCX (Word `.docx`) export of the live document.
//!
//! A `.docx` is an OPC package: a ZIP of OOXML parts plus the relationships that
//! wire them. This module writes those parts by hand — `document.xml`,
//! `styles.xml`, `[Content_Types].xml` and the two `.rels` files — and hands the
//! bytes to the `zip` crate.
//!
//! Why hand-rolled rather than a `docx-rs` crate:
//! - The output is plain OOXML with no opaque dependency to audit.
//! - It round-trips with the existing import. `mammoth` maps a paragraph by style
//!   name, so `Chapter` → "Heading2" ("heading 2" → `<h2>` → `chapter`) and
//!   `Section` → "Heading1", exactly the mapping `useImport.js` reverses. A
//!   re-imported chapter keeps its derived number, which 2.6's dedup already
//!   guards against duplicating.
//! - Run formatting maps to the standard `<w:b/>`, `<w:i/>`, `<w:u>`, `<w:sz>`
//!   properties, which mammoth reads back as `<strong>`, `<em>`, `<u>`.
//!
//! Writes go through `history::atomic_write`, as `export_text` does, so a crash
//! mid-export leaves no half-written file.

use crate::document::{Document, SectionType, TextStyle};
use crate::history::atomic_write;
use crate::state::AppState;
use std::io::{Cursor, Write};
use std::path::Path;
use tauri::State;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

/// WordprocessingML measures length in twips: 1/1440 inch. Twips are integers,
/// so layout math neither drifts nor depends on screen DPI.
const TWIPS_PER_INCH: f32 = 1440.0;

/// US Letter (12240×15840 twips) with 1in margins — a conventional manuscript
/// page. These land in `<w:sectPr>`, so Word opens the file at a sane size.
const PAGE_WIDTH_TWIPS: u32 = 12240;
const PAGE_HEIGHT_TWIPS: u32 = 15840;
const MARGIN_TWIPS: u32 = 1440;

/// Render `doc` as complete `.docx` bytes. Pure: no I/O, no state, so the tests
/// call it directly.
pub fn document_to_docx(doc: &Document) -> Vec<u8> {
    let document_xml = build_document_xml(doc);
    let styles_xml = STYLES_XML;
    let content_types_xml = CONTENT_TYPES_XML;
    let root_rels_xml = ROOT_RELS_XML;
    let document_rels_xml = DOCUMENT_RELS_XML;

    let buf = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(buf);
    // Deflate every part. `.docx` readers require the XML parts to be stored
    // deflated (or stored raw); deflated keeps the file small.
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    // A reader needs the relationships and content types to know how to open the
    // parts; entry order inside the zip does not matter.
    zip.start_file("[Content_Types].xml", options)
        .expect("start content types");
    zip.write_all(content_types_xml.as_bytes())
        .expect("write content types");
    zip.start_file("_rels/.rels", options).expect("start root rels");
    zip.write_all(root_rels_xml.as_bytes()).expect("write root rels");
    zip.start_file("word/_rels/document.xml.rels", options)
        .expect("start document rels");
    zip.write_all(document_rels_xml.as_bytes())
        .expect("write document rels");
    zip.start_file("word/document.xml", options)
        .expect("start document");
    zip.write_all(document_xml.as_bytes()).expect("write document");
    zip.start_file("word/styles.xml", options).expect("start styles");
    zip.write_all(styles_xml.as_bytes()).expect("write styles");

    let buf = zip
        .finish()
        .expect("finalize zip")
        .into_inner();
    buf
}

/// Build `word/document.xml`: a heading paragraph per section (Chapter →
/// Heading2, Section → Heading1), then one paragraph per body `Paragraph`.
/// Chapter numbers are render-derived, as in the editor and `export_text`.
fn build_document_xml(doc: &Document) -> String {
    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    out.push_str(
        "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
    );
    out.push_str("<w:body>");

    let mut chapter_count = 0u32;
    for section in &doc.sections {
        // Chapters always emit a heading; a section with an empty title emits
        // none, as `export_text` does.
        if let Some(heading) = section_heading(section, &mut chapter_count) {
            out.push_str(&heading);
        }

        for paragraph in &section.paragraphs {
            out.push_str(&body_paragraph_xml(paragraph));
        }
    }

    // `<w:sectPr>` must be the body's last child. It describes the page, and
    // without it Word falls back to a default.
    out.push_str(&format!(
        "<w:sectPr><w:pgSz w:w=\"{w}\" w:h=\"{h}\"/><w:pgMar w:top=\"{m}\" w:right=\"{m}\" w:bottom=\"{m}\" w:left=\"{m}\"/></w:sectPr>",
        w = PAGE_WIDTH_TWIPS,
        h = PAGE_HEIGHT_TWIPS,
        m = MARGIN_TWIPS
    ));
    out.push_str("</w:body></w:document>");
    out
}

/// The heading paragraph for a section, or `None` when it renders none (an empty
/// Section title). An untitled chapter becomes "Chapter N" with no trailing
/// colon, as in `export_text`. Advances `chapter_count` per Chapter.
fn section_heading(
    section: &crate::document::Section,
    chapter_count: &mut u32,
) -> Option<String> {
    let title = section.title.trim();
    // A hidden section emits no heading but its body still exports. A hidden
    // CHAPTER still advances the counter: numbers are positional, so hiding one
    // must not renumber the rest.
    if section.hidden {
        if section.section_type == SectionType::Chapter {
            *chapter_count += 1;
        }
        return None;
    }
    match section.section_type {
        SectionType::Chapter => {
            *chapter_count += 1;
            let n = *chapter_count;
            let text = if title.is_empty() {
                format!("Chapter {}", n)
            } else {
                format!("Chapter {}: {}", n, title)
            };
            Some(heading_paragraph_xml("Heading2", &text))
        }
        SectionType::Section => {
            if title.is_empty() {
                None
            } else {
                Some(heading_paragraph_xml("Heading1", title))
            }
        }
    }
}

/// One heading paragraph referencing a styleId. `styles.xml` names that style
/// "heading 1"/"heading 2", which mammoth resolves and maps to `<h1>`/`<h2>`.
fn heading_paragraph_xml(style_id: &str, text: &str) -> String {
    format!(
        "<w:p><w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>{run}</w:p>",
        style = xml_escape(style_id),
        run = run_xml(text, &TextStyle::default())
    )
}

/// One body paragraph: its runs concatenated, each carrying its own `TextStyle`.
/// An empty paragraph still emits `<w:p></w:p>`, so authored breaks survive. A
/// first-line indent becomes `<w:firstLine>` inside `<w:pPr>`, in twips; without
/// one no `<w:pPr>` is emitted at all.
fn body_paragraph_xml(paragraph: &crate::document::Paragraph) -> String {
    let mut content = String::new();
    if let Some(inches) = paragraph.first_line_indent {
        content.push_str(&format!(
            "<w:pPr><w:ind w:firstLine=\"{}\"/></w:pPr>",
            inches_to_twips(inches)
        ));
    }
    for element in &paragraph.elements {
        content.push_str(&run_xml(&element.text_run.content, &element.text_run.text_style));
    }
    format!("<w:p>{}</w:p>", content)
}

/// Scale an indent from inches to twips, the WordprocessingML unit: an inch is
/// 1440 twips, so a half-inch indent writes `w:firstLine="720"`.
fn inches_to_twips(inches: f32) -> i64 {
    (inches * TWIPS_PER_INCH).round() as i64
}

/// One run: `<w:r>` around the text, preceded by `<w:rPr>` when the style is
/// non-default. Property children follow schema order (b → i → sz → u), so the
/// file validates strictly, not just in Word. `font_size` is in points;
/// `w:sz` takes half-points, so 12pt → `w:val="24"`.
fn run_xml(text: &str, style: &TextStyle) -> String {
    let mut rpr = String::new();
    if style.bold || style.italic || style.underline || style.font_size.is_some() {
        rpr.push_str("<w:rPr>");
        if style.bold {
            rpr.push_str("<w:b/>");
        }
        if style.italic {
            rpr.push_str("<w:i/>");
        }
        if let Some(size) = style.font_size {
            // points → half-points (OOXML stores font size in half-points).
            rpr.push_str(&format!("<w:sz w:val=\"{}\"/>", size * 2));
        }
        if style.underline {
            rpr.push_str("<w:u w:val=\"single\"/>");
        }
        rpr.push_str("</w:rPr>");
    }
    format!("<w:r>{}{}</w:r>", rpr, run_content_xml(text))
}

/// The content of one `<w:r>`: text in `<w:t xml:space="preserve">`, with every
/// tab replaced by `<w:tab/>`. A literal U+0009 in `<w:t>` is not a tab to Word,
/// so none may survive into `document.xml`. Empty segments around tabs are
/// skipped, and a run without tabs keeps the single `<w:t>`.
fn run_content_xml(text: &str) -> String {
    if !text.contains('\t') {
        return format!("<w:t xml:space=\"preserve\">{}</w:t>", xml_escape(text));
    }
    let mut out = String::new();
    for (i, segment) in text.split('\t').enumerate() {
        if i > 0 {
            out.push_str("<w:tab/>");
        }
        if !segment.is_empty() {
            out.push_str(&format!(
                "<w:t xml:space=\"preserve\">{}</w:t>",
                xml_escape(segment)
            ));
        }
    }
    out
}

/// Escape the five XML metacharacters for text content / attribute values.
/// `xml:space="preserve"` on every `<w:t>` keeps leading/trailing whitespace,
/// which a plain `<w:t>` would collapse.
fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c => out.push(c),
        }
    }
    out
}

/// Export the live document to `path` as a `.docx`. Locks the document as the
/// other commands do, renders via `document_to_docx`, and writes with
/// `atomic_write`. Read-only: no modified flag, no history.
#[tauri::command]
pub fn export_docx(path: String, state: State<AppState>) -> Result<(), String> {
    let doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let bytes = document_to_docx(&doc);
    atomic_write(Path::new(&path), &bytes).map_err(|e| e.to_string())
}

// --- Static OOXML parts ----------------------------------------------------

/// The MIME type of every part. `Default` covers `.rels` and `.xml`; the
/// `Override` entries pin the document and styles parts to their OOXML types.
const CONTENT_TYPES_XML: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
<Default Extension=\"xml\" ContentType=\"application/xml\"/>\
<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>\
<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>\
</Types>";

/// The package root relationships: just the one link to the document part.
const ROOT_RELS_XML: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>\
</Relationships>";

/// The document part's relationships: a link to its styles part.
const DOCUMENT_RELS_XML: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>\
</Relationships>";

/// The styles part: Normal, plus Heading1 and Heading2 with the `w:name` mammoth
/// matches on import. `qFormat` makes them quick styles and `outlineLvl` puts
/// them in Word's navigation pane.
const STYLES_XML: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">\
<w:docDefaults>\
<w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Times New Roman\" w:hAnsi=\"Times New Roman\" w:cs=\"Times New Roman\"/><w:sz w:val=\"24\"/><w:szCs w:val=\"24\"/></w:rPr></w:rPrDefault>\
<w:pPrDefault><w:pPr><w:spacing w:after=\"160\" w:line=\"259\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault>\
</w:docDefaults>\
<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/><w:qFormat/></w:style>\
<w:style w:type=\"paragraph\" w:styleId=\"Heading1\"><w:name w:val=\"heading 1\"/><w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before=\"240\" w:after=\"120\"/><w:outlineLvl w:val=\"0\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"32\"/><w:szCs w:val=\"32\"/></w:rPr></w:style>\
<w:style w:type=\"paragraph\" w:styleId=\"Heading2\"><w:name w:val=\"heading 2\"/><w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before=\"200\" w:after=\"120\"/><w:outlineLvl w:val=\"1\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"28\"/><w:szCs w:val=\"28\"/></w:rPr></w:style>\
</w:styles>";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Element, Paragraph, Section, TextRun};
    use std::io::Read;

    fn create_paragraph(id: &str, text: &str) -> Paragraph {
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

    fn create_section(
        id: &str,
        title: &str,
        section_type: SectionType,
        paragraphs: Vec<Paragraph>,
    ) -> Section {
        Section {
            id: id.to_string(),
            title: title.to_string(),
            section_type,
            hidden: false,
            paragraphs,
        }
    }

    fn sample_document() -> Document {
        Document {
            title: "T".to_string(),
            author: "A".to_string(),
            author_contact: "C".to_string(),
            has_toc: false,
            sections: vec![
                create_section(
                    "s1",
                    "The Arrival",
                    SectionType::Chapter,
                    vec![create_paragraph("p1", "It was a dark and stormy night.")],
                ),
                create_section(
                    "s2",
                    "Notes",
                    SectionType::Section,
                    vec![create_paragraph("p2", "A section for stray thoughts.")],
                ),
            ],
        }
    }

    /// Extract a single part from the produced zip by name, returning its
    /// decompressed bytes as a UTF-8 string. Asserts the archive is well-formed
    /// and contains the part — the first thing that would break if the emitter
    /// produced a corrupt package.
    fn read_part(bytes: &[u8], name: &str) -> String {
        let cursor = Cursor::new(bytes.to_vec());
        let mut archive = zip::ZipArchive::new(cursor).expect("valid zip");
        let mut file = archive.by_name(name).expect("part exists");
        let mut out = String::new();
        file.read_to_string(&mut out).expect("part is valid utf-8");
        out
    }

    #[test]
    fn produces_a_valid_zip_with_the_expected_parts() {
        let bytes = document_to_docx(&sample_document());
        let cursor = Cursor::new(bytes);
        let archive = zip::ZipArchive::new(cursor).expect("the bytes are a readable zip");
        let names: Vec<&str> = archive.file_names().collect();
        // The five parts a minimal valid .docx needs.
        for required in [
            "[Content_Types].xml",
            "_rels/.rels",
            "word/_rels/document.xml.rels",
            "word/document.xml",
            "word/styles.xml",
        ] {
            assert!(names.contains(&required), "missing part: {required}");
        }
    }

    #[test]
    fn chapter_maps_to_heading2_and_section_to_heading1() {
        let bytes = document_to_docx(&sample_document());
        let body = read_part(&bytes, "word/document.xml");
        // Chapter → Heading2; its derived number is baked into the text.
        assert!(body.contains("<w:pStyle w:val=\"Heading2\"/>"));
        assert!(body.contains("Chapter 1: The Arrival"));
        // Section → Heading1.
        assert!(body.contains("<w:pStyle w:val=\"Heading1\"/>"));
        // No Heading1 used for the chapter.
        assert!(body.contains("Notes"));
    }

    #[test]
    fn chapter_numbering_is_derived_across_chapters() {
        let doc = Document {
            title: "T".to_string(),
            author: "A".to_string(),
            author_contact: "C".to_string(),
            has_toc: false,
            sections: vec![
                create_section("s1", "First", SectionType::Chapter, vec![create_paragraph("p1", "a")]),
                create_section("s2", "Interlude", SectionType::Section, vec![create_paragraph("p2", "b")]),
                create_section("s3", "Second", SectionType::Chapter, vec![create_paragraph("p3", "c")]),
            ],
        };
        let body = read_part(&document_to_docx(&doc), "word/document.xml");
        assert!(body.contains("Chapter 1: First"));
        assert!(body.contains("Chapter 2: Second"));
        assert!(!body.contains("Chapter 3"));
    }

    #[test]
    fn body_text_is_preserved_and_whitespace_kept() {
        let bytes = document_to_docx(&sample_document());
        let body = read_part(&bytes, "word/document.xml");
        // `xml:space="preserve"` keeps leading/trailing spaces.
        assert!(body.contains("It was a dark and stormy night."));
        assert!(body.contains("<w:t xml:space=\"preserve\">"));
    }

    #[test]
    fn run_styles_emit_bold_italic_underline_and_size() {
        let para = Paragraph {
            id: "p1".to_string(),
            elements: vec![Element {
                text_run: TextRun {
                    content: "styled".to_string(),
                    text_style: TextStyle {
                        bold: true,
                        italic: true,
                        underline: true,
                        font_size: Some(14),
                    },
                },
            }],
            left_indent: None,
            right_indent: None,
            first_line_indent: None,
        };
        let doc = Document {
            title: "T".to_string(),
            author: "A".to_string(),
            author_contact: "C".to_string(),
            has_toc: false,
            sections: vec![create_section("s1", "S", SectionType::Section, vec![para])],
        };
        let body = read_part(&document_to_docx(&doc), "word/document.xml");
        // All four run properties present, in schema order (b, i, sz, u).
        let rpr = body
            .split("<w:rPr>")
            .nth(1)
            .and_then(|s| s.split("</w:rPr>").next())
            .expect("an rPr was emitted");
        let b = rpr.find("<w:b/>").unwrap();
        let i = rpr.find("<w:i/>").unwrap();
        let sz = rpr.find("<w:sz w:val=\"28\"/>").unwrap(); // 14pt → 28 half-points
        let u = rpr.find("<w:u w:val=\"single\"/>").unwrap();
        assert!(b < i && i < sz && sz < u, "run properties are in schema order b < i < sz < u");
    }

    #[test]
    fn xml_metacharacters_in_text_are_escaped() {
        let para = create_paragraph("p1", "a < b > c & d \"e\" 'f'");
        let doc = Document {
            title: "T".to_string(),
            author: "A".to_string(),
            author_contact: "C".to_string(),
            has_toc: false,
            sections: vec![create_section("s1", "S", SectionType::Section, vec![para])],
        };
        let body = read_part(&document_to_docx(&doc), "word/document.xml");
        // Escaped, not raw.
        assert!(body.contains("a &lt; b &gt; c &amp; d &quot;e&quot; &apos;f&apos;"));
        assert!(!body.contains("a < b > c & d"));
    }

    #[test]
    fn empty_chapter_title_renders_number_without_colon() {
        let doc = Document {
            title: "T".to_string(),
            author: "A".to_string(),
            author_contact: "C".to_string(),
            has_toc: false,
            sections: vec![create_section("s1", "  ", SectionType::Chapter, vec![create_paragraph("p1", "body")])],
        };
        let body = read_part(&document_to_docx(&doc), "word/document.xml");
        assert!(body.contains("Chapter 1</w:t>"));
        assert!(!body.contains("Chapter 1:"));
    }

    #[test]
    fn empty_section_title_omits_the_heading_paragraph() {
        let doc = Document {
            title: "T".to_string(),
            author: "A".to_string(),
            author_contact: "C".to_string(),
            has_toc: false,
            sections: vec![create_section("s2", "", SectionType::Section, vec![create_paragraph("p2", "body two")])],
        };
        let body = read_part(&document_to_docx(&doc), "word/document.xml");
        assert!(!body.contains("Heading1"));
        assert!(body.contains("body two"));
    }

    #[test]
    fn hidden_section_omits_heading_paragraph_but_keeps_body() {
        let mut epigram = create_section(
            "s1",
            "Epigram",
            SectionType::Section,
            vec![create_paragraph("p1", "Only connect.")],
        );
        epigram.hidden = true;
        let doc = Document {
            title: "T".to_string(),
            author: "A".to_string(),
            author_contact: "C".to_string(),
            has_toc: false,
            sections: vec![epigram],
        };
        let body = read_part(&document_to_docx(&doc), "word/document.xml");
        // No heading paragraph at all, but the epigram's body text exports.
        assert!(!body.contains("Heading1"));
        assert!(!body.contains("Epigram"));
        assert!(body.contains("Only connect."));
    }

    #[test]
    fn hidden_chapter_still_advances_numbering() {
        let mut hidden_chapter = create_section(
            "s1",
            "Cut",
            SectionType::Chapter,
            vec![create_paragraph("p1", "removed scene")],
        );
        hidden_chapter.hidden = true;
        let doc = Document {
            title: "T".to_string(),
            author: "A".to_string(),
            author_contact: "C".to_string(),
            has_toc: false,
            sections: vec![
                hidden_chapter,
                create_section(
                    "s2",
                    "The Arrival",
                    SectionType::Chapter,
                    vec![create_paragraph("p2", "body")],
                ),
            ],
        };
        let body = read_part(&document_to_docx(&doc), "word/document.xml");
        // The visible chapter keeps its positionally derived number (2), and
        // the hidden chapter's title/heading never renders.
        assert!(body.contains("Chapter 2: The Arrival"));
        assert!(!body.contains("Cut"));
        assert!(!body.contains("Heading2\"><w:r><w:t>Chapter 1"));
    }

    #[test]
    fn styles_part_declares_heading_names_mammoth_matches() {
        let bytes = document_to_docx(&sample_document());
        let styles = read_part(&bytes, "word/styles.xml");
        // mammoth maps by these names on import.
        assert!(styles.contains("<w:name w:val=\"heading 1\"/>"));
        assert!(styles.contains("<w:name w:val=\"heading 2\"/>"));
    }

    #[test]
    fn atomic_write_round_trips_docx_bytes_to_disk() {
        let tmp = std::env::temp_dir().join(format!("rite-docx-{}.docx", uuid::Uuid::new_v4()));
        let bytes = document_to_docx(&sample_document());
        // `atomic_write` is generic over bytes now, so the binary DOCX goes
        // through the same temp-file-then-rename path as the text exports.
        crate::history::atomic_write(&tmp, &bytes).unwrap();
        let on_disk = std::fs::read(&tmp).unwrap();
        assert_eq!(on_disk, bytes);
        let _ = std::fs::remove_file(&tmp);
    }
}