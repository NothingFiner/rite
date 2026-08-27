// Flat↔nested translation between the section-based document model and the
// editor's flat-DOM block sequence.
//
// The model is nested: Document.sections[].paragraphs[]. The editor's
// contenteditable is a FLAT list of sibling elements (every editing mechanism —
// DOM-sync, page-break layout, search-highlight mapping, caret handling —
// assumes paragraphs are direct children of the sheet). So at render time we
// flatten sections into a block list (section-title block, then its paragraph
// blocks, repeat), and at sync time we group the flat DOM blocks back into
// sections. A `.section-title` is a non-paragraph structural sibling, exactly
// like epigram-block / page-break-line already are.
//
// Chapter numbers are render-derived: a Chapter's number is its 1-based index
// among Chapter-type sections, computed during the flatten walk. It is never
// stored, so inserting/deleting a chapter renumbers all chapters with zero
// delta churn (the number is not data).

import { generateSectionId } from '../constants/DocumentModel.js'
import { isEmptyParagraph } from '../constants/ParagraphStyle.js'

/// A block is one row in the flat editor sequence.
///   kind: 'section-title' | 'paragraph'
///   sectionId: the owning section's id (stable)
///   paragraphId: only for 'paragraph' blocks
///   sectionType / title / chapterIndex: only for 'section-title' blocks
///   paragraph: the Paragraph model (only for 'paragraph' blocks)
export function flattenSections(sections) {
  const blocks = []
  let chapterIndex = 0
  for (const section of sections) {
    const isChapter = section.sectionType === 'chapter'
    const displayChapterIndex = isChapter ? ++chapterIndex : null
    blocks.push({
      kind: 'section-title',
      sectionId: section.id,
      sectionType: section.sectionType,
      title: section.title,
      chapterIndex: displayChapterIndex,
    })
    for (const paragraph of section.paragraphs) {
      blocks.push({
        kind: 'paragraph',
        sectionId: section.id,
        paragraphId: paragraph.id,
        paragraph,
      })
    }
  }
  return blocks
}

/// Inverse of flattenSections: walk a flat block list and rebuild sections. A
/// `section-title` block starts a new section; following `paragraph` blocks
/// append to it. Paragraph blocks that appear before any section-title (should
/// not happen in normal flow, but the DOM can be odd) are gathered into a
/// synthetic leading section.
export function groupBlocks(blocks) {
  const sections = []
  let current = null
  for (const block of blocks) {
    if (block.kind === 'section-title') {
      if (current) sections.push(current)
      current = {
        id: block.sectionId,
        title: block.title,
        sectionType: block.sectionType,
        paragraphs: [],
      }
    } else if (block.kind === 'paragraph') {
      if (!current) {
        current = { id: generateSectionId(), title: '', sectionType: 'section', paragraphs: [] }
      }
      current.paragraphs.push(block.paragraph)
    }
  }
  if (current) sections.push(current)
  return sections
}

/// Section-aware first-line indent for the paragraph block at `index` in a flat
/// block list: 0 for the first paragraph of a section (preceded by a
/// section-title) or right after an empty paragraph (scene break / spacer),
/// 0.5 otherwise. Headings are gone, so there is no heading special-case; page
/// breaks no longer influence indent — section-first + after-empty fully
/// determines it. Shared by the editor (render + sync) and the manuscript so
/// both views apply the identical rule.
export function computeFirstLineIndent(blocks, index) {
  const prev = blocks[index - 1]
  if (!prev) return 0
  if (prev.kind === 'section-title') return 0
  if (prev.kind === 'paragraph' && isEmptyParagraph(prev.paragraph)) return 0
  return 0.5
}