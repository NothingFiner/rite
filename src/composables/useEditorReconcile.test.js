import { describe, it, expect } from 'vitest'
import { computeReconcileOps, blockKey } from './useEditorReconcile.js'

// --- toy block builders + renderer ------------------------------------------
// The real renderer (sectionTitleToHTML / paragraphToHTML) is injected by the
// component; here we use a tiny deterministic one that encodes exactly the
// fields change-detection should notice: sectionType, chapterIndex, title for
// titles; paragraphId, text, firstLineIndent for paragraphs.

function title(id, { sectionType = 'section', titleText = '', chapterIndex = null } = {}) {
  return { kind: 'section-title', sectionId: id, sectionType, title: titleText, chapterIndex }
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
    return `T[${b.sectionType}|${b.chapterIndex}|${b.title}]`
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