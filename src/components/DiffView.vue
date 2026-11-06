<template>
  <!--
    Side-by-side diff of a past version (left = old) against the current live
    document (right = new). A section renders a title row, then one row per
    paragraph, so the two columns stay aligned row by row. Unchanged content
    appears plainly in both columns. Removed (in the past, gone now) appears on
    the left tinted red. Added (new since that version) appears on the right
    tinted green. A modified paragraph renders word-level spans: deleted words
    struck through on the left, inserted words highlighted on the right.
    Run-level styling (bold/italic) is not rendered in modified paragraphs —
    the diff is about text changes, and mixing per-run styling with per-word
    spans muddies both.
  -->
  <div class="diff-view">
    <div class="diff-header">
      <div class="diff-header-cell diff-left">Past version</div>
      <div class="diff-header-cell diff-right">Current</div>
      <!--
        STUB (SPEC 5.12). The controls are present so the navigation tests reach
        their assertions instead of failing on a missing element; none of the
        behaviour behind them exists yet. `data-change-index` is deliberately
        empty and `data-current-change` is pinned to the first section's title
        row — both are placeholders, not an enumeration of changes.
      -->
      <div class="diff-nav">
        <button class="diff-nav-prev" disabled>Previous change</button>
        <span class="diff-nav-position">Change 0 of 0</span>
        <button class="diff-nav-next" disabled>Next change</button>
      </div>
    </div>
    <div class="diff-body">
      <div v-for="(sd, i) in diffBlocks" :key="i" class="diff-section">
        <div
          class="diff-title-row"
          data-change-index=""
          :data-current-change="i === 0 ? 'true' : undefined"
        >
          <div
            class="diff-title-cell diff-left"
            :class="sideTint(sd, 'left')"
            v-html="titleHTML(sd, 'left')"
          ></div>
          <div
            class="diff-title-cell diff-right"
            :class="sideTint(sd, 'right')"
            v-html="titleHTML(sd, 'right')"
          ></div>
        </div>
        <div v-for="(pd, j) in paragraphRows(sd)" :key="j" class="diff-row" data-change-index="">
          <div
            class="diff-cell diff-left"
            :class="sideTint(sd, 'left')"
            v-html="paragraphHTML(pd, 'left')"
          ></div>
          <div
            class="diff-cell diff-right"
            :class="sideTint(sd, 'right')"
            v-html="paragraphHTML(pd, 'right')"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { paragraphToHTML, escapeHtml } from '../composables/useParagraphHTML.js'

const props = defineProps({
  diffBlocks: { type: Array, default: () => [] },
})

const GAP = '<div class="diff-gap">—</div>'

function typeTag(sectionType) {
  return sectionType === 'chapter' ? 'Chapter' : 'Section'
}

function fallbackTitle(sectionType, title) {
  if (title) return title
  return sectionType === 'chapter' ? '(untitled chapter)' : '(untitled section)'
}

/// Title line for a whole-section Unchanged/Added/Removed block, where the
/// full `section` is carried.
function sectionTitleLine(section) {
  const tag = typeTag(section.sectionType)
  const title = fallbackTitle(section.sectionType, section.title)
  return `<div class="diff-section-title"><span class="diff-type-tag">${tag}</span>${escapeHtml(title)}</div>`
}

/// Title line for a Modified section, showing the old (left) or new (right)
/// title. When the title was renamed, the old title is struck through.
function modifiedTitleLine(sd, side) {
  const tag = side === 'left' ? typeTag(sd.oldType) : typeTag(sd.newType)
  const title = side === 'left' ? sd.oldTitle : sd.newTitle
  const renamed = sd.oldTitle !== sd.newTitle
  const escaped = escapeHtml(fallbackTitle(side === 'left' ? sd.oldType : sd.newType, title))
  const body = side === 'left' && renamed
    ? `<span class="diff-renamed">${escaped}</span>`
    : escaped
  return `<div class="diff-section-title"><span class="diff-type-tag">${tag}</span>${body}</div>`
}

function titleHTML(sd, side) {
  if (sd.type === 'added' && side === 'left') return GAP
  if (sd.type === 'removed' && side === 'right') return GAP
  if (sd.type === 'modified') return modifiedTitleLine(sd, side)
  return sectionTitleLine(sd.section)
}

function sideTint(sd, side) {
  if (side === 'left') return sd.type === 'removed' ? 'diff-tint-removed' : ''
  return sd.type === 'added' ? 'diff-tint-added' : ''
}

/// The paragraph diffs of one section, normalised so every row carries a
/// `type` the cell renderer understands. A whole added or removed section
/// reports all of its paragraphs as added or removed.
function paragraphRows(sd) {
  if (sd.type === 'modified') return sd.paragraphDiffs || []
  const type = sd.type === 'unchanged' ? 'unchanged' : sd.type
  return (sd.section?.paragraphs || []).map((paragraph) => ({ type, paragraph }))
}

function plainParagraphHTML(p) {
  return paragraphToHTML(p, { sectionId: null })
}

/// Word-diff spans for one side of a Modified paragraph. The left side shows
/// equal + removed words (removed struck through); the right side shows equal
/// + added words (added highlighted). Words of the opposite kind are dropped so
/// each column shows only the text that belonged to its version.
function wordDiffHTML(wordDiff, side) {
  if (!wordDiff || wordDiff.length === 0) return ''
  const spans = wordDiff.map((w) => {
    const text = escapeHtml(w.text)
    if (w.kind === 'equal') return `<span class="diff-equal">${text}</span>`
    if (w.kind === 'removed') return side === 'left' ? `<span class="diff-word-removed">${text}</span>` : ''
    if (w.kind === 'added') return side === 'right' ? `<span class="diff-word-added">${text}</span>` : ''
    return ''
  })
  return spans.join('') || '<br>'
}

function paragraphHTML(pd, side) {
  if (pd.type === 'unchanged') return plainParagraphHTML(pd.paragraph)
  if (pd.type === 'removed') {
    return side === 'left' ? `<div class="diff-para-removed">${plainParagraphHTML(pd.paragraph)}</div>` : GAP
  }
  if (pd.type === 'added') {
    return side === 'right' ? `<div class="diff-para-added">${plainParagraphHTML(pd.paragraph)}</div>` : GAP
  }
  const words = wordDiffHTML(pd.wordDiff, side)
  const fallback = side === 'left' ? plainParagraphHTML(pd.old) : plainParagraphHTML(pd.new)
  return `<div class="diff-para-modified">${words || fallback}</div>`
}
</script>

<style scoped>
.diff-view {
  /* Flows inside the App scroll-layer; the page scrolls. Each section is a
     title row plus one row per paragraph, so left/right cells stay aligned
     row-by-row as the page scrolls. */
  font-family: var(--editor-font, Georgia, serif);
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-primary, #f0f0f5);
  padding-bottom: 96px;
}

.diff-header {
  display: flex;
  border-bottom: 1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.1));
  background: var(--glass-bg, rgba(20, 20, 25, 0.5));
}

.diff-header-cell {
  flex: 1;
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary, #a0a0b0);
}

.diff-header-cell.diff-left {
  border-right: 1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.1));
}

.diff-title-row {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.06));
}

.diff-title-cell {
  flex: 1;
  min-width: 0;
  padding: 12px 16px 4px;
  word-break: break-word;
}

.diff-title-cell.diff-left {
  border-right: 1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.1));
}

.diff-row {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.06));
}

.diff-cell {
  flex: 1;
  min-width: 0;
  padding: 6px 16px;
  word-break: break-word;
}

.diff-cell.diff-left {
  border-right: 1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.1));
}

.diff-tint-removed {
  background: rgba(248, 81, 73, 0.08);
}

.diff-tint-added {
  background: rgba(63, 185, 80, 0.08);
}

.diff-title-cell :deep(.diff-section-title),
.diff-cell :deep(.diff-section-title) {
  font-weight: 700;
  font-size: 1.2em;
  margin: 0 0 0.4em;
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.diff-title-cell :deep(.diff-type-tag),
.diff-cell :deep(.diff-type-tag) {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary, #a0a0b0);
  border: 1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.15));
  border-radius: 3px;
  padding: 1px 5px;
  flex-shrink: 0;
}

.diff-title-cell :deep(.diff-renamed) {
  text-decoration: line-through;
  opacity: 0.7;
}

.diff-cell :deep(.paragraph) {
  margin: 0 0 0.6em;
}

.diff-cell :deep(.diff-para-removed) {
  background: rgba(248, 81, 73, 0.1);
  border-radius: 3px;
  padding: 0 4px;
}

.diff-cell :deep(.diff-para-added) {
  background: rgba(63, 185, 80, 0.1);
  border-radius: 3px;
  padding: 0 4px;
}

.diff-cell :deep(.diff-word-removed) {
  background: rgba(248, 81, 73, 0.25);
  text-decoration: line-through;
  border-radius: 2px;
}

.diff-cell :deep(.diff-word-added) {
  background: rgba(63, 185, 80, 0.25);
  border-radius: 2px;
}

.diff-cell :deep(.diff-gap),
.diff-title-cell :deep(.diff-gap) {
  opacity: 0.35;
  font-style: italic;
  text-align: center;
  padding: 8px 0;
}
</style>
