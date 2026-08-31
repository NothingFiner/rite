import { describe, it, expect } from 'vitest'
import { contentPageNumberFromKey, contentKeyForPage } from './manuscriptPageMap.js'

// The manuscript's front-matter ↔ content-page mapping (5.1b). Content pages
// are keyed `content-${i}` (0-based i), header shows i+1 — the shared
// pagination page number. Front matter (title/toc/epigram) has no page number.

describe('contentPageNumberFromKey', () => {
  it('maps content-0 → page 1 (the first content page)', () => {
    expect(contentPageNumberFromKey('content-0')).toBe(1)
  })

  it('maps content-N → page N+1 for any content page', () => {
    expect(contentPageNumberFromKey('content-14')).toBe(15)
    expect(contentPageNumberFromKey('content-19')).toBe(20)
    expect(contentPageNumberFromKey('content-99')).toBe(100)
  })

  it('returns null for front-matter keys (title/toc/epigram)', () => {
    // null is the caller's signal to fall back to page 1 — front matter sits
    // above the first content page, so a switch from front matter lands on
    // page 1, not page 0.
    expect(contentPageNumberFromKey('title')).toBeNull()
    expect(contentPageNumberFromKey('toc')).toBeNull()
    expect(contentPageNumberFromKey('epigram')).toBeNull()
  })

  it('returns null for non-content / malformed keys', () => {
    expect(contentPageNumberFromKey('content-')).toBeNull()
    expect(contentPageNumberFromKey('content-abc')).toBeNull()
    expect(contentPageNumberFromKey('')).toBeNull()
    expect(contentPageNumberFromKey(null)).toBeNull()
    expect(contentPageNumberFromKey(undefined)).toBeNull()
    expect(contentPageNumberFromKey(42)).toBeNull()
  })
})

describe('contentKeyForPage', () => {
  it('maps page 1 → content-0 (editor page 1 lands on the first content page, skipping front matter)', () => {
    expect(contentKeyForPage(1)).toBe('content-0')
  })

  it('maps page N → content-N-1', () => {
    expect(contentKeyForPage(15)).toBe('content-14')
    expect(contentKeyForPage(20)).toBe('content-19')
  })

  it('clamps so a bad/zero/negative input cannot produce content--1', () => {
    expect(contentKeyForPage(0)).toBe('content-0')
    expect(contentKeyForPage(-5)).toBe('content-0')
    expect(contentKeyForPage(null)).toBe('content-0')
    expect(contentKeyForPage(undefined)).toBe('content-0')
  })
})

describe('round-trip (page ↔ key ↔ page)', () => {
  it('contentKeyForPage and contentPageNumberFromKey are inverses for valid content pages', () => {
    for (const page of [1, 2, 15, 20, 100]) {
      const key = contentKeyForPage(page)
      expect(contentPageNumberFromKey(key)).toBe(page)
    }
  })
})