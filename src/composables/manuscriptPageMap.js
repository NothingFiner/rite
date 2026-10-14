/// Pure helpers for the manuscript's front-matter ↔ content-page mapping.
///
/// The manuscript renders front matter (title / TOC) BEFORE the
/// numbered content pages. Content pages are keyed `content-${i}` with a
/// 0-based `i` (buildContentPages), and their ManuscriptPage header shows
/// `i + 1` — which is the shared pagination page number (the same number the
/// editor uses, because pagination is a single shared instance: roadmap 2.5).
/// Front-matter pages use literal keys (`title`, `toc`) and have NO
/// content-page number.
///
/// View-aware switching (5.1b) needs to translate between a pagination page
/// number and a manuscript content key, and to report a sensible page number
/// when the viewport is sitting on front matter. These two pure functions
/// encode that mapping with no DOM, so it can be unit-tested directly.
///
///   editor page 1  →  manuscript `content-0`  (the editor has no front matter)
///   manuscript front matter  →  page 1        (the first content page)
///   content page N  ↔  key `content-${N-1}`

// The pagination page number a content page represents, or null when the key is
// front matter (title/toc) — callers treat null as "page 1" so a switch
// from front matter lands on the first content page, not page 0.
export function contentPageNumberFromKey(key) {
  if (typeof key !== 'string' || !key.startsWith('content-')) return null
  const i = parseInt(key.slice('content-'.length), 10)
  return Number.isNaN(i) ? null : i + 1
}

// The manuscript content-page key for a 1-based pagination page number. Page 1
// → `content-0`. Clamped at 0 so a bad input can't produce `content--1`.
export function contentKeyForPage(pageNumber) {
  const zeroBased = Math.max(0, (pageNumber || 1) - 1)
  return `content-${zeroBased}`
}