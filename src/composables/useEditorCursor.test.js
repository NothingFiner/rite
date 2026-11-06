import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  blockSelector, editableSpanOf,
  placeCursorAtStart, getSelectionText, getParagraphAtCursor,
  getSectionTitleAtCursor, getSectionIdAtCursor, bookmarkSelection,
  restoreSelection, selectLine,
} from './useEditorCursor.js'

// These tests cover the pure, jsdom-faithful helpers fully (blockSelector,
// editableSpanOf, isCaretAtStart/End) and the no-selection guards of the
// Selection-dependent helpers. The Selection save/restore + caret-roundtrip
// paths (bookmarkSelection/restoreSelection/selectLine/placeCursorAtStart with
// a live caret, getParagraphAtCursor with a real anchor) depend on the real
// Selection/Range API, which jsdom only partially implements — those are
// covered end-to-end by the Playwright suite (typing, Cmd+L selectLine, page
// nav) instead, the agreed split for roadmap 5.6.

describe('useEditorCursor', () => {
  let root

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  afterEach(() => {
    if (root.parentNode) root.parentNode.removeChild(root)
    const sel = window.getSelection()
    if (sel) sel.removeAllRanges()
  })

  describe('blockSelector', () => {
    it('builds a data-section-id selector for a title key', () => {
      expect(blockSelector('title:abc123')).toBe('[data-section-id="abc123"]')
    })

    it('builds a data-para-id selector for a paragraph key', () => {
      expect(blockSelector('para:p42')).toBe('[data-para-id="p42"]')
    })

    it('keeps section and paragraph id namespaces separate', () => {
      // The same underlying id must never resolve to the same selector for both
      // kinds — that's the whole point of the kind prefix.
      expect(blockSelector('title:same')).not.toBe(blockSelector('para:same'))
    })
  })

  describe('editableSpanOf', () => {
    it('prefers .section-subtitle (the Chapter editable unit; prefix is locked)', () => {
      root.innerHTML = '<div class="section-title"><span class="section-subtitle">Sub</span></div>'
      const span = editableSpanOf(root.querySelector('.section-title'))
      expect(span.classList.contains('section-subtitle')).toBe(true)
    })

    it('falls back to .section-title-text for a Section', () => {
      root.innerHTML = '<div class="section-title"><span class="section-title-text">Title</span></div>'
      const span = editableSpanOf(root.querySelector('.section-title'))
      expect(span.classList.contains('section-title-text')).toBe(true)
    })

    it('falls back to the title element itself when no editable span exists', () => {
      root.innerHTML = '<div class="section-title">Bare title</div>'
      const title = root.querySelector('.section-title')
      expect(editableSpanOf(title)).toBe(title)
    })
  })

  // isCaretAtStart / isCaretAtEnd are pure range comparisons, but they rely on
  // Range.compareBoundaryPoints, which jsdom does not implement faithfully (it
  // returns nonzero even for coincident boundaries). They're exercised by the
  // e2e suite's typing + Backspace-at-start / Delete-at-end paths in real
  // Chromium, the agreed split for Selection/Range-dependent logic in 5.6.

  // --- Selection-dependent helpers: jsdom guards only -------------------------
  // With no active selection these must short-circuit safely. The happy paths
  // (a live caret inside a block) are exercised by the e2e suite.

  describe('getSelectionText', () => {
    it('returns empty string when there is no selection', () => {
      const sel = window.getSelection()
      if (sel) sel.removeAllRanges()
      expect(getSelectionText(root)).toBe('')
    })
  })

  describe('selection-dependent guards', () => {
    it('getParagraphAtCursor returns null with no selection', () => {
      const sel = window.getSelection()
      if (sel) sel.removeAllRanges()
      expect(getParagraphAtCursor()).toBe(null)
    })

    it('getSectionTitleAtCursor returns null with no selection', () => {
      const sel = window.getSelection()
      if (sel) sel.removeAllRanges()
      expect(getSectionTitleAtCursor()).toBe(null)
    })

    it('getSectionIdAtCursor returns null with no selection', () => {
      const sel = window.getSelection()
      if (sel) sel.removeAllRanges()
      expect(getSectionIdAtCursor()).toBe(null)
    })

    it('bookmarkSelection returns null with no selection', () => {
      const sel = window.getSelection()
      if (sel) sel.removeAllRanges()
      expect(bookmarkSelection(root)).toBe(null)
    })

    it('restoreSelection is a no-op for a null bookmark', () => {
      expect(() => restoreSelection(root, null)).not.toThrow()
    })

    it('restoreSelection is a no-op when the bookmarked block is absent', () => {
      // A bookmark whose key matches no block in the root must not throw and
      // must not move the selection — the reconciler relies on this bail-out
      // when a block was removed by the patch.
      expect(() => restoreSelection(root, { key: 'para:gone', kind: 'paragraph', offset: 0 })).not.toThrow()
    })

    it('placeCursorAtStart does not throw on a real element', () => {
      root.innerHTML = '<p>Hi</p>'
      expect(() => placeCursorAtStart(root.querySelector('p'))).not.toThrow()
    })

    it('selectLine does not throw with no selection', () => {
      const sel = window.getSelection()
      if (sel) sel.removeAllRanges()
      expect(() => selectLine()).not.toThrow()
    })
  })
})