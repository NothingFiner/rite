//! Plain-text and Markdown export of the live document.
//!
//! A read-only walk over the section-based `Document`: sections → paragraphs →
//! text runs, concatenating `text_run.content`. The Tauri command wrapper
//! threads in `AppState`; the pure `document_to_text` is exercised directly by
//! the tests below. Output is written via `history::atomic_write` so a crash
//! mid-export cannot leave a half-written file on disk.

use crate::document::{Document, SectionType};
use crate::history::atomic_write;
use crate::state::AppState;
use std::path::Path;
use tauri::State;

/// Which output format to produce. Serialized as `camelCase` so the frontend
/// passes `{ format: 'plainText' | 'markdown' }` and serde matches these
/// variants exactly.
#[derive(serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    PlainText,
    Markdown,
}

/// Render `doc` as a plain-text or Markdown string. Pure over the document —
/// no I/O, no state — so the tests can call it directly.
///
/// Headers:
/// - Markdown `Chapter` → `## Chapter {n}: {title}` (n = count of chapters
///   encountered so far, so chapter numbering is render-derived, matching the
///   editor's derived-number convention).
/// - Markdown `Section` → `## {title}`.
/// - PlainText emits the same headers without the `## ` prefix.
///
/// Empty titles are handled gracefully: a chapter still gets its number
/// (`Chapter 1`, no trailing colon), and a section with no title omits the
/// header line entirely (no empty heading). Body paragraphs are rendered as
/// plain text (run contents concatenated) with a blank line between blocks.
pub fn document_to_text(doc: &Document, format: ExportFormat) -> String {
    let mut out = String::new();
    let mut chapter_count = 0u32;

    // Front matter (title / author / epigram) leads the document in Markdown
    // only — the `# title` is Markdown, and the plan scopes front matter to the
    // Markdown export. Plain text keeps the bare section walk. See
    // `document_front_matter` for the per-piece rules.
    out.push_str(&document_front_matter(doc, format));

    for section in &doc.sections {
        // Header line per chapter/section.
        let header = section_header(section, format, &mut chapter_count);
        if let Some(header) = header {
            out.push_str(&header);
            out.push('\n');
            out.push('\n');
        }

        // Body paragraphs: concatenate text-run contents, blank line between
        // blocks (a paragraph is a block). An empty paragraph still produces a
        // blank line so paragraph breaks the author inserted are preserved.
        for paragraph in &section.paragraphs {
            let text: String = paragraph
                .elements
                .iter()
                .map(|element| element.text_run.content.as_str())
                .collect();
            out.push_str(&text);
            out.push('\n');
            out.push('\n');
        }
    }

    out
}

/// Build the header line for a section in the given format, or `None` to skip
/// the header (a section with an empty title). Advances `chapter_count` for
/// each `Chapter` encountered, regardless of format.
fn section_header(
    section: &crate::document::Section,
    format: ExportFormat,
    chapter_count: &mut u32,
) -> Option<String> {
    let title = section.title.trim();
    // A hidden section renders NO header line, but its body still exports.
    // A hidden CHAPTER still advances the counter — chapter numbers are
    // render-derived positionally (same as the editor), so hiding one must
    // not renumber the chapters after it.
    if section.hidden {
        if section.section_type == SectionType::Chapter {
            *chapter_count += 1;
        }
        return None;
    }
    match format {
        ExportFormat::Markdown => match section.section_type {
            SectionType::Chapter => {
                *chapter_count += 1;
                let n = *chapter_count;
                if title.is_empty() {
                    Some(format!("## Chapter {}", n))
                } else {
                    Some(format!("## Chapter {}: {}", n, title))
                }
            }
            SectionType::Section => {
                if title.is_empty() {
                    None
                } else {
                    Some(format!("## {}", title))
                }
            }
        },
        ExportFormat::PlainText => match section.section_type {
            SectionType::Chapter => {
                *chapter_count += 1;
                let n = *chapter_count;
                if title.is_empty() {
                    Some(format!("Chapter {}", n))
                } else {
                    Some(format!("Chapter {}: {}", n, title))
                }
            }
            SectionType::Section => {
                if title.is_empty() {
                    None
                } else {
                    Some(title.to_string())
                }
            }
        },
    }
}

/// Build the front matter (title / byline / epigram) that leads the document,
/// or an empty string when there is none to emit.
///
/// Markdown only: the title becomes a level-1 heading (`# title`) and the
/// author a byline (`*by author*`). The epigram, when the document has one
/// (`has_epigram` and a non-empty `epigram_text`), becomes a Markdown
/// blockquote — each line prefixed with `> ` — mirroring how the manuscript
/// renders an epigram page. Plain text returns empty: the plan scopes front
/// matter to the Markdown export, and a plain-text blockquote would just be a
/// literal `>` with no reader recognizing it.
///
/// Empty pieces are skipped (no empty heading, no blank byline), so a document
/// with only a title emits just `# title` followed by its sections.
fn document_front_matter(doc: &Document, format: ExportFormat) -> String {
    if format != ExportFormat::Markdown {
        return String::new();
    }
    let mut out = String::new();

    let title = doc.title.trim();
    if !title.is_empty() {
        out.push_str(&format!("# {}\n\n", title));
    }
    let author = doc.author.trim();
    if !author.is_empty() {
        out.push_str(&format!("*by {}*\n\n", author));
    }
    if doc.has_epigram {
        let epigram = doc.epigram_text.trim();
        if !epigram.is_empty() {
            // Markdown blockquote: prefix every line with `> `. Using `.lines()`
            // (not `.split('\n')`) collapses a trailing newline so we don't emit
            // a bare `> ` line for the final newline.
            for line in epigram.lines() {
                out.push_str("> ");
                out.push_str(line);
                out.push('\n');
            }
            // A blank line separates the blockquote from the first section.
            out.push('\n');
        }
    }

    out
}

/// Export the live document to `path` in the requested format. Locks the
/// document the way the other commands do (a single short-lived `Mutex` guard),
/// renders via `document_to_text`, then writes via `atomic_write` so a crash
/// mid-write cannot leave a partial file. Read-only: does not mark the
/// document modified or touch its history.
#[tauri::command]
pub fn export_text(
    path: String,
    format: ExportFormat,
    state: State<AppState>,
) -> Result<(), String> {
    let doc = state.document.lock().map_err(|e| e.to_string())?.clone();
    let text = document_to_text(&doc, format);
    atomic_write(Path::new(&path), &text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Element, Paragraph, Section, TextRun, TextStyle};

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

    /// The small doc the export tests walk: one chapter (with a paragraph) +
    /// one section (with a paragraph).
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

    #[test]
    fn markdown_renders_chapter_and_section_headers_with_body() {
        let doc = sample_document();
        let rendered = document_to_text(&doc, ExportFormat::Markdown);

        // The document front matter (`# title`, `*by author*`) leads, then the
        // chapter header is derived-numbered (`## Chapter 1: {title}`); the
        // section header is verbatim (`## {title}`). Body paragraphs follow as
        // plain text, with blank lines between blocks.
        let expected = "# T\n\n\
*by A*\n\n\
## Chapter 1: The Arrival\n\n\
It was a dark and stormy night.\n\n\
## Notes\n\n\
A section for stray thoughts.\n\n";
        assert_eq!(rendered, expected);
    }

    #[test]
    fn plain_text_renders_headers_without_markdown_prefix() {
        let doc = sample_document();
        let rendered = document_to_text(&doc, ExportFormat::PlainText);

        // Same structure as Markdown but no `## ` prefix: `Chapter {n}: {title}`
        // for chapters, the bare title for sections.
        let expected = "Chapter 1: The Arrival\n\n\
It was a dark and stormy night.\n\n\
Notes\n\n\
A section for stray thoughts.\n\n";
        assert_eq!(rendered, expected);
    }

    #[test]
    fn hidden_section_omits_header_but_renders_body() {
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

        // Markdown: front matter leads, then the epigram's body text with NO
        // `## Epigram` header line. Same for plain text.
        let rendered = document_to_text(&doc, ExportFormat::Markdown);
        assert!(rendered.contains("Only connect."));
        assert!(!rendered.contains("Epigram"));

        let rendered = document_to_text(&doc, ExportFormat::PlainText);
        assert!(rendered.contains("Only connect."));
        assert!(!rendered.contains("Epigram"));
    }

    #[test]
    fn hidden_chapter_still_advances_numbering() {
        // Chapter numbers are render-derived positionally; hiding one must
        // not renumber the chapters after it.
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

        let rendered = document_to_text(&doc, ExportFormat::Markdown);
        assert!(rendered.contains("## Chapter 2: The Arrival"));
        assert!(!rendered.contains("Cut"));
    }

    #[test]
    fn chapter_number_increments_across_chapters_only() {
        // Two chapters with a section sandwiched between: the section must not
        // advance the chapter counter, so the second chapter is `Chapter 2`.
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
        let rendered = document_to_text(&doc, ExportFormat::Markdown);
        assert!(rendered.contains("## Chapter 1: First"));
        assert!(rendered.contains("## Interlude"));
        assert!(rendered.contains("## Chapter 2: Second"));
        // No spurious Chapter 3.
        assert!(!rendered.contains("Chapter 3"));
    }

    #[test]
    fn empty_titles_are_handled_gracefully() {
        // A chapter with an empty title still emits its derived number (no
        // trailing colon); a section with an empty title omits its header line
        // entirely, so no empty heading appears in the output.
        let doc = Document {
            title: "T".to_string(),
            author: "A".to_string(),
            author_contact: "C".to_string(),
            has_toc: false,
            has_epigram: false,
            epigram_text: String::new(),
            sections: vec![
                create_section("s1", "  ", SectionType::Chapter, vec![create_paragraph("p1", "body one")]),
                create_section("s2", "", SectionType::Section, vec![create_paragraph("p2", "body two")]),
            ],
        };
        let rendered = document_to_text(&doc, ExportFormat::Markdown);

        // Chapter 1 with no title -> `## Chapter 1` (whitespace title trimmed,
        // no trailing colon). Body still renders.
        assert!(rendered.contains("## Chapter 1\n"));
        // Section with empty title -> no header line, just its body.
        assert!(!rendered.contains("## \n"));
        assert!(rendered.contains("body one"));
        assert!(rendered.contains("body two"));
    }

    #[test]
    fn multiple_paragraphs_separated_by_blank_lines() {
        let doc = Document {
            title: "T".to_string(),
            author: "A".to_string(),
            author_contact: "C".to_string(),
            has_toc: false,
            has_epigram: false,
            epigram_text: String::new(),
            sections: vec![create_section(
                "s1",
                "One",
                SectionType::Section,
                vec![
                    create_paragraph("p1", "first paragraph"),
                    create_paragraph("p2", "second paragraph"),
                ],
            )],
        };
        let rendered = document_to_text(&doc, ExportFormat::Markdown);

        // The two body paragraphs are separated by a blank line (a paragraph
        // is a block), with a blank line before the header and after the last
        // paragraph. This matches the "blank line between blocks" spec. (The
        // `# T` / `*by A*` front matter leads, as in every Markdown export.)
        let expected = "# T\n\n*by A*\n\n## One\n\nfirst paragraph\n\nsecond paragraph\n\n";
        assert_eq!(rendered, expected);
    }

    /// A doc with a title, author, and epigram, for the front-matter tests.
    fn front_matter_document(epigram: &str) -> Document {
        Document {
            title: "The Glass Hotel".to_string(),
            author: "Amal El-Mohtar".to_string(),
            author_contact: String::new(),
            has_toc: false,
            has_epigram: !epigram.is_empty(),
            epigram_text: epigram.to_string(),
            sections: vec![create_section(
                "s1",
                "Chapter One",
                SectionType::Chapter,
                vec![create_paragraph("p1", "Body of the first chapter.")],
            )],
        }
    }

    #[test]
    fn markdown_prepends_title_byline_and_epigram_blockquote() {
        let doc = front_matter_document("Lines written on\nthe back of a receipt");
        let rendered = document_to_text(&doc, ExportFormat::Markdown);

        // Title -> H1, author -> byline, epigram -> blockquote (each line
        // prefixed `> `), then the first section's heading and body.
        let expected = "# The Glass Hotel\n\n\
*by Amal El-Mohtar*\n\n\
> Lines written on\n\
> the back of a receipt\n\
\n\
## Chapter 1: Chapter One\n\n\
Body of the first chapter.\n\n";
        assert_eq!(rendered, expected);
    }

    #[test]
    fn markdown_omits_front_matter_pieces_that_are_empty() {
        // No title, no author, no epigram -> nothing is prepended; the output
        // starts at the first section. (has_epigram is false here.)
        let doc = Document {
            title: String::new(),
            author: String::new(),
            author_contact: String::new(),
            has_toc: false,
            has_epigram: false,
            epigram_text: String::new(),
            sections: vec![create_section(
                "s1",
                "One",
                SectionType::Section,
                vec![create_paragraph("p1", "body")],
            )],
        };
        let rendered = document_to_text(&doc, ExportFormat::Markdown);
        // No empty heading, no empty byline, no blockquote.
        assert!(!rendered.contains("# \n"));
        assert!(!rendered.contains("*by"));
        assert!(!rendered.contains("> "));
        assert!(rendered.starts_with("## One\n\n"));
    }

    #[test]
    fn markdown_skips_epigram_blockquote_when_flag_set_but_text_empty() {
        // has_epigram is true but the text is whitespace: emit no blockquote
        // rather than a bare `> ` line. Title/byline still render.
        let doc = front_matter_document("   \n  ");
        let rendered = document_to_text(&doc, ExportFormat::Markdown);
        assert!(rendered.contains("# The Glass Hotel\n\n*by Amal El-Mohtar*\n\n"));
        assert!(!rendered.contains("> "));
    }

    #[test]
    fn plain_text_has_no_front_matter() {
        // Front matter is Markdown-only: the plain-text export starts straight
        // at the first section header, with no `# title` or byline.
        let doc = front_matter_document("an epigram");
        let rendered = document_to_text(&doc, ExportFormat::PlainText);
        assert!(rendered.starts_with("Chapter 1: Chapter One\n\n"));
        assert!(!rendered.contains("# The Glass Hotel"));
        assert!(!rendered.contains("*by"));
        assert!(!rendered.contains("> "));
    }
}