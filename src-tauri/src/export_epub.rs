//! EPUB (`.epub`) export of the live document.
//!
//! An EPUB is a ZIP of XML parts fixed by OCF: `mimetype` first and stored
//! uncompressed, `META-INF/container.xml` pointing at the OPF, and the OPF with
//! metadata, manifest and spine. This module writes those parts by hand, as
//! `export_docx` does, and hands the bytes to the `zip` crate.
//!
//! Deliberate differences from the other exports:
//! - Hidden sections are skipped entirely (S-011). The ebook is reader-facing,
//!   so a hidden section produces no XHTML, manifest, spine or nav entry.
//!   `export_text` keeps its body and drops only the header.
//! - Chapter numbers count visible chapters only (S-012), where `export_text`
//!   and `export_docx` keep hidden chapters in the numbering. Do not unify them.
//! - `nav.xhtml` is always emitted (S-013); `has_toc` gates the printed TOC.
//! - `author_contact` never enters the package (S-014): submission data.
//! - The title page and nav are manifest items but not spine items (S-016), so
//!   an all-hidden document still yields a valid, empty spine.
//! - Tabs survive: the shared stylesheet sets `white-space: pre-wrap` and
//!   `tab-size: 48px`, and an explicit first-line indent is inlined as
//!   `style="text-indent: …px"` (S-019).
//!
//! Rendering is a pure function of the document. Zip metadata is pinned and the
//! identifier is content-derived, because the command test renders twice and
//! requires identical bytes — which is also why the OPF has no
//! `dcterms:modified`.

use crate::document::{Document, Section, SectionType, TextStyle};
use crate::history::atomic_write;
use crate::state::AppState;
use std::io::{Cursor, Write};
use std::path::Path;
use tauri::State;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

/// The content of the `mimetype` entry, byte-exact (S-001). Readers sniff this
/// before parsing the zip, so it must be stored first and uncompressed.
const MIMETYPE: &str = "application/epub+zip";

/// OCF container pointing at the package document (S-002). `full-path` is
/// relative to the package root.
const CONTAINER_XML: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">\n\
<rootfiles>\n\
<rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/>\n\
</rootfiles>\n\
</container>\n";

/// The shared stylesheet, linked from every XHTML document. `pre-wrap` keeps
/// literal tabs; `tab-size: 48px` makes a tab as wide as the half-inch indent.
/// A constant: nothing document-derived may shape the bytes (determinism).
const STYLE_CSS: &str = "p { white-space: pre-wrap; tab-size: 48px; }\n";

/// Zip entry options with a pinned timestamp. The default reads the wall clock
/// when the `time` feature is on, and two renders must be byte-identical.
fn zip_options(method: CompressionMethod) -> SimpleFileOptions {
    let stamp = DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0)
        .unwrap_or_else(|_| DateTime::default());
    SimpleFileOptions::default()
        .last_modified_time(stamp)
        .compression_method(method)
}

/// Trim a piece of metadata, falling back when it is blank — `Untitled` /
/// `Author Name`, the fallbacks S-015 names.
fn metadata_value(raw: &str, fallback: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Escape `&`, `<`, `>` and `"` for text content and quoted attributes. Every
/// piece of document text passes through here; generator-owned ids need no
/// escaping. Manual by design: the crate has no XML library.
fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c => out.push(c),
        }
    }
    out
}

/// Render `doc` as complete EPUB bytes. Pure: no I/O, no state, no clock, so the
/// integration tests call it directly and compare two renders byte for byte.
///
/// The manifest, the archive and the spine come from one list of section files,
/// so they agree by construction (S-003/S-004).
pub fn document_to_epub(doc: &Document) -> Vec<u8> {
    let title = metadata_value(&doc.title, "Untitled");
    let author = metadata_value(&doc.author, "Author Name");

    // One XHTML file per visible section, filtered before numbering so a hidden
    // chapter consumes no number (S-011/S-012). The spine holds only these; nav
    // and the title page are manifest-only, so an all-hidden document keeps an
    // empty spine (S-016).
    let mut chapter_count = 0u32;
    let mut manifest_items: Vec<(String, String)> = Vec::new(); // (id, href)
    let mut nav_entries: Vec<(String, String)> = Vec::new(); // (href, label)
    let mut section_parts: Vec<(String, String)> = Vec::new(); // (archive path, xhtml)

    for section in doc.sections.iter().filter(|s| !s.hidden) {
        let id = format!("sec-{}", manifest_items.len() + 1);
        let href = format!("{id}.xhtml");
        let heading = derived_heading(section, &mut chapter_count);
        // Chapters always render a heading; a Section whose title is blank
        // renders no heading (as in export_text) — but nav must still list
        // every visible section (S-013), so it falls back to a stable label.
        let label = if heading.is_empty() {
            "Untitled".to_string()
        } else {
            heading.clone()
        };
        section_parts.push((
            format!("OEBPS/{href}"),
            xhtml_document(&label, &section_body(section, &heading), false),
        ));
        manifest_items.push((id, href.clone()));
        nav_entries.push((href, label));
    }

    let opf_xml = build_opf(&package_identifier(doc), &title, &author, &manifest_items);
    let nav_xml = xhtml_document(&title, &nav_body(&title, &nav_entries), true);
    let titlepage_xml = xhtml_document(&title, &title_page_body(&title, &author), false);

    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));

    // `mimetype` must be the first entry, stored uncompressed, or readers that
    // sniff the format cannot open the file (S-001).
    zip.start_file("mimetype", zip_options(CompressionMethod::Stored))
        .expect("start mimetype entry");
    zip.write_all(MIMETYPE.as_bytes())
        .expect("write mimetype entry");
    zip.start_file("META-INF/container.xml", zip_options(CompressionMethod::Deflated))
        .expect("start container entry");
    zip.write_all(CONTAINER_XML.as_bytes())
        .expect("write container entry");
    zip.start_file("OEBPS/content.opf", zip_options(CompressionMethod::Deflated))
        .expect("start opf entry");
    zip.write_all(opf_xml.as_bytes()).expect("write opf entry");
    zip.start_file("OEBPS/style.css", zip_options(CompressionMethod::Deflated))
        .expect("start stylesheet entry");
    zip.write_all(STYLE_CSS.as_bytes())
        .expect("write stylesheet entry");
    zip.start_file("OEBPS/nav.xhtml", zip_options(CompressionMethod::Deflated))
        .expect("start nav entry");
    zip.write_all(nav_xml.as_bytes()).expect("write nav entry");
    zip.start_file("OEBPS/titlepage.xhtml", zip_options(CompressionMethod::Deflated))
        .expect("start titlepage entry");
    zip.write_all(titlepage_xml.as_bytes())
        .expect("write titlepage entry");
    for (archive_path, xhtml) in &section_parts {
        zip.start_file(archive_path, zip_options(CompressionMethod::Deflated))
            .expect("start section entry");
        zip.write_all(xhtml.as_bytes())
            .expect("write section entry");
    }

    zip.finish().expect("finalize zip").into_inner()
}

/// The heading a section renders, or empty when none. A Chapter gets `Chapter N:
/// title`, or bare `Chapter N` when untitled (S-007/S-008); a Section gets its
/// title and no number, or no heading when blank. Hidden sections never reach
/// here, so the counter advances once per visible chapter (S-012).
fn derived_heading(section: &Section, chapter_count: &mut u32) -> String {
    let title = section.title.trim();
    match section.section_type {
        SectionType::Chapter => {
            *chapter_count += 1;
            if title.is_empty() {
                format!("Chapter {}", *chapter_count)
            } else {
                format!("Chapter {}: {}", *chapter_count, title)
            }
        }
        SectionType::Section => title.to_string(),
    }
}

/// One inline run: text escaped (S-010) and wrapped in `<u>`, `<em>`, `<strong>`
/// as the style asks, nested strong → em → u (S-009). `font_size` is unmapped:
/// an ebook reflows, so it carries no fixed point sizes.
fn run_html(content: &str, style: &TextStyle) -> String {
    let mut html = xml_escape(content);
    if style.underline {
        html = format!("<u>{html}</u>");
    }
    if style.italic {
        html = format!("<em>{html}</em>");
    }
    if style.bold {
        html = format!("<strong>{html}</strong>");
    }
    html
}

/// The body of one section document: the heading when one renders, then one
/// `<p>` per paragraph with its runs concatenated verbatim (S-006). An empty
/// paragraph still emits `<p></p>`, so authored breaks survive. An explicit
/// indent is inlined as `style="text-indent: …px"`; none leaves the bare `<p>`.
fn section_body(section: &Section, heading: &str) -> String {
    let mut body = String::new();
    if !heading.is_empty() {
        body.push_str("<h1>");
        body.push_str(&xml_escape(heading));
        body.push_str("</h1>\n");
    }
    for paragraph in &section.paragraphs {
        let style = paragraph
            .first_line_indent
            .map(|inches| format!(" style=\"text-indent: {}px\"", inches_to_px(inches)))
            .unwrap_or_default();
        body.push_str(&format!("<p{style}>"));
        for element in &paragraph.elements {
            body.push_str(&run_html(
                &element.text_run.content,
                &element.text_run.text_style,
            ));
        }
        body.push_str("</p>\n");
    }
    body
}

/// Scale an indent from inches to whole CSS pixels at 96 px/in, the resolution
/// readers assume: a half inch becomes `48px`.
fn inches_to_px(inches: f32) -> i64 {
    (inches * 96.0).round() as i64
}

/// The EPUB 3 navigation document: exactly one link per visible section, in
/// document order, each pointing at that section's XHTML file (S-013). Always
/// emitted — `has_toc` gates the printed TOC, not this (decision 3).
fn nav_body(nav_title: &str, entries: &[(String, String)]) -> String {
    let mut body = String::new();
    body.push_str("<h1>");
    body.push_str(&xml_escape(nav_title));
    body.push_str("</h1>\n");
    body.push_str("<nav epub:type=\"toc\" id=\"toc\">\n<ol>\n");
    for (href, label) in entries {
        body.push_str("<li><a href=\"");
        body.push_str(href);
        body.push_str("\">");
        body.push_str(&xml_escape(label));
        body.push_str("</a></li>\n");
    }
    body.push_str("</ol>\n</nav>\n");
    body
}

/// The title page: the document title and author, nothing else. `author_contact`
/// is submission data (address, phone, email) and must never be exported
/// (S-014, decision 4).
fn title_page_body(title: &str, author: &str) -> String {
    let mut body = String::new();
    body.push_str("<h1>");
    body.push_str(&xml_escape(title));
    body.push_str("</h1>\n<p class=\"author\">");
    body.push_str(&xml_escape(author));
    body.push_str("</p>\n");
    body
}

/// Wrap content in a minimal deterministic XHTML 5 document. `epub_namespaced`
/// adds the EPUB namespace needed by `epub:type` (the nav document only).
fn xhtml_document(head_title: &str, body: &str, epub_namespaced: bool) -> String {
    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str("<!DOCTYPE html>\n");
    out.push_str("<html xmlns=\"http://www.w3.org/1999/xhtml\"");
    if epub_namespaced {
        out.push_str(" xmlns:epub=\"http://www.idpf.org/2007/ops\"");
    }
    out.push_str(" xml:lang=\"en\" lang=\"en\">\n");
    // Every wrapped document loads the shared stylesheet, the package's source
    // of `pre-wrap` (tab preservation).
    out.push_str("<head><title>");
    out.push_str(&xml_escape(head_title));
    out.push_str("</title><link rel=\"stylesheet\" type=\"text/css\" href=\"style.css\"/></head>\n");
    out.push_str("<body>\n");
    out.push_str(body);
    out.push_str("</body>\n</html>\n");
    out
}

/// The OPF package document (S-002 rootfile; S-003 version and manifest): EPUB 3
/// metadata, a manifest item for every XHTML part plus the stylesheet, and a
/// spine of the section documents in order. The title page, nav and stylesheet
/// get no spine itemref on purpose (S-016, decision 7).
fn build_opf(identifier: &str, title: &str, author: &str, sections: &[(String, String)]) -> String {
    let mut opf = String::new();
    opf.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    opf.push_str(
        "<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"pub-id\">\n",
    );
    opf.push_str("<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n");
    opf.push_str("<dc:identifier id=\"pub-id\">");
    opf.push_str(&xml_escape(identifier));
    opf.push_str("</dc:identifier>\n");
    opf.push_str("<dc:title>");
    opf.push_str(&xml_escape(title));
    opf.push_str("</dc:title>\n");
    opf.push_str("<dc:creator>");
    opf.push_str(&xml_escape(author));
    opf.push_str("</dc:creator>\n");
    opf.push_str("<dc:language>en</dc:language>\n");
    opf.push_str("</metadata>\n");
    opf.push_str("<manifest>\n");
    opf.push_str(
        "<item id=\"titlepage\" href=\"titlepage.xhtml\" media-type=\"application/xhtml+xml\"/>\n",
    );
    opf.push_str(
        "<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n",
    );
    // Manifest-only, like the title page and nav: not reading content, so no
    // spine position.
    opf.push_str("<item id=\"style\" href=\"style.css\" media-type=\"text/css\"/>\n");
    for (id, href) in sections {
        opf.push_str("<item id=\"");
        opf.push_str(id);
        opf.push_str("\" href=\"");
        opf.push_str(&href);
        opf.push_str("\" media-type=\"application/xhtml+xml\"/>\n");
    }
    opf.push_str("</manifest>\n");
    opf.push_str("<spine>\n");
    for (id, _) in sections {
        opf.push_str("<itemref idref=\"");
        opf.push_str(id);
        opf.push_str("\"/>\n");
    }
    opf.push_str("</spine>\n");
    opf.push_str("</package>\n");
    opf
}

const FNV1A_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV1A_PRIME: u64 = 0x0000_0100_0000_01b3;

/// Fold `bytes` into the running FNV-1a 64-bit hash.
fn fnv1a64(hash: &mut u64, bytes: &[u8]) {
    for &byte in bytes {
        *hash ^= byte as u64;
        *hash = hash.wrapping_mul(FNV1A_PRIME);
    }
}

/// A stable package identifier for `dc:identifier`: an FNV-1a hash of the
/// metadata and the visible-section ids, rendered as a urn. Deterministic on
/// purpose — a UUID or wall-clock stamp would make two renders differ. EPUB 3
/// wants an absolute IRI, and a content urn is one.
fn package_identifier(doc: &Document) -> String {
    let mut hash = FNV1A_OFFSET;
    fnv1a64(&mut hash, doc.title.trim().as_bytes());
    fnv1a64(&mut hash, &[0]);
    fnv1a64(&mut hash, doc.author.trim().as_bytes());
    fnv1a64(&mut hash, &[0]);
    for section in doc.sections.iter().filter(|s| !s.hidden) {
        fnv1a64(&mut hash, section.id.as_bytes());
        fnv1a64(&mut hash, &[0]);
    }
    format!("urn:rite:content-{hash:016x}")
}

/// Export the live document to `path` as an `.epub`. Locks the document as the
/// other export commands do, renders via [`document_to_epub`], and writes through
/// `history::atomic_write` so a failure never leaves a partial package (S-017)
/// and a missing target directory returns a non-empty `Err` (S-018). Read-only:
/// it marks nothing modified and touches no history.
#[tauri::command]
pub fn export_epub(path: String, state: State<AppState>) -> Result<(), String> {
    let doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let bytes = document_to_epub(&doc);
    atomic_write(Path::new(&path), &bytes).map_err(|e| e.to_string())
}