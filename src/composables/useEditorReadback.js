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

/// True for the non-content decorations interleaved with the real blocks — the
/// page-break <hr>, page-number labels, the epigram block, and the click
/// sentinel. domToBlocks and the keydown walk skip these so they never become
/// model blocks or nav targets.
export function isNonContentBlock(el) {
  return el.classList?.contains('page-break-line') ||
    el.classList?.contains('page-number-label') ||
    el.classList?.contains('epigram-block') ||
    el.classList?.contains('editor-sentinel')
}

/// Read a single `.paragraph` div into a Paragraph model. `zoom` is the editor's
/// current font-size baseline (props.zoom): a run whose computed font-size
/// differs from both the 16px default AND the zoom level is an explicit
/// per-run size override worth preserving; one that merely tracks the zoom
/// baseline is not. getComputedStyle is the per-run cost the localized
/// syncFromDOM exists to minimize.
export function parseParagraphElement(child, zoom) {
  const style = window.getComputedStyle(child)
  const leftIndentPx = parseInt(style.marginLeft, 10) || 0
  const rightIndentPx = parseInt(style.marginRight, 10) || 0
  const elements = []
  for (const run of child.childNodes) {
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
      const fs = parseInt(runStyle.fontSize, 10)
      if (fs && fs !== 16 && fs !== zoom) textStyle.fontSize = fs
      elements.push({ textRun: { content: run.innerText || '', textStyle } })
    }
  }
  if (elements.length === 0) {
    elements.push({ textRun: { content: '', textStyle: defaultTextStyle() } })
  }
  // Resolve the paragraph id, STAMPING it back onto the DOM when missing. A
  // paragraph created by the browser (paste / IME composition / an Enter edge
  // case the keydown handler doesn't catch) can land in the sheet with no
  // data-para-id; without this write-back the model + Rust get a fresh id while
  // the DOM keeps none, so `applySearchHighlights` (which locates matches by
  // [data-para-id]) can never find the paragraph and search matches render with
  // no highlight. Stamping here keeps the invariant DOM data-para-id === model
  // paragraph id that the reconciler, the search highlighter, and the Rust
  // UpdateParagraph delta all depend on.
  const id = child.dataset.paraId || generateParagraphId()
  child.dataset.paraId = id
  return {
    id,
    leftIndent: leftIndentPx > 0 ? Math.round(leftIndentPx / 96 * 10) / 10 : null,
    rightIndent: rightIndentPx > 0 ? Math.round(rightIndentPx / 96 * 10) / 10 : null,
    firstLineIndent: null, // recomputed in syncFromDOM/fullSyncFromDOM
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
/// paragraph divs) into the block shape groupBlocks understands. `zoom` threads
/// through to parseParagraphElement. Non-content decorations are skipped.
export function domToBlocks(root, zoom) {
  const blocks = []
  for (const child of Array.from(root.children)) {
    if (isNonContentBlock(child)) continue

    if (child.classList?.contains('section-title')) {
      blocks.push({
        kind: 'section-title',
        sectionId: child.dataset.sectionId || generateSectionId(),
        sectionType: child.dataset.sectionType || 'section',
        title: readSectionTitleText(child),
        hidden: child.dataset.sectionHidden === 'true',
      })
    } else if (child.classList?.contains('paragraph')) {
      blocks.push({
        kind: 'paragraph',
        sectionId: child.dataset.sectionId,
        paragraphId: child.dataset.paraId,
        paragraph: parseParagraphElement(child, zoom),
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

    // Compute and bake section-aware first-line indents.
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].kind !== 'paragraph') continue
      blocks[i].paragraph.firstLineIndent = computeFirstLineIndent(blocks, i)
    }

    // Reflect computed indents back into the live DOM so paragraphs created by
    // the browser (which don't copy inline styles) show the right indent.
    const domParas = Array.from(root.querySelectorAll('.paragraph'))
    let pIdx = 0
    for (const block of blocks) {
      if (block.kind !== 'paragraph') continue
      const dom = domParas[pIdx]
      pIdx++
      if (!dom) continue
      const indent = block.paragraph.firstLineIndent
      dom.style.textIndent = indent > 0 ? `${Math.round(indent * 96)}px` : '0px'
    }

    let sections = groupBlocks(blocks)
    // Defensive: every section must have at least one paragraph to type into.
    for (const s of sections) {
      if (!s.paragraphs || s.paragraphs.length === 0) s.paragraphs.push(createParagraph())
    }

    // Keep the retained block list in sync with the live DOM so a later external
    // change diffs against reality, not a pre-typing snapshot.
    lastRenderedBlocks.value = blocks
    lastSectionCount.value = blocks.filter(b => b.kind === 'section-title').length

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
      b => b.kind === 'section-title' && b.sectionId === sectionId
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

    // Compute and bake first-line indents within this section only. The title is
    // blocks[0]; computeFirstLineIndent looks back only to the previous block in
    // this local list, so a section's indents are self-contained.
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].kind !== 'paragraph') continue
      blocks[i].paragraph.firstLineIndent = computeFirstLineIndent(blocks, i)
    }

    // Reflect computed indents back into this section's live DOM paragraphs only.
    let pi = 0
    for (const block of blocks) {
      if (block.kind !== 'paragraph') continue
      const dom = paraEls[pi]
      pi++
      if (!dom) continue
      const indent = block.paragraph.firstLineIndent
      dom.style.textIndent = indent > 0 ? `${Math.round(indent * 96)}px` : '0px'
    }

    // Group this section's blocks back into a Section (defensive ≥1 paragraph).
    const sections = groupBlocks(blocks)
    const s = sections[0]
    if (!s) { fullSyncFromDOM(); return }
    if (!s.paragraphs || s.paragraphs.length === 0) s.paragraphs.push(createParagraph())

    // Splice the section's blocks into the retained list, replacing its old
    // title + paragraphs in place. Section-title count is unchanged by a
    // within-section edit, so lastSectionCount stays correct without recompute.
    const all = lastRenderedBlocks.value
    const startIdx = all.findIndex(
      b => b.kind === 'section-title' && b.sectionId === sectionId
    )
    if (startIdx === -1) { fullSyncFromDOM(); return }
    let endIdx = startIdx + 1
    while (endIdx < all.length && all[endIdx].kind !== 'section-title') endIdx++
    lastRenderedBlocks.value = all.slice(0, startIdx).concat(blocks, all.slice(endIdx))

    skipNextWatcher.value = true
    emit('syncSection', { id: s.id, title: s.title, sectionType: s.sectionType, hidden: s.hidden, paragraphs: s.paragraphs })
  }

  return { syncFromDOM, fullSyncFromDOM }
}