// Editor full-sheet HTML build, extracted from editorDisplay.vue (roadmap 5.6,
// PR4). Pure — no Vue, no reactivity, no DOM. `buildEditorHTML` is the whole-
// sheet render `renderEditor` used to inline: it flattens the doc's sections
// into the flat block list the contenteditable renders, bakes the section-aware
// first-line indents (shallow-copying paragraph blocks so the store's reactive
// paragraphs are NOT mutated), renders each block to HTML, and prepends the
// epigram block when present. It returns the HTML string PLUS the baked block
// list + section count, so the orchestrator can record them as the retained
// baseline the reconciler diffs against on the next external change.
//
// The single-block renderer `renderBlockHTML` lives in useEditorReconcile.js
// (it's the `renderBlockFn` computeReconcileOps injects); the two share the
// same sectionTitleToHTML / paragraphToHTML calls and the same `chapterIndex`
// source, so a block rendered here and the same block rendered there produce
// byte-identical HTML — the invariant that lets the reconciler decide `keep`
// vs `replace` by a single string compare.
//
// `formatChapter` is injected (the orchestrator passes `sectionFormat.format
// Chapter`) so this module stays Vue-free and unit-testable without the shared
// useSectionFormat prefs. `freshSectionId` marks a just-inserted section's title
// editable so the user can type its subtitle inline.

import { flattenSections, computeFirstLineIndent } from './useSectionBlocks.js'
import { paragraphToHTML, sectionTitleToHTML, escapeHtml } from './useParagraphHTML.js'

/// Build the editor's full `innerHTML` from the doc's sections, plus the baked
/// block list and section count the orchestrator retains as its diff baseline.
///
/// `sections` is `doc.sections` (or `[]`). The options bag:
///   - `freshSectionId`: id of a just-inserted section whose title renders
///     editable (so the user types the subtitle inline); null/undefined
///     otherwise.
///   - `formatChapter(index)`: renders the locked "Chapter N: " prefix for a
///     Chapter's render-derived index. Injected so this module is Vue-free.
///   - `hasEpigram` / `epigramText`: when both are truthy a non-content
///     `.epigram-block` div is prepended (not part of flattenSections, so it
///     never becomes a model block).
///
/// Returns `{ html, blocks, sectionCount }`. `blocks` is the baked flat list
/// (paragraph blocks shallow-copied + firstLineIndent baked; title blocks carry
/// the `chapterIndex` flattenSections stamps); `sectionCount` is the number of
/// section-title blocks. Paragraph blocks are shallow-copied so baking
/// `firstLineIndent` does not mutate the store's reactive paragraph objects.
export function buildEditorHTML(sections, { freshSectionId, formatChapter, hasEpigram, epigramText } = {}) {
  // Shallow-copy paragraph blocks so baking computed indents does not mutate
  // the store's reactive paragraphs.
  const blocks = flattenSections(sections || []).map(b => {
    if (b.kind === 'paragraph') return { ...b, paragraph: { ...b.paragraph } }
    return b
  })

  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind !== 'paragraph') continue
    blocks[i].paragraph.firstLineIndent = computeFirstLineIndent(blocks, i)
  }

  const html = blocks.map(b => {
    if (b.kind === 'section-title') {
      const idx = b.chapterIndex
      const chapterPrefix = idx != null ? (formatChapter ? formatChapter(idx) : '') : ''
      return sectionTitleToHTML(
        { id: b.sectionId, title: b.title, sectionType: b.sectionType },
        idx,
        chapterPrefix,
        { fresh: b.sectionId === freshSectionId }
      )
    }
    return paragraphToHTML(b.paragraph, { sectionId: b.sectionId })
  }).join('')

  let fullHtml = html
  if (hasEpigram && epigramText) {
    const epigramHtml = `<div class="epigram-block">${escapeHtml(epigramText).replace(/\n/g, '<br>')}</div>`
    fullHtml = epigramHtml + fullHtml
  }

  const sectionCount = blocks.filter(b => b.kind === 'section-title').length
  return { html: fullHtml, blocks, sectionCount }
}