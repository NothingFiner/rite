//! EPUB (`.epub`) export of the live document.
//!
//! An EPUB is — like a `.docx` — a ZIP archive of XML parts. The shape of the
//! package is fixed by the OCF (Open Container Format): a first `mimetype`
//! entry stored uncompressed, a `META-INF/container.xml` that points at the
//! package document, and the OPF (`OEBPS/content.opf`) which declares the
//! metadata, a manifest of every part, and a spine (the reading order). This
//! module emits those parts by hand — no XML library in the crate, mirroring
//! `export_docx` — and hands the bytes to the `zip` crate.
//!
//! EPUB-specific behaviours, all intentional (SPEC.md "Decisions that are
//! intentional"):
//! - Hidden sections are skipped ENTIRELY, unlike `export_text` (which keeps a
//!   hidden section's body and drops only its header). The ebook is a
//!   reader-facing artifact, so a hidden section produces no XHTML file, no
//!   manifest item, no spine item and no nav entry — and its title/body never
//!   reach the package at all (S-011).
//! - Chapter numbers are derived positionally among *visible* chapters, so a
//!   hidden chapter does not consume a number (S-012). This is the opposite of
//!   `export_text`/`export_docx`, which keep hidden chapters in the numbering
//!   so the manuscript stays stable; do not "fix" either side.
//! - `nav.xhtml` is always emitted regardless of `Document.has_toc` (S-013):
//!   that flag gates the *printed* manuscript TOC, not ebook navigation.
//! - `author_contact` never lands in the package (S-014): it is
//!   manuscript-submission data, not reader-facing content.
//! - The title page and `nav.xhtml` are manifest items but NOT spine items, so
//!   a document with zero visible sections yields an empty (but valid) spine
//!   (S-016).
//! - Tab characters in body text survive: a shared stylesheet
//!   (`OEBPS/style.css`, manifest item `style`) sets `white-space: pre-wrap`
//!   on paragraphs, is linked from every XHTML document, and a paragraph's
//!   first-line indent is inlined as `style="text-indent: …px"` (S-019).
//!
//! Rendering is deterministic — a pure function of the document, with pinned
//! zip metadata and a content-derived identifier — because the command test
//! renders the package twice in one process and requires byte-identical
//! output. That is also why the OPF carries no `dcterms:modified`: a real
//! modification date would mean reading the wall clock.

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

/// OCF container: tells an EPUB reader which file is the package document
/// (S-002). The `full-path` is relative to the package root.
const CONTAINER_XML: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">\n\
<rootfiles>\n\
<rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/>\n\
</rootfiles>\n\
</container>\n";

/// The one shared stylesheet, written as `OEBPS/style.css` and linked from
/// every XHTML document. `white-space: pre-wrap` exists so body text keeps its
/// literal tab characters — a collapsing `white-space` would turn them into
/// plain spaces before a reader ever sees them; `tab-size: 48px` gives a tab
/// the width of the half-inch first-line indent (0.5 in at the 96 px/in CSS
/// reference resolution). A constant string on purpose: the package must
/// render byte-identically twice, so nothing document-derived may shape it.
const STYLE_CSS: &str = "p { white-space: pre-wrap; tab-size: 48px; }\n";

/// Zip entry options pinned to a fixed timestamp.
///
/// Rendering must be byte-for-byte deterministic across two calls in one
/// process. `SimpleFileOptions::default()` takes the modification time from
/// `DateTime::default_for_write()`, which reads the wall clock when the zip
/// crate's `time` feature is enabled — so the date is set explicitly here and
/// does not depend on the feature set.
fn zip_options(method: CompressionMethod) -> SimpleFileOptions {
    let stamp = DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0)
        .unwrap_or_else(|_| DateTime::default());
    SimpleFileOptions::default()
        .last_modified_time(stamp)
        .compression_method(method)
}

/// Trim a piece of metadata, falling back when it is blank (empty or
/// whitespace only) — S-015 names the exact fallbacks (`Untitled` /
/// `Author Name`).
fn metadata_value(raw: &str, fallback: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Escape the XML metacharacters the SPEC calls out — `&`, `<`, `>` and `"` —
/// for text content and double-quoted attribute values alike. Applied to every
/// piece of document text that reaches the package (headings, nav labels,
/// metadata, the title page); generator-owned identifiers (`sec-N`,
/// `sec-N.xhtml`) are built locally and need no escaping. Escaping `"` too
/// keeps a text run safe if an attribute value ever carries document text.
/// There is no XML library in the crate; escaping is manual by design.
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

/// Render `doc` as a complete EPUB byte vector. Pure over the document — no
/// I/O, no state, no clock — so the integration tests can call it directly and
/// render the same document twice into identical bytes.
///
/// The package carries: `mimetype`, `META-INF/container.xml`, the OPF,
/// `OEBPS/style.css`, `OEBPS/nav.xhtml`, a title page, and one XHTML document
/// per *visible* section. Manifest and spine are emitted from the same list of
/// section files the archive is built from, so manifest ↔ archive ↔ spine
/// agree by construction (S-003/S-004).
pub fn document_to_epub(doc: &Document) -> Vec<u8> {
    let title = metadata_value(&doc.title, "Untitled");
    let author = metadata_value(&doc.author, "Author Name");

    // One XHTML file per VISIBLE section, in document order. The filter runs
    // BEFORE numbering, so a hidden chapter consumes no number (S-011/S-012).
    // `manifest_items` mirrors exactly the parts written below; the spine
    // holds only these documents (nav + title page are manifest-only so an
    // all-hidden document can keep an empty spine, S-016).
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

    // S-001: `mimetype` must be the FIRST entry, stored uncompressed — a
    // deflated or misplaced mimetype makes an EPUB unopenable to readers that
    // sniff the format before parsing the archive.
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

/// The heading a section renders, or empty when it renders none. Chapters get
/// the derived `Chapter N: title` (or bare `Chapter N` — never a trailing
/// colon — when the title is blank; S-007/S-008). `Section`-type sections
/// render their title with no number; a blank-titled section gets no heading,
/// matching `export_text`/`export_docx`.
///
/// The caller filters hidden sections out and only calls this for visible
/// ones, so the counter advances exactly once per visible chapter (S-012).
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

/// One inline run: the text XML-escaped (S-010), wrapped in `<u>`, `<em>` and
/// `<strong>` when the run is underlined, italic and/or bold (S-009).
/// Combined styles nest — strong outermost, then em, then u. `font_size` is
/// deliberately unmapped: an ebook reflows, so no fixed point sizes are
/// carried.
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

/// The body of one section document: the heading (when one renders) and one
/// `<p>` per paragraph, the paragraph's runs concatenated in order so the text
/// is preserved verbatim (S-006). An empty paragraph still emits an empty
/// `<p>` so the paragraph breaks the author inserted survive the round trip.
/// A paragraph with a first-line indent carries it inline as
/// `style="text-indent: …px"` (inches at the 96 px/in reference resolution);
/// a paragraph without one keeps the bare `<p>`.
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

/// Scale an indent from inches to whole CSS pixels at the 96 px/in reference
/// resolution EPUB readers assume: a half-inch indent becomes `48px`.
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
    // Every wrapped document — sections, nav, titlepage — loads the same
    // shared stylesheet; it is the package's source of `pre-wrap` (tab
    // preservation).
    out.push_str("<head><title>");
    out.push_str(&xml_escape(head_title));
    out.push_str("</title><link rel=\"stylesheet\" type=\"text/css\" href=\"style.css\"/></head>\n");
    out.push_str("<body>\n");
    out.push_str(body);
    out.push_str("</body>\n</html>\n");
    out
}

/// The OPF package document (S-002 rootfile; S-003 version + manifest): EPUB 3
/// metadata (`dc:title`/`dc:creator` with the blank-fallbacks already applied
/// by the caller, a `dc:identifier`, language `en`), a manifest item for every
/// XHTML part the package carries plus the shared stylesheet, and a spine of
/// the section documents in document order. The title page, nav.xhtml and the
/// stylesheet have no spine itemref on purpose (S-016, decision 7).
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
    // The shared stylesheet every XHTML document links (see `xhtml_document`).
    // Manifest-only, like the title page and nav: it is not reading content,
    // so it belongs to no spine position.
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
/// metadata and the visible-section ids, rendered as an urn. Deterministic on
/// purpose — a random UUID or a wall-clock stamp would make two renders of the
/// same document differ, which the command test forbids. EPUB 3 asks the
/// unique identifier to be an absolute IRI; a content urn qualifies.
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

/// Export the live document to `path` as an `.epub`. Locks the document the
/// way the other export commands do (a single short-lived `Mutex` guard),
/// renders via [`document_to_epub`], then writes through
/// `history::atomic_write` — a `.tmp` sibling plus rename — so a failure never
/// leaves a partial package at `path` (S-017) and a missing target directory
/// surfaces as a non-empty `Err` (S-018). Read-only: does not mark the
/// document modified or touch its history.
#[tauri::command]
pub fn export_epub(path: String, state: State<AppState>) -> Result<(), String> {
    let doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let bytes = document_to_epub(&doc);
    atomic_write(Path::new(&path), &bytes).map_err(|e| e.to_string())
}