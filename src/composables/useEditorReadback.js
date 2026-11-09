// Readback: the live contenteditable DOM back into the model, the reverse of
// rendering. The DOM is the source of truth while the writer types.
//
// Pure helpers take their dependencies as arguments; the factory binds them to
// the refs editorDisplay owns, which keeps ownership of the shared state.

import { getSectionIdAtCursor } from './useEditorCursor.js'
import { groupBlocks, computeFirstLineIndent } from './useSectionBlocks.js'
import { generateParagraphId, generateSectionId, createParagraph, defaultTextStyle } from '../constants/DocumentModel.js'

// The renderer writes inches as value × 96; the readback divides by the same
// number, so the two stay exact inverses.
export const PX_PER_INCH = 96

/// The decorations interleaved with real blocks (page-break <hr>, page-number
/// label, click sentinel), skipped so they never become model blocks.
export function isNonContentBlock(el) {
  return el.classList?.contains('page-break-line') ||
    el.classList?.contains('page-number-label') ||
    el.classList?.contains('editor-sentinel')
}

/// Read one `.paragraph` div into a Paragraph model. A run whose computed size
/// is neither the 16px default nor `zoomPx` stores an explicit size; the
/// `getComputedStyle` calls are the per-run cost the localized sync avoids.
///
/// The first-line indent is automatic (`null`) or explicit (a number). The
/// writer's 0 and the automatic rule's 0 both render as `.no-indent`, so the
/// marker decides: `data-auto-indent="true"` means the renderer derived it and
/// the model keeps `null`; otherwise `.no-indent` is explicit 0 and any other
/// value is the inline `text-indent`, in px. Read the inline attribute, not the
/// computed style, which echoes the renderer and would make every paragraph look
/// explicit. No marker, no class and no inline indent means the browser made the
/// paragraph, so it stays automatic.
export function parseParagraphElement(paragraphEl, zoomPx) {
  const style = window.getComputedStyle(paragraphEl)
  const leftIndentPx = parseInt(style.marginLeft, 10) || 0
  const rightIndentPx = parseInt(style.marginRight, 10) || 0
  const elements = []
  for (const run of paragraphEl.childNodes) {
    if (run.nodeType === Node.TEXT_NODE) {
      if (run.textContent) {
        elements.push({ textRun: { content: run.textContent, textStyle: defaultTextStyle() } })
      }
    } else if (run.nodeType === Node.ELEMENT_NODE) {
      if (run.classList?.contains('search-highlight') || run.classList?.contains('search-current')) {
        elements.push({ textRun: { content: run.textContent || '', textStyle: defaultTextStyle() } })
        continue
      }
      const runStyle = window.getComputedStyle(run)
      const textStyle = defaultTextStyle({
        bold: runStyle.fontWeight === '700' || runStyle.fontWeight === 'bold',
        italic: runStyle.fontStyle === 'italic',
        underline: runStyle.textDecorationLine.includes('underline'),
      })
      const fontSizePx = parseInt(runStyle.fontSize, 10)
      if (fontSizePx && fontSizePx !== 16 && fontSizePx !== zoomPx) textStyle.fontSize = fontSizePx
      elements.push({ textRun: { content: run.innerText || '', textStyle } })
    }
  }
  if (elements.length === 0) {
    elements.push({ textRun: { content: '', textStyle: defaultTextStyle() } })
  }
  let firstLineIndent = null
  if (paragraphEl.dataset.autoIndent !== 'true') {
    if (paragraphEl.classList.contains('no-indent')) {
      firstLineIndent = 0
    } else {
      const inlineIndentCss = paragraphEl.style.textIndent
      const indentPx = inlineIndentCss.endsWith('px') ? parseFloat(inlineIndentCss) : NaN
      // Inline indent is px; the model stores inches at 2 decimals.
      if (!Number.isNaN(indentPx)) firstLineIndent = Math.round(indentPx / PX_PER_INCH * 100) / 100
    }
  }
  // The browser can create a paragraph with no `data-para-id` (paste, IME, an
  // Enter edge case). Write one back: the reconciler, search highlighting and the
  // Rust UpdateParagraph delta all key on the DOM id matching the model id.
  const id = paragraphEl.dataset.paraId || generateParagraphId()
  paragraphEl.dataset.paraId = id
  return {
    id,
    leftIndent: leftIndentPx > 0 ? Math.round(leftIndentPx / PX_PER_INCH * 10) / 10 : null,
    rightIndent: rightIndentPx > 0 ? Math.round(rightIndentPx / PX_PER_INCH * 10) / 10 : null,
    firstLineIndent, // null = automatic, number = explicit (SPEC.md 5.18)
    elements,
  }
}

/// A section title's editable text: the subtitle span for a Chapter (the prefix
/// is derived, never read), the title span for a Section. Nbsp → space, trimmed.
export function readSectionTitleText(el) {
  const sectionType = el.dataset.sectionType
  const span = sectionType === 'chapter'
    ? el.querySelector('.section-subtitle')
    : el.querySelector('.section-title-text')
  const text = span ? (span.textContent || '') : ''
  return text.replace(/ /g, ' ').trim()
}

/// Walk the editor's flat sibling list into the block shape `groupBlocks` reads,
/// skipping decorations. `zoomPx` threads through to `parseParagraphElement`.
export function domToBlocks(root, zoomPx) {
  const blocks = []
  for (const blockEl of Array.from(root.children)) {
    if (isNonContentBlock(blockEl)) continue

    if (blockEl.classList?.contains('section-title')) {
      blocks.push({
        kind: 'section-title',
        sectionId: blockEl.dataset.sectionId || generateSectionId(),
        sectionType: blockEl.dataset.sectionType || 'section',
        title: readSectionTitleText(blockEl),
        hidden: blockEl.dataset.sectionHidden === 'true',
      })
    } else if (blockEl.classList?.contains('paragraph')) {
      blocks.push({
        kind: 'paragraph',
        sectionId: blockEl.dataset.sectionId,
        paragraphId: blockEl.dataset.paraId,
        paragraph: parseParagraphElement(blockEl, zoomPx),
      })
    }
  }
  return blocks
}

/// Stamp the render-derived `chapterIndex` onto each section-title block (1-based
/// among chapters, null otherwise). `flattenSections` does this for model blocks,
/// `domToBlocks` does not. Without it every chapter title would diff as changed
/// after an edit. Idempotent; mutates in place.
export function bakeChapterIndices(blocks) {
  let chapterIndex = 0
  for (const block of blocks) {
    if (block.kind === 'section-title') {
      block.chapterIndex = block.sectionType === 'chapter' ? ++chapterIndex : null
    }
  }
}

/// The visible text of an editable block: the string `bookmarkSelection` measures
/// offsets against, and the basis for shifting a caret when the text changes.
export function blockPlainText(block) {
  if (block.kind === 'section-title') return block.title || ''
  return (block.paragraph?.elements || []).map(e => e.textRun?.content || '').join('')
}

/// Map a caret offset in `oldText` to `newText`, assuming one replaced middle
/// region flanked by a common prefix and suffix. A caret in the prefix stays put,
/// one in the suffix shifts by the length change, and one inside the replaced
/// region lands at its start.
export function adjustOffsetForReplace(oldText, newText, offset) {
  if (oldText === newText) return offset
  const oldLen = oldText.length
  const newLen = newText.length
  if (offset <= 0) return 0
  let prefix = 0
  while (prefix < oldLen && prefix < newLen && oldText[prefix] === newText[prefix]) prefix++
  if (offset <= prefix) return offset
  let suffix = 0
  while (
    suffix < oldLen - prefix && suffix < newLen - prefix &&
    oldText[oldLen - 1 - suffix] === newText[newLen - 1 - suffix]
  ) suffix++
  const oldChangeEnd = oldLen - suffix
  const newChangeEnd = newLen - suffix
  if (offset >= oldChangeEnd) return offset - oldChangeEnd + newChangeEnd
  return prefix
}

/// Render the resolved indent into each live paragraph and mark automatic ones,
/// or browser-made paragraphs (Enter, paste) render flush until the next full
/// render and the next readback freezes the computed number as explicit.
function stampResolvedIndents(blocks, domParagraphs) {
  let paragraphIndex = 0
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    if (blocks[blockIndex].kind !== 'paragraph') continue
    const paragraphEl = domParagraphs[paragraphIndex]
    paragraphIndex++
    if (!paragraphEl) continue
    const parsedIndent = blocks[blockIndex].paragraph.firstLineIndent
    if (parsedIndent === null) paragraphEl.dataset.autoIndent = 'true'
    const resolvedIndent = typeof parsedIndent === 'number'
      ? parsedIndent
      : computeFirstLineIndent(blocks, blockIndex)
    paragraphEl.style.textIndent = resolvedIndent > 0
      ? `${Math.round(resolvedIndent * PX_PER_INCH)}px`
      : '0px'
  }
}

/// The blocks the reconciler compares against: automatic paragraphs as display
/// copies (computed number plus `autoIndent`), so their HTML matches what
/// `buildEditorHTML` produced. Explicit ones pass through unchanged.
function toDisplayBlocks(blocks) {
  return blocks.map((block, blockIndex) => {
    if (block.kind !== 'paragraph') return block
    if (typeof block.paragraph.firstLineIndent === 'number') return block
    return {
      ...block,
      paragraph: {
        ...block.paragraph,
        firstLineIndent: computeFirstLineIndent(blocks, blockIndex),
        autoIndent: true,
      },
    }
  })
}

/// Bind the readback entry points to the state editorDisplay owns. Names match
/// its refs; `emit` forwards the rebuilt sections to the parent.
export function useEditorReadback({ sheetRef, modelRef, zoomRef, lastRenderedBlocks, lastSectionCount, skipNextWatcher, emit }) {
  /// Read the whole sheet and emit all sections. The fallback for `syncFromDOM`
  /// when an edit cannot be confined to one section, and the first paint.
  function fullSyncFromDOM() {
    const root = sheetRef.value
    if (!root || !modelRef.value) return
    const blocks = domToBlocks(root, zoomRef.value)
    bakeChapterIndices(blocks)

    const liveParagraphs = Array.from(root.querySelectorAll('.paragraph'))
    stampResolvedIndents(blocks, liveParagraphs)

    const sections = groupBlocks(blocks)
    // Defensive: every section must have at least one paragraph to type into.
    for (const section of sections) {
      if (!section.paragraphs || section.paragraphs.length === 0) section.paragraphs.push(createParagraph())
    }

    lastRenderedBlocks.value = toDisplayBlocks(blocks)
    lastSectionCount.value = blocks.filter(block => block.kind === 'section-title').length

    skipNextWatcher.value = true
    emit('syncSections', sections)
  }

  /// Read back only the cursor's section and emit it. Edits are confined to one
  /// section (cross-section delete is blocked), and the full readback costs a
  /// `getComputedStyle` per paragraph and per run — the typing lag at 51k words.
  /// Falls back to `fullSyncFromDOM` when it cannot localize.
  function syncFromDOM() {
    const root = sheetRef.value
    if (!root || !modelRef.value) return

    const sectionId = getSectionIdAtCursor()
    const titleEls = root.querySelectorAll('.section-title')
    // A different title count means an edit crossed a section boundary, and a
    // localized read would miss the other side.
    if (!sectionId || !lastRenderedBlocks.value || titleEls.length !== lastSectionCount.value) {
      fullSyncFromDOM()
      return
    }

    let titleEl = null
    for (const el of titleEls) {
      if (el.dataset.sectionId === sectionId) { titleEl = el; break }
    }
    if (!titleEl) { fullSyncFromDOM(); return }
    // Positional, not by `data-section-id`: the paragraph Enter creates may not
    // carry the attribute, and an attribute query would silently drop it.
    const paraEls = []
    let sibling = titleEl.nextElementSibling
    while (sibling && sibling.classList.contains('paragraph')) {
      paraEls.push(sibling)
      sibling = sibling.nextElementSibling
    }

    const titleBlock = {
      kind: 'section-title',
      sectionId,
      sectionType: titleEl.dataset.sectionType || 'section',
      title: readSectionTitleText(titleEl),
      hidden: titleEl.dataset.sectionHidden === 'true',
    }
    // Keep the baseline's chapterIndex; re-baking it would need a walk of the
    // whole document.
    const prevTitle = lastRenderedBlocks.value.find(
      block => block.kind === 'section-title' && block.sectionId === sectionId
    )
    if (!prevTitle) { fullSyncFromDOM(); return }
    titleBlock.chapterIndex = prevTitle.chapterIndex

    const blocks = [titleBlock]
    for (const el of paraEls) {
      blocks.push({
        kind: 'paragraph',
        sectionId,
        paragraphId: el.dataset.paraId,
        paragraph: parseParagraphElement(el, zoomRef.value),
      })
    }

    // `computeFirstLineIndent` reads the list each block sits in, and this list
    // starts at the section title, so the section's indents stay self-contained.
    stampResolvedIndents(blocks, paraEls)

    const sections = groupBlocks(blocks)
    const section = sections[0]
    if (!section) { fullSyncFromDOM(); return }
    if (!section.paragraphs || section.paragraphs.length === 0) section.paragraphs.push(createParagraph())

    // Replace this section in the baseline in place. The title count is unchanged,
    // so `lastSectionCount` needs no recompute.
    const baseline = lastRenderedBlocks.value
    const startIdx = baseline.findIndex(
      block => block.kind === 'section-title' && block.sectionId === sectionId
    )
    if (startIdx === -1) { fullSyncFromDOM(); return }
    let endIdx = startIdx + 1
    while (endIdx < baseline.length && baseline[endIdx].kind !== 'section-title') endIdx++
    const baselineBlocks = baseline.slice(0, startIdx).concat(
      toDisplayBlocks(blocks),
      baseline.slice(endIdx)
    )
    lastRenderedBlocks.value = baselineBlocks

    // No `skipNextWatcher` here, unlike `fullSyncFromDOM`: this path mutates one
    // section in place, so the sections array keeps its identity and the
    // editor's (shallow) watcher never fires. Arming the flag would leave it set
    // for the NEXT external change — a menu undo, say — which would then be
    // skipped, and the sheet would show the pre-undo text.
    emit('syncSection', { id: section.id, title: section.title, sectionType: section.sectionType, hidden: section.hidden, paragraphs: section.paragraphs })
  }

  return { syncFromDOM, fullSyncFromDOM }
}