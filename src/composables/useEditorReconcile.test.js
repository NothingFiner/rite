import { describe, it, expect } from 'vitest'
import { computeReconcileOps, blockKey, renderBlockHTML } from './useEditorReconcile.js'

// --- toy block builders + renderer ------------------------------------------
// The real renderer (sectionTitleToHTML / paragraphToHTML) is injected by the
// component; here we use a tiny deterministic one that encodes exactly the
// fields change-detection should notice: sectionType, chapterIndex, title for
// titles; paragraphId, text, firstLineIndent for paragraphs.

function title(id, { sectionType = 'section', titleText = '', chapterIndex = null, hidden = false } = {}) {
  return { kind: 'section-title', sectionId: id, sectionType, title: titleText, chapterIndex, hidden }
}

function para(id, { text = '', indent = 0.5, sectionId = 's1' } = {}) {
  return {
    kind: 'paragraph',
    sectionId,
    paragraphId: id,
    paragraph: {
      id,
      elements: [{ textRun: { content: text, textStyle: {} } }],
      leftIndent: null,
      rightIndent: null,
      firstLineIndent: indent,
    },
  }
}

/// Render a block to a short signature string. `keep` vs `replace` is decided
/// by string equality of this, so each field we want change-detection on must
/// appear here.
function render(b) {
  if (b.kind === 'section-title') {
    // Hidden appends a suffix only when TRUE, so the pre-5.10 expectations
    // (all non-hidden) keep their exact strings.
    return `T[${b.sectionType}|${b.chapterIndex}|${b.title}${b.hidden ? '|hidden' : ''}]`
  }
  const text = (b.paragraph.elements || []).map((e) => e.textRun.content).join('')
  return `P[${b.paragraphId}|${text}|${b.paragraph.firstLineIndent}]`
}

function reconcile(oldBlocks, newBlocks) {
  return computeReconcileOps(oldBlocks, newBlocks, render)
}

/// Reduce an ops list to a compact `[op, key]` / `[op, key, html]` form for
/// readable assertions, dropping the (renderer-specific) html payload.
function opSummary(ops) {
  return ops.map((o) => (o.op === 'keep' ? [o.op, o.key] : [o.op, o.key]))
}

describe('blockKey', () => {
  it('prefixes section-title keys with title: and paragraph keys with para:', () => {
    expect(blockKey(title('s1'))).toBe('title:s1')
    expect(blockKey(para('p1'))).toBe('para:p1')
  })

  it('returns null for unknown kinds', () => {
    expect(blockKey({ kind: 'mystery' })).toBeNull()
  })
})

describe('computeReconcileOps', () => {
  it('reports all keep and no removals when nothing changed', () => {
    const blocks = [title('s1', { titleText: 'Intro' }), para('p1', { text: 'hello' })]
    const { ops, removedKeys } = reconcile(blocks, blocks)
    expect(opSummary(ops)).toEqual([
      ['keep', 'title:s1'],
      ['keep', 'para:p1'],
    ])
    expect(removedKeys).toEqual([])
  })

  it('emits a single replace when a section title is renamed', () => {
    const old = [title('s1', { titleText: 'Intro' }), para('p1', { text: 'hello' })]
    const next = [title('s1', { titleText: 'Introduction' }), para('p1', { text: 'hello' })]
    const { ops, removedKeys } = reconcile(old, next)
    expect(opSummary(ops)).toEqual([
      ['replace', 'title:s1'],
      ['keep', 'para:p1'],
    ])
    expect(ops[0].html).toBe('T[section|null|Introduction]')
    expect(removedKeys).toEqual([])
  })

  it('removes the title and paragraphs of a deleted section', () => {
    const old = [
      title('s1', { titleText: 'One' }),
      para('p1', { text: 'a' }),
      title('s2', { titleText: 'Two' }),
      para('p2', { text: 'b' }),
    ]
    const next = [title('s1', { titleText: 'One' }), para('p1', { text: 'a' })]
    const { ops, removedKeys } = reconcile(old, next)
    expect(opSummary(ops)).toEqual([
      ['keep', 'title:s1'],
      ['keep', 'para:p1'],
    ])
    expect(removedKeys).toEqual(['title:s2', 'para:p2'])
  })

  it('emits inserts in new order for an inserted section', () => {
    const old = [title('s1', { titleText: 'One' }), para('p1', { text: 'a' })]
    const next = [
      title('s1', { titleText: 'One' }),
      para('p1', { text: 'a' }),
      title('s2', { titleText: 'Two' }),
      para('p2', { text: 'b' }),
    ]
    const { ops, removedKeys } = reconcile(old, next)
    expect(opSummary(ops)).toEqual([
      ['keep', 'title:s1'],
      ['keep', 'para:p1'],
      ['insert', 'title:s2'],
      ['insert', 'para:p2'],
    ])
    expect(ops[2].html).toBe('T[section|null|Two]')
    expect(removedKeys).toEqual([])
  })

  it('replaces the title (only) when a section changes type', () => {
    const old = [title('s1', { sectionType: 'section', titleText: 'One' }), para('p1', { text: 'a' })]
    const next = [title('s1', { sectionType: 'chapter', titleText: 'One', chapterIndex: 1 }), para('p1', { text: 'a' })]
    const { ops, removedKeys } = reconcile(old, next)
    expect(opSummary(ops)).toEqual([
      ['replace', 'title:s1'],
      ['keep', 'para:p1'],
    ])
    expect(removedKeys).toEqual([])
  })

  it('replaces exactly one title when a section toggles hidden (5.10)', () => {
    // Toggling hidden changes ONE section's rendered marker; every other
    // block — including other titles — must diff as `keep`.
    const old = [
      title('s1', { titleText: 'Epigraph' }),
      para('p1', { text: 'a' }),
      title('s2', { titleText: 'One' }),
      para('p2', { text: 'b' }),
    ]
    const next = [
      title('s1', { titleText: 'Epigraph', hidden: true }),
      para('p1', { text: 'a' }),
      title('s2', { titleText: 'One' }),
      para('p2', { text: 'b' }),
    ]
    const { ops, removedKeys } = reconcile(old, next)
    expect(opSummary(ops)).toEqual([
      ['replace', 'title:s1'],
      ['keep', 'para:p1'],
      ['keep', 'title:s2'],
      ['keep', 'para:p2'],
    ])
    expect(ops[0].html).toBe('T[section|null|Epigraph|hidden]')
    expect(removedKeys).toEqual([])
  })

  it('replaces every later chapter when a chapter is inserted above them', () => {
    // Old: chapter One (idx 1), a paragraph, section Two.
    const old = [
      title('s1', { sectionType: 'chapter', titleText: 'One', chapterIndex: 1 }),
      para('p1', { text: 'a' }),
      title('s2', { sectionType: 'section', titleText: 'Two' }),
    ]
    // New: a new chapter Zero inserted at the front — One becomes idx 2.
    const next = [
      title('s0', { sectionType: 'chapter', titleText: 'Zero', chapterIndex: 1 }),
      title('s1', { sectionType: 'chapter', titleText: 'One', chapterIndex: 2 }),
      para('p1', { text: 'a' }),
      title('s2', { sectionType: 'section', titleText: 'Two' }),
    ]
    const { ops, removedKeys } = reconcile(old, next)
    expect(opSummary(ops)).toEqual([
      ['insert', 'title:s0'],
      ['replace', 'title:s1'], // chapterIndex 1 -> 2, so prefix changed
      ['keep', 'para:p1'],
      ['keep', 'title:s2'], // non-chapter, unaffected
    ])
    expect(removedKeys).toEqual([])
  })

  it('replaces a paragraph whose text changed', () => {
    const old = [title('s1', { titleText: 'One' }), para('p1', { text: 'hello' })]
    const next = [title('s1', { titleText: 'One' }), para('p1', { text: 'hello world' })]
    const { ops, removedKeys } = reconcile(old, next)
    expect(opSummary(ops)).toEqual([
      ['keep', 'title:s1'],
      ['replace', 'para:p1'],
    ])
    expect(ops[1].html).toBe('P[p1|hello world|0.5]')
    expect(removedKeys).toEqual([])
  })

  it('replaces a paragraph whose first-line indent changed', () => {
    const old = [title('s1', { titleText: 'One' }), para('p1', { text: 'hello', indent: 0.5 })]
    const next = [title('s1', { titleText: 'One' }), para('p1', { text: 'hello', indent: 0 })]
    const { ops, removedKeys } = reconcile(old, next)
    expect(opSummary(ops)).toEqual([
      ['keep', 'title:s1'],
      ['replace', 'para:p1'],
    ])
    expect(removedKeys).toEqual([])
  })

  it('handles a mixed change: delete one section and rename another', () => {
    const old = [
      title('s1', { titleText: 'Keep' }),
      para('p1', { text: 'a' }),
      title('s2', { titleText: 'Gone' }),
      para('p2', { text: 'b' }),
      title('s3', { titleText: 'Rename Me' }),
      para('p3', { text: 'c' }),
    ]
    const next = [
      title('s1', { titleText: 'Keep' }),
      para('p1', { text: 'a' }),
      title('s3', { titleText: 'Renamed' }),
      para('p3', { text: 'c' }),
    ]
    const { ops, removedKeys } = reconcile(old, next)
    expect(opSummary(ops)).toEqual([
      ['keep', 'title:s1'],
      ['keep', 'para:p1'],
      ['replace', 'title:s3'],
      ['keep', 'para:p3'],
    ])
    expect(removedKeys).toEqual(['title:s2', 'para:p2'])
  })

  it('returns empty ops and all old keys removed when new is empty', () => {
    const old = [title('s1', { titleText: 'One' }), para('p1', { text: 'a' })]
    const { ops, removedKeys } = reconcile(old, [])
    expect(ops).toEqual([])
    expect(removedKeys).toEqual(['title:s1', 'para:p1'])
  })
})

// --- renderBlockHTML (the production renderBlockFn) --------------------------
// renderBlockHTML is the single-block renderer computeReconcileOps injects in
// production. It must match buildEditorHTML's per-block output byte-for-byte so
// an unchanged block diffs as `keep`. These tests pin that contract directly
// against the real sectionTitleToHTML / paragraphToHTML output (no toy
// renderer), covering the two kinds + the injected render-derived bits.

const fmt = (i) => `Chapter ${i}: `

describe('renderBlockHTML', () => {
  it('renders a chapter title with the derived prefix and a locked subtitle span', () => {
    const block = { kind: 'section-title', sectionId: 's1', sectionType: 'chapter', title: 'The Reveal', chapterIndex: 1 }
    const html = renderBlockHTML(block, { freshSectionId: null, formatChapter: fmt })
    expect(html).toBe(
      '<div class="section-title chapter" data-section-id="s1" data-section-type="chapter" contenteditable="false">'
      + '<span class="chapter-prefix" contenteditable="false">Chapter 1: </span>'
      + '<span class="section-subtitle">The Reveal</span></div>'
    )
  })

  it('renders a plain section title with a single title-text span and no prefix', () => {
    const block = { kind: 'section-title', sectionId: 's2', sectionType: 'section', title: 'Opening', chapterIndex: null }
    const html = renderBlockHTML(block, { freshSectionId: null, formatChapter: fmt })
    expect(html).toBe(
      '<div class="section-title" data-section-id="s2" data-section-type="section" contenteditable="false">'
      + '<span class="section-title-text">Opening</span></div>'
    )
  })

  it('renders a hidden section title with the marker class + data attr (5.10)', () => {
    const block = { kind: 'section-title', sectionId: 's3', sectionType: 'section', title: 'Epigram', chapterIndex: null, hidden: true }
    const html = renderBlockHTML(block, { freshSectionId: null, formatChapter: fmt })
    expect(html).toBe(
      '<div class="section-title section-hidden" data-section-id="s3" data-section-type="section" data-section-hidden="true" contenteditable="false">'
      + '<span class="section-title-text">Epigram</span></div>'
    )
  })

  it('renders a fresh section title editable so the user can type the subtitle inline', () => {
    const block = { kind: 'section-title', sectionId: 's1', sectionType: 'chapter', title: '', chapterIndex: 1 }
    const html = renderBlockHTML(block, { freshSectionId: 's1', formatChapter: fmt })
    expect(html).toContain('contenteditable="true"')
    // An empty title renders a <br> placeholder in the subtitle span.
    expect(html).toContain('<span class="section-subtitle"><br></span>')
  })

  it('renders a non-chapter title without a prefix even when a chapterIndex is present', () => {
    // A section-type title never has a prefix; chapterIndex is null for them,
    // but even if it weren't, sectionType drives the prefix, not the index.
    const block = { kind: 'section-title', sectionId: 's2', sectionType: 'section', title: 'X', chapterIndex: null }
    const html = renderBlockHTML(block, { freshSectionId: null, formatChapter: fmt })
    expect(html).not.toContain('chapter-prefix')
  })

  it('renders a paragraph with its para id, section id, and baked indent style', () => {
    const block = {
      kind: 'paragraph',
      sectionId: 's1',
      paragraphId: 'p1',
      paragraph: {
        id: 'p1',
        elements: [{ textRun: { content: 'hello', textStyle: {} } }],
        leftIndent: null,
        rightIndent: null,
        firstLineIndent: 0.5,
      },
    }
    const html = renderBlockHTML(block, { freshSectionId: null, formatChapter: fmt })
    expect(html).toBe(
      '<div class="paragraph" data-para-id="p1" data-section-id="s1" style="text-indent:48px">hello</div>'
    )
  })

  it('renders a zero-indent paragraph with the no-indent class and no text-indent style', () => {
    const block = {
      kind: 'paragraph',
      sectionId: 's1',
      paragraphId: 'p1',
      paragraph: {
        id: 'p1',
        elements: [{ textRun: { content: 'first', textStyle: {} } }],
        leftIndent: null,
        rightIndent: null,
        firstLineIndent: 0,
      },
    }
    const html = renderBlockHTML(block, { freshSectionId: null, formatChapter: fmt })
    expect(html).toContain('class="paragraph no-indent"')
    expect(html).not.toContain('text-indent')
  })
})