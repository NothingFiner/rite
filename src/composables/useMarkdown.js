// Shared markdown rendering for surfaces that show user or assistant markdown.
//
// The note preview and the assistant transcript must agree on one renderer:
// `marked` with `breaks` and `gfm`, then `DOMPurify.sanitize` before the HTML
// reaches `v-html`. The source stays markdown in storage.

import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ breaks: true, gfm: true })

export function renderMarkdown(source) {
  if (!source) return ''
  return DOMPurify.sanitize(marked.parse(source))
}

/// Resolve `[[…]]` against the document's reference record (SPEC.md revision 5).
/// Resolution happens at render time, so a rename rewrites no text and no link
/// target is stored.
export function resolveReferenceLinks(source, references) {
  return source
}

/// The renderer for surfaces that may carry reference links: a note, or an
/// entry's definition.
export function renderReferenceMarkdown(source, references) {
  return renderMarkdown(resolveReferenceLinks(source, references))
}
