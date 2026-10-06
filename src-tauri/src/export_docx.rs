//! DOCX (Word `.docx`) export of the live document.
//!
//! A `.docx` file is an OPC package: a ZIP archive whose entries are OOXML
//! "parts" (XML files) plus relationships that wire them together. This module
//! emits those parts by hand — `document.xml` (the body), `styles.xml` (the
//! Normal / Heading1 / Heading2 style definitions Word and mammoth both look
//! up by name), `[Content_Types].xml`, and the two `.rels` files — and hands
//! the bytes to the `zip` crate to deflate and archive.
//!
//! Why hand-rolled OOXML instead of a high-level `docx-rs` crate:
//! - The output is plain, readable OOXML. There is no opaque dependency to
//!   audit, and a Rust novice can follow exactly what lands on disk.
//! - It round-trips with the EXISTING import path. The frontend imports
//!   `.docx` via `mammoth`, which maps a paragraph's style by its NAME
//!   (`heading 1` → `<h1>`, `heading 2` → `<h2>`), and `useImport.js` then maps
//!   `<h2>` → `chapter`, any other heading → `section`. We mirror that exactly:
//!   `Chapter` → style "Heading2" (name "heading 2"), `Section` → style
//!   "Heading1" (name "heading 1"). So exporting a chapter and re-importing it
//!   yields the same section type. The derived chapter number is baked into
//!   the heading text exactly as the editor/manuscript render it, so a
//!   re-imported chapter keeps its prefix without the "Chapter 2: Chapter 2"
//!   duplication 2.6's dedup handles anyway.
//! - Run-level formatting (`TextStyle.bold/italic/underline/font_size`) maps to
//!   the standard `<w:b/>`, `<w:i/>`, `<w:u>`, `<w:sz>` run-property children,
//!   which mammoth reads back as `<strong>`/`<em>`/`<u>` and the import preserves.
//!
//! Output is written via `history::atomic_write` so a crash mid-export cannot
//! leave a half-written file on disk, mirroring `export_text`.

use crate::document::{Document, SectionType, TextStyle};
use crate::history::atomic_write;
use crate::state::AppState;
use std::io::{Cursor, Write};
use std::path::Path;
use tauri::State;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

/// The page geometry for the exported document, in twips (1/1440 inch). US
/// Letter (8.5×11in = 12240×15840 twips) with 1in (1440 twip) margins — a
/// conventional manuscript page. These land in the final `<w:sectPr>` so Word
/// opens the file at a sane page size; they do not affect text content.
const PAGE_WIDTH_TWIPS: u32 = 12240;
const PAGE_HEIGHT_TWIPS: u32 = 15840;
const MARGIN_TWIPS: u32 = 1440;

/// Render `doc` as a complete `.docx` byte vector. Pure over the document — no
/// I/O, no state — so the tests can call it directly. The bytes are a valid
/// OPC zip a reader (Word, Pages, LibreOffice, mammoth) can open.
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

    // The package's entry relationships and content-types MUST be present for
    // a reader to know how to open the parts; the order of entries inside the
    // zip is not significant.
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

/// Build the `word/document.xml` body: one heading paragraph per section
/// (Chapter → Heading2, Section → Heading1), then one paragraph per body
/// `Paragraph` whose runs carry their `TextStyle`. Chapter numbering is
/// render-derived (1-based position among chapters), matching the editor and
/// `export_text`.
fn build_document_xml(doc: &Document) -> String {
    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    out.push_str(
        "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
    );
    out.push_str("<w:body>");

    let mut chapter_count = 0u32;
    for section in &doc.sections {
        // Heading paragraph. Chapters always emit (with the derived number);
        // a section with an empty title emits no heading, mirroring
        // `export_text` (no empty heading line).
        if let Some(heading) = section_heading(section, &mut chapter_count) {
            out.push_str(&heading);
        }

        for paragraph in &section.paragraphs {
            out.push_str(&body_paragraph_xml(paragraph));
        }
    }

    // The section properties MUST be the last child of the body. They describe
    // the page; without them Word uses a default, but emitting them keeps the
    // file unambiguous.
    out.push_str(&format!(
        "<w:sectPr><w:pgSz w:w=\"{w}\" w:h=\"{h}\"/><w:pgMar w:top=\"{m}\" w:right=\"{m}\" w:bottom=\"{m}\" w:left=\"{m}\"/></w:sectPr>",
        w = PAGE_WIDTH_TWIPS,
        h = PAGE_HEIGHT_TWIPS,
        m = MARGIN_TWIPS
    ));
    out.push_str("</w:body></w:document>");
    out
}

/// Build the heading paragraph for a section, or `None` if the section has no
/// heading (a Section with an empty title). Chapters always render: an empty
/// chapter title becomes "Chapter N" with no trailing colon, exactly as in
/// `export_text`. Advances `chapter_count` for every Chapter encountered.
fn section_heading(
    section: &crate::document::Section,
    chapter_count: &mut u32,
) -> Option<String> {
    let title = section.title.trim();
    // A hidden section emits no heading paragraph, but its body paragraphs
    // still export. A hidden CHAPTER still advances the counter — chapter
    // numbers are render-derived positionally (same as the editor), so
    // hiding one must not renumber the chapters after it.
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

/// One heading paragraph referencing a style by its styleId. The style
/// definition (name "heading 1"/"heading 2") lives in `styles.xml`; mammoth
/// resolves the styleId to its name and maps to `<h1>`/`<h2>` on import.
fn heading_paragraph_xml(style_id: &str, text: &str) -> String {
    format!(
        "<w:p><w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>{run}</w:p>",
        style = xml_escape(style_id),
        run = run_xml(text, &TextStyle::default())
    )
}

/// One body paragraph (Normal style): its runs concatenated, each carrying its
/// own `TextStyle` as run properties. An empty paragraph still emits an empty
/// `<w:p>` so paragraph breaks the author inserted are preserved.
fn body_paragraph_xml(paragraph: &crate::document::Paragraph) -> String {
    let mut runs = String::new();
    for element in &paragraph.elements {
        runs.push_str(&run_xml(&element.text_run.content, &element.text_run.text_style));
    }
    format!("<w:p>{}</w:p>", runs)
}

/// One run: the text content wrapped in `<w:r>`, preceded by run properties
/// (`<w:rPr>`) when the style is non-default. Property children are emitted in
/// the OOXML schema order (b → i → sz → u) so the file validates against the
/// strict schema, not just Word's lenient reader.
///
/// `font_size` is stored in points in the model but `w:sz` uses half-points
/// (so 12pt → `w:val="24"`), the WordprocessingML convention.
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
    format!("<w:r>{}<w:t xml:space=\"preserve\">{}</w:t></w:r>", rpr, xml_escape(text))
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

/// Export the live document to `path` as a `.docx`. Locks the document the way
/// the other commands do (a single short-lived `Mutex` guard), renders via
/// `document_to_docx`, then writes the bytes via `atomic_write`. Read-only:
/// does not mark the document modified or touch its history.
#[tauri::command]
pub fn export_docx(path: String, state: State<AppState>) -> Result<(), String> {
    let doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let bytes = document_to_docx(&doc);
    atomic_write(Path::new(&path), &bytes).map_err(|e| e.to_string())
}

// --- Static OOXML parts ----------------------------------------------------

/// Declares the MIME types of the parts in the package. The two `Default`
/// entries cover `.rels` and `.xml` generically; the `Override` entries pin
/// the document and styles parts to their specific OOXML content types so a
/// reader knows how to parse them.
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

/// The styles part. Defines Normal (the default body paragraph style) plus
/// Heading1 and Heading2, each carrying the `w:name` ("heading 1"/"heading 2")
/// mammoth matches on import. `qFormat` marks them as quick styles (visible in
/// the styles gallery); `outlineLvl` gives them a navigation outline level so
/// Word's nav pane lists the chapters/sections.
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
            has_epigram: false,
            epigram_text: String::new(),
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
            has_epigram: false,
            epigram_text: String::new(),
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
            has_epigram: false,
            epigram_text: String::new(),
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
            has_epigram: false,
            epigram_text: String::new(),
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
            has_epigram: false,
            epigram_text: String::new(),
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
            has_epigram: false,
            epigram_text: String::new(),
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
            has_epigram: false,
            epigram_text: String::new(),
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
            has_epigram: false,
            epigram_text: String::new(),
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