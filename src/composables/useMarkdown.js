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
