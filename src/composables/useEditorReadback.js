// Editor DOM→model readback, extracted from editorDisplay.vue (roadmap 5.6,
// PR3). The pure helpers walk the contenteditable's flat block list back into
// the block/Section shape the store holds; the factory wraps the two readback
// entry points (syncFromDOM, fullSyncFromDOM) that also touch the reactive
// state editorDisplay owns. Extracting this bucket is what unblocks 5.8
// (per-paragraph spellcheck): the readback now lives in a testable module a
// spellcheck pass can hook into without tangling with the god component.
//
// Pure helpers take their dependencies as arguments (the editor root, the zoom
// value); the factory receives the reactive refs editorDisplay owns and reads
// `.value` from them, so the orchestrator keeps ownership of the shared state
// (sheetRef, the model, lastRenderedBlocks, lastSectionCount, skipNextWatcher).

import { getSectionIdAtCursor } from './useEditorCursor.js'
import { groupBlocks, computeFirstLineIndent } from './useSectionBlocks.js'
import { generateParagraphId, generateSectionId, createParagraph, defaultTextStyle } from '../constants/DocumentModel.js'

// The editor's CSS inch, in px. The renderer writes inches as value × 96 and
// the readback divides by the same number, so the two stay exact inverses.
const PX_PER_INCH = 96

/// True for the non-content decorations interleaved with the real blocks — the
/// page-break <hr>, page-number labels, and the click sentinel. domToBlocks
/// and the keydown walk skip these so they never become model blocks or nav
/// targets.
export function isNonContentBlock(el) {
  return el.classList?.contains('page-break-line') ||
    el.classList?.contains('page-number-label') ||
    el.classList?.contains('editor-sentinel')
}

/// Read one `.paragraph` div into a Paragraph model. `zoomPx` is the editor's
/// current font size: a run whose computed size differs from both the 16px
/// default and `zoomPx` carries an explicit size override; a run that only
/// tracks the zoom needs no stored size. These getComputedStyle calls are the
/// per-run cost the localized syncFromDOM exists to avoid.
///
/// Classify the first-line indent as automatic (`null`) or explicit (a number).
/// The writer and the automatic rule can both produce 0, and both render as
/// `.no-indent`, so the class alone says nothing about intent.
/// `data-auto-indent="true"` means the renderer derived the value: the model
/// keeps `null` and the next render recomputes it. Without the marker the
/// writer chose the value: `.no-indent` is an explicit 0, and any other explicit
/// value is the inline `text-indent`, in px. Read the inline attribute, not the
/// computed style, because the computed style echoes the renderer's own output
/// and would make every paragraph look explicit. An element with no marker, no
/// class and no inline indent came from the browser (paste or IME input):
/// nothing was set, so it stays automatic.
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
  // The writer and the automatic rule both produce a flush paragraph, so
  // `.no-indent` alone cannot distinguish explicit 0 from automatic 0. The
  // marker decides; see the contract above.
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
  // Resolve the paragraph id and write it back to the DOM when missing. The
  // browser can create a paragraph with no `data-para-id` (paste, IME input, an
  // Enter edge case the keydown handler misses). Without the write-back the
  // model and Rust get a fresh id while the DOM keeps none, and
  // `applySearchHighlights`, which locates matches by `[data-para-id]`, cannot
  // find the paragraph. The write-back keeps the invariant
  // DOM data-para-id === model paragraph id that the reconciler, the search
  // highlighter and the Rust UpdateParagraph delta all depend on.
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

/// The editable text of a section-title: the `.section-subtitle` span for a
/// Chapter (the prefix is derived, never read) or the `.section-title-text` span
/// for a Section. Nbsp is normalized to a plain space and trimmed.
export function readSectionTitleText(el) {
  const sectionType = el.dataset.sectionType
  const span = sectionType === 'chapter'
    ? el.querySelector('.section-subtitle')
    : el.querySelector('.section-title-text')
  const text = span ? (span.textContent || '') : ''
  return text.replace(/ /g, ' ').trim()
}

/// Walk the editor's flat sibling list (section-title markers interleaved with
/// paragraph divs) into the block shape groupBlocks understands. `zoomPx`
/// threads through to parseParagraphElement. Non-content decorations are
/// skipped.
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
/// running count of chapters; null for non-chapters). `flattenSections` already
/// does this for model-sourced blocks, but `domToBlocks` (the DOM readback path)
/// does not — so blocks built from the DOM must be baked here to match. The
/// reconciler renders a block via this index to reproduce the "Chapter N: "
/// prefix; without it, every chapter title would falsely diff as changed after
/// an edit. Idempotent: re-baking a flattenSections list yields the same values.
/// Mutates the blocks in place.
export function bakeChapterIndices(blocks) {
  let chapterIndex = 0
  for (const block of blocks) {
    if (block.kind === 'section-title') {
      block.chapterIndex = block.sectionType === 'chapter' ? ++chapterIndex : null
    }
  }
}

/// The visible text of an editable block — the same string the DOM renders and
/// `bookmarkSelection` measures offsets against. Paragraph runs are joined with
/// no separator (useParagraphHTML.js), and a title's editable unit is its
/// subtitle/title span, whose text is `block.title`. Used to shift a bookmarked
/// caret by the character delta when a block's text changes on undo/redo.
export function blockPlainText(block) {
  if (block.kind === 'section-title') return block.title || ''
  return (block.paragraph?.elements || []).map(e => e.textRun?.content || '').join('')
}

/// Map a caret offset measured in `oldText` to the corresponding offset in
/// `newText`. The two are assumed to differ by a single replaced middle region
/// (the common case for undo/redo of typing within one paragraph): a common
/// prefix and common suffix flank the change. A caret in the unchanged prefix
/// or suffix is shifted by the net length change of the middle; a caret that sat
/// inside the replaced region lands at its start. This is why undoing "big dog"
/// (typed before "specifications") moves the caret from "after big dog" back to
/// the insertion point instead of 7 characters deep into "specifications".
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

/// Write the resolved first-line indent into each live paragraph and re-stamp
/// `data-auto-indent` on automatic ones. The browser creates paragraphs with no
/// inline style (Enter, paste), so without this they render flush until the next
/// full render. The marker keeps the next readback reading `null` instead of
/// freezing the computed number as explicit. `domParagraphs` holds the sheet's
/// (or one section's) `.paragraph` elements in the same order as the paragraph
/// blocks in `blocks`.
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

/// Return the blocks the reconciler will compare against, with automatic
/// paragraphs shown as display copies: the computed number plus `autoIndent`.
/// The reconciler renders each block to HTML and keeps a block whose HTML
/// matches, so an automatic paragraph must carry the same baked shape
/// buildEditorHTML produces; otherwise its HTML would differ on every pass and
/// an unchanged block would be replaced. Explicit paragraphs already hold a
/// number and pass through unchanged, so the emitted model keeps the parsed
/// value (`null` or a number), never the baked one.
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

/// Build the two readback entry points bound to the reactive state editorDisplay
/// owns. `sheetRef` is the contenteditable root; `modelRef` is the current doc
/// (used for the empty-model guard); `zoomRef` is props.zoom (the font-size
/// baseline parseParagraphElement compares against); `lastRenderedBlocks` /
/// `lastSectionCount` are the retained DOM baseline the localized path diffs
/// against; `skipNextWatcher` suppresses the model→DOM watcher for a change that
/// originated here; `emit` forwards the rebuilt sections to the parent.
export function useEditorReadback({ sheetRef, modelRef, zoomRef, lastRenderedBlocks, lastSectionCount, skipNextWatcher, emit }) {
  /// Read back the whole sheet into the model and emit the full sections array.
  /// This is the FALLBACK for the localized syncFromDOM: used when an edit can't
  /// be confidently confined to one section (no selection, no section id, or the
  /// section structure looks changed) and on the first paint. It is the
  /// pre-localization behavior verbatim. O(document) — the localized path is
  /// what makes typing feel good; this only runs on structural ambiguity.
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

    // Retain the blocks the reconciler compares against on the next external
    // change. It renders each block to HTML and keeps a block whose HTML
    // matches. An automatic paragraph therefore goes in with the same baked
    // number and autoIndent flag buildEditorHTML produces; otherwise its HTML
    // would differ on every pass and the reconciler would replace an unchanged
    // block. The emitted sections above keep the parsed null, not the baked
    // number.
    lastRenderedBlocks.value = toDisplayBlocks(blocks)
    lastSectionCount.value = blocks.filter(block => block.kind === 'section-title').length

    skipNextWatcher.value = true
    emit('syncSections', sections)
  }

  /// Read back ONLY the cursor's section into the model and emit that one
  /// section. Every onInput edit is confined to one section — cross-section
  /// backspace/delete is preventDefault'd (onKeydown) and locked section-titles
  /// block input (onBeforeinput) — so the whole-sheet readback fullSyncFromDOM
  /// performs is unnecessary on the typing path. That readback called
  /// window.getComputedStyle() per paragraph AND per styled run
  /// (parseParagraphElement): an O(document) layout read per keystroke, which is
  /// the typing lag at 51k words. Reading one section makes it O(section) — a
  /// handful of getComputedStyle calls. Falls back to fullSyncFromDOM whenever it
  /// can't confidently localize (worst case = today's behavior).
  function syncFromDOM() {
    const root = sheetRef.value
    if (!root || !modelRef.value) return

    const sectionId = getSectionIdAtCursor()
    const titleEls = root.querySelectorAll('.section-title')
    // Structural gate: if the live section-title count differs from the retained
    // baseline, an edit crossed a section boundary (added/removed/merged a
    // section) — a localized read would miss the other side. Fall back to the
    // full readback. O(section-titles) DOM walk, no layout reads.
    if (!sectionId || !lastRenderedBlocks.value || titleEls.length !== lastSectionCount.value) {
      fullSyncFromDOM()
      return
    }

    // Locate this section's title element within the titles we already walked.
    let titleEl = null
    for (const el of titleEls) {
      if (el.dataset.sectionId === sectionId) { titleEl = el; break }
    }
    if (!titleEl) { fullSyncFromDOM(); return }
    // Collect this section's paragraphs POSITIONALLY — the consecutive
    // `.paragraph` siblings after the title, up to the next `.section-title` (or
    // a trailing decoration / end). This matches groupBlocks' positional logic,
    // NOT an attribute match: a paragraph created by execCommand('insertParagraph')
    // (the Enter handler) is a fresh <div> that may not carry data-section-id, so
    // querying by attribute would miss it and silently drop the just-split
    // paragraph. Walking siblings by class is robust to that.
    const paraEls = []
    let sibling = titleEl.nextElementSibling
    while (sibling && sibling.classList.contains('paragraph')) {
      paraEls.push(sibling)
      sibling = sibling.nextElementSibling
    }

    // Build the section's block list: one title block + its paragraph blocks.
    const titleBlock = {
      kind: 'section-title',
      sectionId,
      sectionType: titleEl.dataset.sectionType || 'section',
      title: readSectionTitleText(titleEl),
      hidden: titleEl.dataset.sectionHidden === 'true',
    }
    // Preserve the render-derived chapterIndex from the retained baseline — a
    // typing edit doesn't change the title or type, so the index is unchanged and
    // re-baking it would need an O(document) chapter walk. (If the section
    // somehow isn't in the baseline the gate above caught it, but guard anyway.)
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

    // Same rule as fullSyncFromDOM, for this section only. `computeFirstLineIndent`
    // reads the list the block sits in, and blocks[0] is this section's title,
    // so the section's indents stay self-contained.
    stampResolvedIndents(blocks, paraEls)

    // Group this section's blocks back into a Section (defensive ≥1 paragraph).
    const sections = groupBlocks(blocks)
    const section = sections[0]
    if (!section) { fullSyncFromDOM(); return }
    if (!section.paragraphs || section.paragraphs.length === 0) section.paragraphs.push(createParagraph())

    // Splice the section's blocks into the retained list, replacing its old
    // title and paragraphs in place. A within-section edit does not change the
    // section-title count, so lastSectionCount stays correct without a recompute.
    const baseline = lastRenderedBlocks.value
    const startIdx = baseline.findIndex(
      block => block.kind === 'section-title' && block.sectionId === sectionId
    )
    if (startIdx === -1) { fullSyncFromDOM(); return }
    let endIdx = startIdx + 1
    while (endIdx < baseline.length && baseline[endIdx].kind !== 'section-title') endIdx++
    // Same display-copy rule as fullSyncFromDOM: the reconciler compares
    // rendered HTML, so an automatic paragraph must carry the baked number and
    // autoIndent. The emitted section keeps the parsed values.
    const baselineBlocks = baseline.slice(0, startIdx).concat(
      toDisplayBlocks(blocks),
      baseline.slice(endIdx)
    )
    lastRenderedBlocks.value = baselineBlocks

    skipNextWatcher.value = true
    emit('syncSection', { id: section.id, title: section.title, sectionType: section.sectionType, hidden: section.hidden, paragraphs: section.paragraphs })
  }

  return { syncFromDOM, fullSyncFromDOM }
}