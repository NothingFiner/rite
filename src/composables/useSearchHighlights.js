const HIGHLIGHT_CLASS = 'search-highlight'
const CURRENT_CLASS = 'search-current'

export function clearSearchHighlights(root) {
  if (!root) return
  root.querySelectorAll(`.${HIGHLIGHT_CLASS}, .${CURRENT_CLASS}`).forEach(span => {
    const parent = span.parentNode
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span)
    }
    parent.removeChild(span)
    parent.normalize()
  })
}

function wrapMatchInParagraph(paraEl, startOffset, endOffset, className) {
  const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT, null, false)
  const textNodes = []
  let node
  while ((node = walker.nextNode())) {
    textNodes.push(node)
  }

  let charCount = 0
  for (const textNode of textNodes) {
    const text = textNode.textContent
    const nodeLen = text.length
    const nodeStart = charCount
    const nodeEnd = charCount + nodeLen

    if (nodeEnd <= startOffset) {
      charCount += nodeLen
      continue
    }
    if (nodeStart >= endOffset) {
      break
    }

    const overlapStart = Math.max(0, startOffset - nodeStart)
    const overlapEnd = Math.min(nodeLen, endOffset - nodeStart)

    const before = text.slice(0, overlapStart)
    const matchText = text.slice(overlapStart, overlapEnd)
    const after = text.slice(overlapEnd)

    const fragment = document.createDocumentFragment()
    if (before) fragment.appendChild(document.createTextNode(before))
    const span = document.createElement('span')
    span.className = className
    span.textContent = matchText
    fragment.appendChild(span)
    if (after) fragment.appendChild(document.createTextNode(after))

    textNode.parentNode.replaceChild(fragment, textNode)
    charCount = nodeStart + overlapEnd
  }
}

export function applySearchHighlights(root, matches, currentIndex) {
  clearSearchHighlights(root)
  if (!matches || matches.length === 0) return

  const byPara = {}
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    if (!byPara[m.paragraph_id]) byPara[m.paragraph_id] = []
    byPara[m.paragraph_id].push({ ...m, index: i })
  }

  for (const paraId in byPara) {
    const paraEl = root.querySelector(`[data-para-id="${paraId}"]`)
    if (!paraEl) {
      // Diagnostic: the backend returned a match for a paragraph_id that has no
      // corresponding [data-para-id] element in the live DOM. The match-count
      // readout (driven by reactive refs, independent of highlighting) will show
      // the match, but no highlight span can be rendered and scrollIntoView
      // can't fire — exactly the "finding matches but nothing highlights / moves"
      // symptom. Logging the expected ids vs the ids actually present surfaces
      // the drift (a browser-created paragraph that never got its id stamped
      // back, or a stale Rust doc) without being noisy in the happy path.
      const present = Array.from(root.querySelectorAll('[data-para-id]'))
        .map(el => el.dataset.paraId)
      console.warn('[search] match paragraph_id not in DOM:', { missing: paraId, presentInDom: present })
      continue
    }

    // Sort by start_offset descending so earlier offsets aren't shifted
    const paraMatches = byPara[paraId].sort((a, b) => b.start_offset - a.start_offset)
    for (const match of paraMatches) {
      const isCurrent = match.index === currentIndex
      const className = isCurrent ? CURRENT_CLASS : HIGHLIGHT_CLASS
      wrapMatchInParagraph(paraEl, match.start_offset, match.end_offset, className)
    }
  }

  const currentSpan = root.querySelector(`.${CURRENT_CLASS}`)
  if (currentSpan) {
    currentSpan.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}
