// Paragraph-level helpers. Headings are no longer a paragraph concept — a
// heading is a Section.title now — so the old ParagraphStyle enum, isHeading,
// and getHeadingLevel are gone. What remains is paragraph-content logic that
// does not depend on style.

export function isEmptyParagraph(p) {
  if (!p || !p.elements) return true
  const text = p.elements.map((el) => el.textRun.content).join('')
  return !text.trim()
}

/// Whether the paragraph at `index` should get a first-line indent. With
/// headings gone, the only "do not indent" rule is "this is the first paragraph
/// in its run" (index 0, or right after an empty paragraph that acts as a scene
/// break / spacer). The editor additionally forces no indent on the first
/// paragraph *of a section*; that section-aware rule lives in the editor, not
/// here, because it needs the section grouping this helper does not see.
export function shouldHaveFirstLineIndent(paragraphs, index) {
  if (index === 0) return false
  const prev = paragraphs[index - 1]
  if (!prev) return false
  if (isEmptyParagraph(prev)) return false
  return true
}