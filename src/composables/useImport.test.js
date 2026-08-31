import { describe, it, expect } from 'vitest'
import { deduplicateSectionTitle } from './useImport.js'

// The importer stores only a chapter's subtitle in `title`; the "Chapter N: "
// prefix is derived at render time. Google Docs exports bake that prefix into
// the heading text, so deduplicateSectionTitle strips the redundant prefix.
// These tests cover the pure helper only — importDocx/importOdt need DOM +
// mammoth/jszip and are exercised elsewhere.

describe('deduplicateSectionTitle', () => {
  it('strips a pure "Chapter N: Chapter N" duplicate to empty (chapter)', () => {
    expect(deduplicateSectionTitle('Chapter 2: Chapter 2', 'chapter')).toBe('')
  })

  it('matches case-insensitively on the word and number', () => {
    expect(deduplicateSectionTitle('chapter 2: chapter 2', 'chapter')).toBe('')
  })

  it('strips a bare "Chapter N" (no subtitle) to empty (chapter)', () => {
    expect(deduplicateSectionTitle('Chapter 2', 'chapter')).toBe('')
  })

  it('preserves the real subtitle after a "Chapter N:" prefix (chapter)', () => {
    expect(deduplicateSectionTitle('Chapter 2: The Beginning', 'chapter')).toBe('The Beginning')
  })

  it('tolerates a hyphen separator and extra whitespace (chapter)', () => {
    expect(deduplicateSectionTitle('Chapter  3 - Three', 'chapter')).toBe('Three')
  })

  it('leaves a chapter title with no recognizable prefix unchanged (chapter)', () => {
    expect(deduplicateSectionTitle('The Beginning', 'chapter')).toBe('The Beginning')
  })

  it('does not deduplicate section-type titles (no derived prefix to clash with)', () => {
    // A section-type section renders its title literally, so even a string
    // that looks like a chapter prefix must be preserved verbatim — it may be
    // a legitimately-titled section referencing another chapter.
    expect(deduplicateSectionTitle('Chapter 2: Chapter 2', 'section')).toBe('Chapter 2: Chapter 2')
  })

  it('leaves a normal section title unchanged (section)', () => {
    expect(deduplicateSectionTitle('Introduction', 'section')).toBe('Introduction')
  })
})