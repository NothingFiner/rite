const HIGHLIGHT_CLASS = 'search-highlight'
const CURRENT_CLASS = 'search-current'

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getSearchableTextNodes(root) {
  const nodes = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false)
  let node
  while ((node = walker.nextNode())) {
    let el = node.parentElement
    let skip = false
    while (el && el !== root) {
      if (el.getAttribute?.('contenteditable') === 'false' || el.classList?.contains('page-number-label') || el.classList?.contains('page-break-line')) {
        skip = true
        break
      }
      el = el.parentElement
    }
    if (!skip) nodes.push(node)
  }
  return nodes
}

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

export function applySearch(root, query, currentIndex = 0) {
  clearSearchHighlights(root)
  if (!query) return { matches: [], currentIndex: -1 }

  const textNodes = getSearchableTextNodes(root)
  const regex = new RegExp(escapeRegex(query), 'gi')
  const allMatches = []

  for (const textNode of textNodes) {
    const text = textNode.textContent
    const matches = []
    let m
    while ((m = regex.exec(text)) !== null) {
      matches.push(m)
    }
    if (matches.length === 0) continue

    const parent = textNode.parentNode
    let lastIndex = 0
    const fragments = []

    for (const m of matches) {
      if (m.index > lastIndex) {
        fragments.push(document.createTextNode(text.slice(lastIndex, m.index)))
      }
      const span = document.createElement('span')
      span.className = HIGHLIGHT_CLASS
      span.textContent = m[0]
      fragments.push(span)
      allMatches.push({ span, text: m[0] })
      lastIndex = m.index + m[0].length
    }

    if (lastIndex < text.length) {
      fragments.push(document.createTextNode(text.slice(lastIndex)))
    }

    for (const frag of fragments) {
      parent.insertBefore(frag, textNode)
    }
    parent.removeChild(textNode)
  }

  if (allMatches.length > 0) {
    currentIndex = Math.max(0, Math.min(currentIndex, allMatches.length - 1))
    allMatches.forEach((match, i) => {
      match.span.className = i === currentIndex ? CURRENT_CLASS : HIGHLIGHT_CLASS
    })
    const currentSpan = allMatches[currentIndex].span
    currentSpan.scrollIntoView({ behavior: 'smooth', block: 'center' })
  } else {
    currentIndex = -1
  }

  return { matches: allMatches, currentIndex }
}

export function findNext(root, query, currentIndex) {
  return applySearch(root, query, currentIndex + 1)
}

export function findPrev(root, query, currentIndex) {
  return applySearch(root, query, Math.max(0, currentIndex - 1))
}

export function replaceCurrent(root, query, replaceText, currentIndex) {
  const highlights = Array.from(root.querySelectorAll(`.${CURRENT_CLASS}, .${HIGHLIGHT_CLASS}`))
  if (currentIndex < 0 || currentIndex >= highlights.length) {
    return applySearch(root, query, 0)
  }

  const span = highlights[currentIndex]
  const parent = span.parentNode
  const textNode = document.createTextNode(replaceText)
  parent.replaceChild(textNode, span)
  parent.normalize()

  return applySearch(root, query, currentIndex)
}

export function replaceAll(root, query, replaceText) {
  clearSearchHighlights(root)
  const textNodes = getSearchableTextNodes(root)
  let count = 0

  for (const textNode of textNodes) {
    const text = textNode.textContent
    const newText = text.replace(new RegExp(escapeRegex(query), 'gi'), replaceText)
    if (newText !== text) {
      textNode.textContent = newText
      count++
    }
  }

  root.normalize()
  return { count }
}
