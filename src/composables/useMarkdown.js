// Shared markdown rendering for surfaces that show user or assistant markdown.
//
// The note preview and the assistant transcript must agree on one renderer:
// `marked` with `breaks` and `gfm`, then `DOMPurify.sanitize` before the HTML
// reaches `v-html`. The source stays markdown in storage.

export function renderMarkdown(source) {
  return ''
}
