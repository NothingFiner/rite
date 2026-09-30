// Pure, DOM-free reconciliation of the editor's flat block list.
//
// The editor's contenteditable is a FLAT sibling list of `.section-title` and
// `.paragraph` blocks (see useSectionBlocks.flattenSections). On an *external*
// model change (undo, rename, delete, type-change, restore) we want to patch
// the live DOM surgically — by stable block id — instead of rebuilding the
// whole sheet with `innerHTML` (which throws away the cursor and scroll).
//
// This module computes the *what changed*: given the old block list (matching
// the current DOM) and the new block list (from the model), it emits an
// ordered op list the caller applies to the DOM. It is pure — no Vue, no DOM
// — so the diff logic is unit-testable. The DOM application, cursor
// save/restore, and the drift-gate fallback live in editorDisplay.vue.
//
// Two assumptions that keep this simple (verified against the app):
//   1. Blocks have stable ids — `sectionId` on titles, `paragraphId` on
//      paragraphs — so identity survives edits and we can diff by key.
//   2. Sections are never reordered. The diff is therefore insert / delete /
//      replace-in-place, ORDER-PRESERVING — no move operations, no
//      longest-common-subsequence. The new list is the old list with some
//      blocks inserted, deleted, or content-changed, in the same relative
//      order.
//
// "Changed" is decided by comparing the rendered HTML of the old and new
// blocks (via the injected `renderBlockFn`). That single string compare
// captures everything that affects the DOM: title text, section type, the
// render-derived chapter prefix number, paragraph text/run-styles, and the
// baked first-line indent. flattenSections already computes `chapterIndex` on
// each title block, so inserting/deleting a chapter changes every later
// chapter's `chapterIndex` → its rendered prefix changes → it becomes a
// `replace` op and is re-rendered with the correct number, for free.
//
// `renderBlockHTML` (below) is the production `renderBlockFn`: it renders one
// block to the same HTML `buildEditorHTML` (useEditorRender.js) produces for
// that block, so a block unchanged between two renders is byte-identical and
// diffs as `keep`. The orchestrator binds the render-derived bits
// (`freshSectionId`, `formatChapter`) it owns into the options bag and passes
// the bound function to computeReconcileOps.

import { paragraphToHTML, sectionTitleToHTML } from './useParagraphHTML.js'

/// Render a single block to its full editor outer HTML, matching
/// buildEditorHTML's per-block rendering byte-for-byte so an unchanged block
/// is `keep`, not a false `replace`. Uses the block's baked `chapterIndex`
/// (set by flattenSections, or by bakeChapterIndices on the DOM-readback path)
/// for the render-derived chapter prefix.
///
/// `{ freshSectionId, formatChapter }` is injected by the orchestrator:
/// `freshSectionId` marks a just-inserted section's title editable;
/// `formatChapter(index)` renders the locked "Chapter N: " prefix. Both are
/// passed as a bag (not closed over) so this stays a pure, unit-testable
/// function the reconciler can inject as its `renderBlockFn`.
export function renderBlockHTML(block, { freshSectionId, formatChapter } = {}) {
  if (block.kind === 'section-title') {
    const idx = block.chapterIndex
    const chapterPrefix = idx != null ? (formatChapter ? formatChapter(idx) : '') : ''
    return sectionTitleToHTML(
      { id: block.sectionId, title: block.title, sectionType: block.sectionType },
      idx,
      chapterPrefix,
      { fresh: block.sectionId === freshSectionId }
    )
  }
  return paragraphToHTML(block.paragraph, { sectionId: block.sectionId })
}

/// A stable, kind-prefixed key for a block. The prefix keeps section ids and
/// paragraph ids in separate namespaces (a section id and a paragraph id could
/// otherwise collide). Used both as the diff key and, by the caller, as the
/// DOM selector basis (`[data-section-id=…]` / `[data-para-id=…]`).
export function blockKey(block) {
  if (block.kind === 'section-title') return 'title:' + block.sectionId
  if (block.kind === 'paragraph') return 'para:' + block.paragraphId
  return null
}

/// Compute the reconciliation ops to turn `oldBlocks` into `newBlocks`.
///
/// Returns `{ ops, removedKeys }`:
///   - `ops`: one entry per new block, IN NEW ORDER, each
///       `{ op: 'keep',    key }`
///       `{ op: 'replace', key, html }`  — same key, rendered HTML differs
///       `{ op: 'insert',  key, html }`  — key not present in old
///   - `removedKeys`: old keys absent from new (caller removes those DOM nodes)
///
/// `renderBlockFn(block) -> htmlString` is injected: the component passes the
/// real renderer (sectionTitleToHTML / paragraphToHTML); tests pass a tiny
/// deterministic one. A block is `keep` when its key survives AND its rendered
/// HTML is byte-identical, otherwise `replace` (survivor) or `insert` (new).
export function computeReconcileOps(oldBlocks, newBlocks, renderBlockFn) {
  const oldHtmlByKey = new Map()
  for (const block of oldBlocks) {
    oldHtmlByKey.set(blockKey(block), renderBlockFn(block))
  }

  const ops = []
  const consumed = new Set()

  for (const block of newBlocks) {
    const key = blockKey(block)
    const oldHtml = oldHtmlByKey.get(key)
    const newHtml = renderBlockFn(block)
    if (oldHtml !== undefined && oldHtml === newHtml) {
      ops.push({ op: 'keep', key })
    } else if (oldHtml !== undefined) {
      ops.push({ op: 'replace', key, html: newHtml })
    } else {
      ops.push({ op: 'insert', key, html: newHtml })
    }
    consumed.add(key)
  }

  const removedKeys = []
  for (const key of oldHtmlByKey.keys()) {
    if (!consumed.has(key)) removedKeys.push(key)
  }

  return { ops, removedKeys }
}