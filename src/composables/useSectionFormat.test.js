import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSectionFormat, resetSectionFormatForTests } from './useSectionFormat.js'

const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => { store[key] = String(value) }),
    clear: () => { store = {} },
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

beforeEach(() => {
  localStorageMock.clear()
  vi.clearAllMocks()
  resetSectionFormatForTests()
})

describe('useSectionFormat', () => {
  it('has a default format (Chapter prefix, arabic numbering)', () => {
    const sf = useSectionFormat()
    expect(sf.sectionFormat.value.prefix).toBe('Chapter')
    expect(sf.sectionFormat.value.numbering).toBe('arabic')
  })

  it('formats an arabic chapter prefix with trailing separator', () => {
    const sf = useSectionFormat()
    expect(sf.formatChapter(3)).toBe('Chapter 3: ')
    expect(sf.formatChapter(12)).toBe('Chapter 12: ')
  })

  it('formats a roman chapter prefix', () => {
    const sf = useSectionFormat()
    sf.setFormat({ numbering: 'roman' })
    expect(sf.formatChapter(3)).toBe('Chapter III: ')
    expect(sf.formatChapter(14)).toBe('Chapter XIV: ')
    expect(sf.formatChapter(1)).toBe('Chapter I: ')
    expect(sf.formatChapter(4)).toBe('Chapter IV: ')
    expect(sf.formatChapter(9)).toBe('Chapter IX: ')
  })

  it('uses a custom prefix', () => {
    const sf = useSectionFormat()
    sf.setFormat({ prefix: 'Part' })
    expect(sf.formatChapter(2)).toBe('Part 2: ')
  })

  it('saves the format to localStorage', () => {
    const sf = useSectionFormat()
    sf.setFormat({ prefix: 'Book' })
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'rite-section-format',
      expect.stringContaining('Book')
    )
  })

  it('loads a saved format', () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify({
      prefix: 'Book',
      numbering: 'roman',
    }))
    const sf = useSectionFormat()
    sf.loadPrefs()
    expect(sf.sectionFormat.value.prefix).toBe('Book')
    expect(sf.sectionFormat.value.numbering).toBe('roman')
  })

  it('merges a loaded format with defaults', () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify({ prefix: 'Book' }))
    const sf = useSectionFormat()
    sf.loadPrefs()
    expect(sf.sectionFormat.value.prefix).toBe('Book')
    // numbering falls back to the default
    expect(sf.sectionFormat.value.numbering).toBe('arabic')
  })

  it('shares one format across callers (module-level singleton)', () => {
    const a = useSectionFormat()
    const b = useSectionFormat()
    a.setFormat({ prefix: 'Tome' })
    expect(b.sectionFormat.value.prefix).toBe('Tome')
    expect(b.formatChapter(1)).toBe('Tome 1: ')
  })
})