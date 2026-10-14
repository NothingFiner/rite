import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import {
  useEditorReadback,
  isNonContentBlock, parseParagraphElement, readSectionTitleText, domToBlocks,
  bakeChapterIndices, blockPlainText, adjustOffsetForReplace,
} from './useEditorReadback.js'

// Pure helpers that touch only the DOM (isNonContentBlock, readSectionTitleText,
// bakeChapterIndices, blockPlainText, adjustOffsetForReplace, domToBlocks) are
// fully testable in jsdom. parseParagraphElement is tested on its jsdom-faithful
// paths (text nodes, search-highlight spans, id readback); the styled-run
// branch depends on getComputedStyle fidelity and is covered by the e2e typing
// tests. The factory's fullSyncFromDOM (whole-sheet readback, no Selection) is
// tested directly; syncFromDOM's localized happy path needs a live caret and is
// e2e-covered, while its fallback paths (no selection / structural drift) are
// tested here.

describe('useEditorReadback — pure helpers', () => {
  describe('isNonContentBlock', () => {
    it('flags the page-break line, page-number label, and sentinel', () => {
      const make = (cls) => { const d = document.createElement('div'); d.className = cls; return d }
      expect(isNonContentBlock(make('page-break-line'))).toBe(true)
      expect(isNonContentBlock(make('page-number-label'))).toBe(true)
      expect(isNonContentBlock(make('editor-sentinel'))).toBe(true)
    })

    it('does not flag real content blocks', () => {
      const para = document.createElement('div'); para.className = 'paragraph'
      const title = document.createElement('div'); title.className = 'section-title'
      expect(isNonContentBlock(para)).toBe(false)
      expect(isNonContentBlock(title)).toBe(false)
    })
  })

  describe('readSectionTitleText', () => {
    it('reads the .section-subtitle span for a chapter (prefix is derived, never read)', () => {
      const el = document.createElement('div')
      el.className = 'section-title'
      el.dataset.sectionType = 'chapter'
      el.innerHTML = '<span class="chapter-prefix">Chapter 1:</span><span class="section-subtitle"> The Reveal </span>'
      expect(readSectionTitleText(el)).toBe('The Reveal')
    })

    it('reads the .section-title-text span for a section', () => {
      const el = document.createElement('div')
      el.className = 'section-title'
      el.dataset.sectionType = 'section'
      el.innerHTML = '<span class="section-title-text">Opening</span>'
      expect(readSectionTitleText(el)).toBe('Opening')
    })

    it('returns empty string when the editable span is absent', () => {
      const el = document.createElement('div')
      el.className = 'section-title'
      el.dataset.sectionType = 'section'
      expect(readSectionTitleText(el)).toBe('')
    })

    it('returns empty string for a subtitle-less chapter rendered with no subtitle span (5.9)', () => {
      // A chapter with no subtitle renders ONLY the prefix span — readback
      // must read '' (matching the stored empty title), never wipe or
      // misread the derived prefix.
      const el = document.createElement('div')
      el.className = 'section-title'
      el.dataset.sectionType = 'chapter'
      el.innerHTML = '<span class="chapter-prefix" contenteditable="false">Chapter 3</span>'
      expect(readSectionTitleText(el)).toBe('')
    })
  })

  describe('bakeChapterIndices', () => {
    it('stamps a 1-based running chapterIndex on chapters and null on sections', () => {
      const blocks = [
        { kind: 'section-title', sectionType: 'chapter' },
        { kind: 'paragraph' },
        { kind: 'section-title', sectionType: 'section' },
        { kind: 'section-title', sectionType: 'chapter' },
      ]
      bakeChapterIndices(blocks)
      expect(blocks[0].chapterIndex).toBe(1)
      expect(blocks[1].chapterIndex).toBeUndefined() // paragraphs are untouched
      expect(blocks[2].chapterIndex).toBe(null)
      expect(blocks[3].chapterIndex).toBe(2)
    })

    it('is idempotent — re-baking yields the same values', () => {
      const blocks = [
        { kind: 'section-title', sectionType: 'chapter' },
        { kind: 'section-title', sectionType: 'chapter' },
      ]
      bakeChapterIndices(blocks)
      const first = blocks.map(b => b.chapterIndex)
      bakeChapterIndices(blocks)
      expect(blocks.map(b => b.chapterIndex)).toEqual(first)
    })
  })

  describe('blockPlainText', () => {
    it("returns the title for a section-title block", () => {
      expect(blockPlainText({ kind: 'section-title', title: 'Hello' })).toBe('Hello')
    })

    it('returns empty string for a title-less section-title block', () => {
      expect(blockPlainText({ kind: 'section-title' })).toBe('')
    })

    it("joins a paragraph's run contents with no separator", () => {
      const block = {
        kind: 'paragraph',
        paragraph: { elements: [
          { textRun: { content: 'foo' } },
          { textRun: { content: 'bar' } },
        ] },
      }
      expect(blockPlainText(block)).toBe('foobar')
    })

    it('returns empty string for a paragraph with no elements', () => {
      expect(blockPlainText({ kind: 'paragraph', paragraph: {} })).toBe('')
    })
  })

  describe('adjustOffsetForReplace', () => {
    it('returns the offset unchanged when the texts are identical', () => {
      expect(adjustOffsetForReplace('abc', 'abc', 2)).toBe(2)
    })

    it('clamps a non-positive offset to 0', () => {
      expect(adjustOffsetForReplace('abc', 'xyz', 0)).toBe(0)
    })

    it('leaves a caret in the common prefix untouched', () => {
      // Change is in the middle; offset 1 sits in the shared "ab" prefix.
      expect(adjustOffsetForReplace('abXcd', 'abYcd', 1)).toBe(1)
    })

    it('shifts a caret in the common suffix by the net length change', () => {
      // "abXcd" → "abYYYYcd": suffix "cd" (2 chars) is common. A caret at old
      // offset 4 (between 'c' and 'd') moves to new offset 7.
      expect(adjustOffsetForReplace('abXcd', 'abYYYYcd', 4)).toBe(7)
    })

    it('lands a caret inside the replaced region at the start of the change', () => {
      // Undo: "specifications" → "big dog". A caret at offset 7 (deep in
      // "specifications") has no common prefix/suffix with "big dog", so it
      // collapses to the insertion point (0).
      expect(adjustOffsetForReplace('specifications', 'big dog', 7)).toBe(0)
    })

    it('shifts a caret past the replaced region by the net length change', () => {
      // "big dog" → "specifications": caret at offset 7 (end of "big dog") moves
      // to offset 14 (end of "specifications").
      expect(adjustOffsetForReplace('big dog', 'specifications', 7)).toBe(14)
    })
  })
})

describe('useEditorReadback — DOM walkers', () => {
  let root

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  afterEach(() => {
    if (root.parentNode) root.parentNode.removeChild(root)
  })

  describe('parseParagraphElement', () => {
    it('turns a text-node paragraph into one textRun carrying the text', () => {
      const p = document.createElement('div')
      p.className = 'paragraph'
      p.dataset.paraId = 'p1'
      p.textContent = 'Hello world'
      const parsed = parseParagraphElement(p, 16)
      expect(parsed.id).toBe('p1')
      expect(parsed.elements).toHaveLength(1)
      expect(parsed.elements[0].textRun.content).toBe('Hello world')
    })

    it('synthesizes an empty textRun for a blank paragraph', () => {
      const p = document.createElement('div')
      p.className = 'paragraph'
      const parsed = parseParagraphElement(p, 16)
      expect(parsed.elements).toHaveLength(1)
      expect(parsed.elements[0].textRun.content).toBe('')
    })

    it('preserves the text of a search-highlight span as a plain textRun', () => {
      const p = document.createElement('div')
      p.className = 'paragraph'
      p.innerHTML = '<span class="search-highlight">match</span>'
      const parsed = parseParagraphElement(p, 16)
      expect(parsed.elements[0].textRun.content).toBe('match')
    })

    it('generates an id when the paragraph has no data-para-id', () => {
      const p = document.createElement('div')
      p.className = 'paragraph'
      p.textContent = 'x'
      const parsed = parseParagraphElement(p, 16)
      expect(parsed.id).toBeTruthy()
    })
  })

  describe('domToBlocks', () => {
    it('walks a flat section-title + paragraph list into blocks, skipping decorations', () => {
      root.innerHTML = `
        <div class="section-title" data-section-id="s1" data-section-type="section">
          <span class="section-title-text">Opening</span>
        </div>
        <div class="paragraph" data-para-id="p1" data-section-id="s1">First</div>
        <hr class="page-break-line">
        <div class="paragraph" data-para-id="p2" data-section-id="s1">Second</div>
      `
      const blocks = domToBlocks(root, 16)
      expect(blocks).toHaveLength(3)
      expect(blocks[0]).toMatchObject({ kind: 'section-title', sectionId: 's1', sectionType: 'section', title: 'Opening' })
      expect(blocks[1]).toMatchObject({ kind: 'paragraph', sectionId: 's1', paragraphId: 'p1' })
      expect(blocks[1].paragraph.elements[0].textRun.content).toBe('First')
      expect(blocks[2].paragraph.elements[0].textRun.content).toBe('Second')
    })

    it('returns an empty array for an empty sheet', () => {
      expect(domToBlocks(root, 16)).toEqual([])
    })

    it('reads the hidden flag from data-section-hidden (5.10)', () => {
      // A miss here silently un-hides on the first keystroke after toggling:
      // readback groups blocks into sections, groupBlocks carries `hidden`,
      // and syncSection writes it back to the store.
      root.innerHTML = `
        <div class="section-title section-hidden" data-section-id="s1" data-section-type="section" data-section-hidden="true">
          <span class="section-title-text">Epigram</span>
        </div>
        <div class="paragraph" data-para-id="p1" data-section-id="s1">Only connect.</div>
        <div class="section-title" data-section-id="s2" data-section-type="section">
          <span class="section-title-text">Opening</span>
        </div>
      `
      const blocks = domToBlocks(root, 16)
      expect(blocks[0].hidden).toBe(true)
      // Absent attr reads as false — matches a section never toggled.
      expect(blocks[2].hidden).toBe(false)
    })
  })
})

describe('useEditorReadback — factory', () => {
  let root

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  afterEach(() => {
    if (root.parentNode) root.parentNode.removeChild(root)
  })

  // Build the factory bound to mock refs + a capturing emit, around a sheet with
  // one section (title + one paragraph).
  const makeReadback = (rootEl, { lastRenderedBlocksValue = null, lastSectionCountValue = 0 } = {}) => {
    const sheetRef = ref(rootEl)
    const modelRef = ref({ sections: [] }) // truthy guard only
    const zoomRef = ref(16)
    const lastRenderedBlocks = ref(lastRenderedBlocksValue)
    const lastSectionCount = ref(lastSectionCountValue)
    const skipNextWatcher = ref(false)
    const emitted = []
    const emit = (event, payload) => emitted.push({ event, payload })
    const { syncFromDOM, fullSyncFromDOM } = useEditorReadback({
      sheetRef, modelRef, zoomRef, lastRenderedBlocks, lastSectionCount, skipNextWatcher, emit,
    })
    return { syncFromDOM, fullSyncFromDOM, emitted, lastRenderedBlocks, lastSectionCount, skipNextWatcher }
  }

  describe('fullSyncFromDOM', () => {
    it('carries the hidden flag through the DOM→sections readback (5.10)', () => {
      root.innerHTML = `
        <div class="section-title section-hidden" data-section-id="s1" data-section-type="section" data-section-hidden="true">
          <span class="section-title-text">Epigram</span>
        </div>
        <div class="paragraph" data-para-id="p1" data-section-id="s1">Only connect.</div>
      `
      const r = makeReadback(root)
      r.fullSyncFromDOM()
      const sections = r.emitted[0].payload
      expect(sections[0].hidden).toBe(true)
    })

    it('reads the whole sheet, emits syncSections, and updates the retained baseline', () => {
      root.innerHTML = `
        <div class="section-title" data-section-id="s1" data-section-type="section">
          <span class="section-title-text">Opening</span>
        </div>
        <div class="paragraph" data-para-id="p1" data-section-id="s1">First</div>
      `
      const r = makeReadback(root)
      r.fullSyncFromDOM()

      expect(r.emitted).toHaveLength(1)
      expect(r.emitted[0].event).toBe('syncSections')
      const sections = r.emitted[0].payload
      expect(sections).toHaveLength(1)
      expect(sections[0].id).toBe('s1')
      expect(sections[0].title).toBe('Opening')
      expect(sections[0].paragraphs).toHaveLength(1)

      // Retained baseline + structural gate counters updated.
      expect(r.lastRenderedBlocks.value).toHaveLength(2)
      expect(r.lastSectionCount.value).toBe(1)
      expect(r.skipNextWatcher.value).toBe(true)
    })

    it('is a no-op on a null root', () => {
      const r = makeReadback(null)
      expect(() => r.fullSyncFromDOM()).not.toThrow()
      expect(r.emitted).toHaveLength(0)
    })

    it('is a no-op on a falsy model', () => {
      const sheetRef = ref(root)
      const modelRef = ref(null)
      const { fullSyncFromDOM } = useEditorReadback({
        sheetRef, modelRef, zoomRef: ref(16), lastRenderedBlocks: ref(null),
        lastSectionCount: ref(0), skipNextWatcher: ref(false),
        emit: () => { throw new Error('should not emit') },
      })
      expect(() => fullSyncFromDOM()).not.toThrow()
    })
  })

  describe('syncFromDOM fallbacks', () => {
    it('falls back to the full readback when no section is at the cursor (no selection)', () => {
      const sel = window.getSelection()
      if (sel) sel.removeAllRanges()
      root.innerHTML = `
        <div class="section-title" data-section-id="s1" data-section-type="section">
          <span class="section-title-text">Opening</span>
        </div>
        <div class="paragraph" data-para-id="p1" data-section-id="s1">First</div>
      `
      const r = makeReadback(root)
      r.syncFromDOM()
      // No selection → getSectionIdAtCursor() is null → fullSyncFromDOM emits syncSections.
      expect(r.emitted.some(e => e.event === 'syncSections')).toBe(true)
    })

    it('falls back to the full readback when the section-title count drifted', () => {
      const sel = window.getSelection()
      if (sel) sel.removeAllRanges()
      root.innerHTML = `
        <div class="section-title" data-section-id="s1" data-section-type="section">
          <span class="section-title-text">Opening</span>
        </div>
        <div class="paragraph" data-para-id="p1" data-section-id="s1">First</div>
      `
      // Baseline claims 2 section-titles but the live DOM has 1 → structural gate fires.
      const r = makeReadback(root, { lastRenderedBlocksValue: [], lastSectionCountValue: 2 })
      r.syncFromDOM()
      expect(r.emitted.some(e => e.event === 'syncSections')).toBe(true)
    })

    it('is a no-op on a null root', () => {
      const r = makeReadback(null)
      expect(() => r.syncFromDOM()).not.toThrow()
      expect(r.emitted).toHaveLength(0)
    })
  })
})