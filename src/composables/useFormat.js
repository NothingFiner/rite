import { ref, reactive } from 'vue'
import { useDocumentStore } from '../stores/document.js'

export const fontOptions = [
  { label: 'Inter', family: "'Inter', sans-serif" },
  { label: 'Crimson Text', family: "'Crimson Text', Georgia, serif" },
  { label: 'Merriweather', family: "'Merriweather', Georgia, serif" },
  { label: 'Spectral', family: "'Spectral', Georgia, serif" },
  { label: 'Baskervville', family: "'Baskervville', Georgia, serif" },
  { label: 'Georgia', family: "'Georgia', serif" },
  { label: 'Times New Roman', family: "'Times New Roman', Times, serif" },
  { label: 'Helvetica', family: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: 'Courier Prime', family: "'Courier Prime', 'Courier New', Courier, monospace" },
  { label: 'Courier New', family: "'Courier New', Courier, monospace" },
]

export function useFormat(editorRef, markModified) {
  const formats = reactive({ bold: false, italic: false, underline: false })
  const selectedWordCount = ref(0)
  const editorFont = ref(fontOptions[0].family)

  function getEditorSheet() {
    const el = editorRef.value?.$el
    if (!el) return null
    if (el.classList?.contains('editor-sheet')) return el
    return el.querySelector?.('.editor-sheet') || null
  }

  function isFocusInEditor() {
    const sheet = getEditorSheet()
    if (!sheet) return false
    const active = document.activeElement
    return active === sheet || sheet.contains(active)
  }

  function getActiveParagraph() {
    const sel = window.getSelection()
    if (!sel.rangeCount) return null
    let node = sel.anchorNode
    if (!node) return null
    const sheet = getEditorSheet()
    if (!sheet) return null
    let el = node.nodeType === 3 ? node.parentElement : node
    let inside = false
    let walk = el
    while (walk) {
      if (walk === sheet) { inside = true; break }
      walk = walk.parentElement
    }
    if (!inside) return null
    let para = el
    while (para && !para.classList?.contains('paragraph')) {
      para = para.parentElement
    }
    return para
  }

  function syncFormatState() {
    if (isFocusInEditor()) {
      formats.bold = document.queryCommandState('bold')
      formats.italic = document.queryCommandState('italic')
      formats.underline = document.queryCommandState('underline')
      return
    }
    const para = getActiveParagraph()
    if (!para) {
      formats.bold = false
      formats.italic = false
      formats.underline = false
      return
    }
    let run = window.getSelection().anchorNode
    if (run.nodeType === 3) run = run.parentElement
    if (!run || run === para) {
      const s = window.getComputedStyle(para)
      formats.bold = s.fontWeight === '700' || s.fontWeight === 'bold'
      formats.italic = s.fontStyle === 'italic'
      formats.underline = s.textDecorationLine.includes('underline')
      return
    }
    const s = window.getComputedStyle(run)
    formats.bold = s.fontWeight === '700' || s.fontWeight === 'bold'
    formats.italic = s.fontStyle === 'italic'
    formats.underline = s.textDecorationLine.includes('underline')
  }

  function getSelectionModelOffsets() {
    const sheet = getEditorSheet()
    if (!sheet) return null
    const sel = window.getSelection()
    if (!sel.rangeCount) return null

    const range = sel.getRangeAt(0)
    const startNode = sel.anchorNode
    const endNode = sel.focusNode
    if (!startNode || !endNode) return null

    const startParaEl = (() => {
      let el = startNode.nodeType === 3 ? startNode.parentElement : startNode
      while (el && !el.classList?.contains('paragraph')) el = el.parentElement
      return el
    })()

    const endParaEl = (() => {
      let el = endNode.nodeType === 3 ? endNode.parentElement : endNode
      while (el && !el.classList?.contains('paragraph')) el = el.parentElement
      return el
    })()

    if (!startParaEl || !endParaEl) return null
    if (startParaEl !== endParaEl) return null

    const paragraphId = startParaEl.dataset.paraId
    if (!paragraphId) return null

    function offsetWithinParagraph(node, offset) {
      const walker = document.createTreeWalker(
        startParaEl,
        NodeFilter.SHOW_TEXT,
        null,
        false
      )
      let textOffset = 0
      let current = walker.nextNode()
      while (current) {
        if (current === node) return textOffset + offset
        if (node.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING) {
          return textOffset
        }
        textOffset += current.textContent.length
        current = walker.nextNode()
      }
      return textOffset
    }

    const startOffset = offsetWithinParagraph(startNode, sel.anchorOffset)
    const endOffset = offsetWithinParagraph(endNode, sel.focusOffset)

    return {
      paragraphId,
      startOffset: Math.min(startOffset, endOffset),
      endOffset: Math.max(startOffset, endOffset),
    }
  }

  async function toggleFormat(command) {
    const sheet = getEditorSheet()
    if (!sheet) return

    const selection = getSelectionModelOffsets()
    if (!selection || selection.startOffset === selection.endOffset) {
      // No active selection in a single paragraph; fall back to execCommand on
      // the focused editor for immediate feedback (legacy path for empty selection).
      if (!isFocusInEditor()) sheet.focus()
      document.execCommand(command, false, null)
      syncFormatState()
      markModified()
      editorRef.value?.syncFromDOM()
      return
    }

    const store = useDocumentStore()
    const active = formats[command] || false
    const styleDelta = {}
    if (command === 'bold') styleDelta.bold = !active
    if (command === 'italic') styleDelta.italic = !active
    if (command === 'underline') styleDelta.underline = !active

    await store.applyTextStyle({
      paragraphId: selection.paragraphId,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
      ...styleDelta,
    })

    syncFormatState()
    markModified()
  }

  function updateSelectedWordCount() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      selectedWordCount.value = 0
      return
    }
    const text = sel.toString()
    if (!text.trim()) {
      selectedWordCount.value = 0
      return
    }
    selectedWordCount.value = text.trim().split(/\s+/).filter(Boolean).length
  }

  function loadPrefs() {
    try {
      const f = localStorage.getItem('rite-font')
      if (f) {
        const found = fontOptions.find(opt => opt.label === f)
        if (found) editorFont.value = found.family
      }
    } catch {}
  }

  function savePrefs() {
    try {
      const found = fontOptions.find(opt => opt.family === editorFont.value)
      if (found) localStorage.setItem('rite-font', found.label)
    } catch {}
  }

  function setFont(family) {
    editorFont.value = family
    savePrefs()
    markModified()
  }

  return {
    formats,
    selectedWordCount,
    editorFont,
    fontOptions,
    getActiveParagraph,
    getSelectionModelOffsets,
    syncFormatState,
    toggleFormat,
    updateSelectedWordCount,
    loadPrefs,
    savePrefs,
    setFont,
  }
}
