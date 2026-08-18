import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useFormat } from './useFormat.js'
import { ref } from 'vue'

const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => { store[key] = String(value) }),
    clear: () => { store = {} },
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
})

describe('useFormat', () => {
  let format
  let editorRef
  let markModified

  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
    markModified = vi.fn()
    const sheet = document.createElement('div')
    sheet.className = 'editor-sheet'
    sheet.contentEditable = 'true'
    editorRef = ref({
      syncFromDOM: vi.fn(),
      $el: sheet,
    })
    format = useFormat(editorRef, markModified)
    Object.defineProperty(document, 'execCommand', { value: vi.fn(), writable: true, configurable: true })
    Object.defineProperty(document, 'queryCommandState', { value: vi.fn(() => false), writable: true, configurable: true })
  })

  it('initializes with no formats active', () => {
    expect(format.formats.bold).toBe(false)
    expect(format.formats.italic).toBe(false)
    expect(format.formats.underline).toBe(false)
  })

  it('starts with Inter as default font', () => {
    expect(format.editorFont.value).toContain('Inter')
  })

  it('provides font options', () => {
    expect(format.fontOptions.length).toBeGreaterThan(5)
    expect(format.fontOptions.map(o => o.label)).toContain('Inter')
  })

  it('sets font and saves preference', () => {
    const crimson = "'Crimson Text', Georgia, serif"
    format.setFont(crimson)
    expect(format.editorFont.value).toBe(crimson)
    expect(markModified).toHaveBeenCalled()
    expect(localStorageMock.setItem).toHaveBeenCalledWith('finewrite-font', 'Crimson Text')
  })

  it('loads saved font preference', () => {
    localStorageMock.getItem.mockReturnValue('Crimson Text')
    const freshFormat = useFormat(editorRef, markModified)
    freshFormat.loadPrefs()
    expect(freshFormat.editorFont.value).toContain('Crimson Text')
  })

  it('selected word count defaults to 0', () => {
    expect(format.selectedWordCount.value).toBe(0)
  })

  it('updateSelectedWordCount counts words in selection', () => {
    const mockSelection = {
      toString: () => 'hello world test',
      isCollapsed: false,
    }
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)
    format.updateSelectedWordCount()
    expect(format.selectedWordCount.value).toBe(3)
  })

  it('counts 0 words when selection is collapsed', () => {
    const mockSelection = {
      toString: () => '',
      isCollapsed: true,
    }
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)
    format.updateSelectedWordCount()
    expect(format.selectedWordCount.value).toBe(0)
  })

  it('toggleFormat focuses editor when focus is outside', () => {
    const sheet = editorRef.value.$el
    sheet.focus = vi.fn()
    Object.defineProperty(document, 'activeElement', { value: document.body, configurable: true })
    format.toggleFormat('bold')
    expect(sheet.focus).toHaveBeenCalled()
    expect(document.execCommand).toHaveBeenCalledWith('bold', false, null)
  })

  it('toggleFormat does not re-focus when editor already has focus', () => {
    const sheet = editorRef.value.$el
    sheet.focus = vi.fn()
    Object.defineProperty(document, 'activeElement', { value: sheet, configurable: true })
    format.toggleFormat('italic')
    expect(sheet.focus).not.toHaveBeenCalled()
    expect(document.execCommand).toHaveBeenCalledWith('italic', false, null)
  })

  it('syncFormatState uses queryCommandState when editor is focused', () => {
    const sheet = editorRef.value.$el
    Object.defineProperty(document, 'activeElement', { value: sheet, configurable: true })
    document.queryCommandState.mockImplementation((cmd) => cmd === 'bold')
    format.syncFormatState()
    expect(format.formats.bold).toBe(true)
    expect(format.formats.italic).toBe(false)
    expect(format.formats.underline).toBe(false)
  })

  it('syncFormatState resets formats when editor is not focused and no selection', () => {
    Object.defineProperty(document, 'activeElement', { value: document.body, configurable: true })
    vi.spyOn(window, 'getSelection').mockReturnValue({ rangeCount: 0 })
    format.formats.bold = true
    format.formats.italic = true
    format.formats.underline = true
    format.syncFormatState()
    expect(format.formats.bold).toBe(false)
    expect(format.formats.italic).toBe(false)
    expect(format.formats.underline).toBe(false)
  })

  it('toggleFormat works when .editor-sheet is nested inside wrapper', () => {
    const wrapper = document.createElement('div')
    const sheet = document.createElement('div')
    sheet.className = 'editor-sheet'
    wrapper.appendChild(sheet)
    editorRef.value.$el = wrapper
    Object.defineProperty(document, 'activeElement', { value: sheet, configurable: true })
    format.toggleFormat('bold')
    expect(document.execCommand).toHaveBeenCalledWith('bold', false, null)
    editorRef.value.$el = sheet // restore
  })

  it('toggleFormat does not re-focus when focus is inside a child of editor', () => {
    const sheet = editorRef.value.$el
    const child = document.createElement('span')
    sheet.appendChild(child)
    sheet.focus = vi.fn()
    Object.defineProperty(document, 'activeElement', { value: child, configurable: true })
    format.toggleFormat('italic')
    expect(sheet.focus).not.toHaveBeenCalled()
    expect(document.execCommand).toHaveBeenCalledWith('italic', false, null)
    sheet.removeChild(child)
  })

  it('getActiveParagraph returns null when selection is outside editor', () => {
    const outside = document.createElement('div')
    outside.appendChild(document.createTextNode('outside text'))
    document.body.appendChild(outside)
    const sel = document.createRange()
    sel.selectNode(outside.firstChild)
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      anchorNode: outside.firstChild,
      getRangeAt: () => sel,
    })
    expect(format.getActiveParagraph()).toBeNull()
    document.body.removeChild(outside)
  })

  it('getActiveParagraph finds paragraph when selection is inside editor', () => {
    const sheet = editorRef.value.$el
    const para = document.createElement('div')
    para.className = 'paragraph'
    const span = document.createElement('span')
    span.textContent = 'hello'
    para.appendChild(span)
    sheet.appendChild(para)
    const sel = document.createRange()
    sel.selectNode(span.firstChild)
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      anchorNode: span.firstChild,
      getRangeAt: () => sel,
    })
    Object.defineProperty(document, 'activeElement', { value: sheet, configurable: true })
    const found = format.getActiveParagraph()
    expect(found).toBe(para)
    sheet.removeChild(para)
  })

  it('syncFormatState reads paragraph computed styles', () => {
    const sheet = editorRef.value.$el
    const para = document.createElement('div')
    para.className = 'paragraph'
    para.style.fontWeight = '700'
    para.style.fontStyle = 'italic'
    para.style.textDecorationLine = 'underline'
    para.appendChild(document.createTextNode('styled'))
    sheet.appendChild(para)
    const sel = document.createRange()
    sel.selectNode(para.firstChild)
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      anchorNode: para.firstChild,
      getRangeAt: () => sel,
    })
    Object.defineProperty(document, 'activeElement', { value: document.body, configurable: true })
    format.syncFormatState()
    expect(format.formats.bold).toBe(true)
    expect(format.formats.italic).toBe(true)
    expect(format.formats.underline).toBe(true)
    sheet.removeChild(para)
  })

  it('syncFormatState reads run-level computed styles', () => {
    const sheet = editorRef.value.$el
    const para = document.createElement('div')
    para.className = 'paragraph'
    const run = document.createElement('span')
    run.style.fontWeight = 'bold'
    run.textContent = 'run text'
    para.appendChild(run)
    sheet.appendChild(para)
    const sel = document.createRange()
    sel.selectNode(run.firstChild)
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      anchorNode: run.firstChild,
      getRangeAt: () => sel,
    })
    Object.defineProperty(document, 'activeElement', { value: document.body, configurable: true })
    format.syncFormatState()
    expect(format.formats.bold).toBe(true)
    sheet.removeChild(para)
  })

  it('updateSelectedWordCount ignores whitespace-only selection', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => '   ',
      isCollapsed: false,
    })
    format.updateSelectedWordCount()
    expect(format.selectedWordCount.value).toBe(0)
  })

  it('toggleFormat returns early when no editor sheet exists', () => {
    editorRef.value.$el = null
    Object.defineProperty(document, 'activeElement', { value: document.body, configurable: true })
    format.toggleFormat('bold')
    expect(document.execCommand).not.toHaveBeenCalled()
  })

  it('setFont accepts any family string', () => {
    format.setFont('Unknown Family')
    expect(format.editorFont.value).toBe('Unknown Family')
    expect(markModified).toHaveBeenCalled()
  })

  it('savePrefs does nothing for unknown font family', () => {
    format.editorFont.value = 'Unknown Family'
    format.savePrefs()
    expect(localStorageMock.setItem).not.toHaveBeenCalledWith('finewrite-font', expect.anything())
  })

  it('loadPrefs keeps default when no saved font exists', () => {
    localStorageMock.getItem.mockReturnValue(null)
    const freshFormat = useFormat(editorRef, markModified)
    freshFormat.loadPrefs()
    expect(freshFormat.editorFont.value).toContain('Inter')
  })
})
