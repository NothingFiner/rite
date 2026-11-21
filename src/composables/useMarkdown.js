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

const entryIdByLabel = (references) => {
  const targets = new Map()
  for (const entry of references?.entries ?? []) {
    for (const label of [entry.name, ...(entry.aliases ?? [])]) {
      // The label key is trimmed and lowered the way `nameOwner` spells it in
      // useReferences.js. The first record to claim a label keeps one target.
      const key = (label ?? '').trim().toLowerCase()
      if (key && !targets.has(key)) targets.set(key, entry.id)
    }
  }
  return targets
}

const isEscapedOpener = (source, at) => {
  let backslashes = 0
  let probe = at
  while (source[probe - 1] === '\\') {
    backslashes += 1
    probe -= 1
  }
  // An odd backslash run escapes the opener. An even run belongs to the prose.
  return backslashes % 2 === 1
}

/// Resolve `[[…]]` against the document's reference record (SPEC.md revision 5).
/// Equality is whole-text against a name or alias, ignoring case. The
/// whole-word mention scan is the separate rule in useReferences.js.
/// Resolution happens at render time, so a rename rewrites no text and no
/// link target is stored.
export function resolveReferenceLinks(source, references) {
  const targets = entryIdByLabel(references)
  if (!source || targets.size === 0) return source

  let resolved = ''
  let cursor = 0
  while (cursor < source.length) {
    const opener = source.indexOf('[[', cursor)
    if (opener === -1) break
    resolved += source.slice(cursor, opener)
    if (isEscapedOpener(source, opener)) {
      cursor = opener + 2
      continue
    }
    const close = source.indexOf(']]', opener + 2)
    if (close === -1) {
      resolved += source.slice(opener, opener + 2)
      cursor = opener + 2
      continue
    }
    const text = source.slice(opener + 2, close)
    const entryId = targets.get(text.trim().toLowerCase())
    resolved += entryId
      ? `<a class="reference-link" data-entry-id="${entryId}">${text}</a>`
      : source.slice(opener, close + 2)
    cursor = close + 2
  }
  return resolved + source.slice(cursor)
}

/// The renderer for surfaces that may carry reference links: a note, or an
/// entry's definition.
export function renderReferenceMarkdown(source, references) {
  return renderMarkdown(resolveReferenceLinks(source, references))
}
