import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useHeadingFormat, resetHeadingFormatsForTests } from './useHeadingFormat.js'

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
  resetHeadingFormatsForTests()
})

describe('useHeadingFormat', () => {
  it('has default formats for all 6 levels', () => {
    const hf = useHeadingFormat()
    expect(Object.keys(hf.headingFormats.value)).toHaveLength(6)
    expect(hf.headingFormats.value[1].prefix).toBe('Part')
    expect(hf.headingFormats.value[2].prefix).toBe('Chapter')
  })

  it('formats arabic heading', () => {
    const hf = useHeadingFormat()
    expect(hf.formatHeading(1, 3)).toBe('Part 3')
    expect(hf.formatHeading(2, 12)).toBe('Chapter 12')
  })

  it('formats roman heading', () => {
    const hf = useHeadingFormat()
    hf.setFormat(1, { numbering: 'roman' })
    expect(hf.formatHeading(1, 3)).toBe('Part III')
    expect(hf.formatHeading(1, 14)).toBe('Part XIV')
  })

  it('formats with no numbering', () => {
    const hf = useHeadingFormat()
    hf.setFormat(1, { numbering: 'none' })
    expect(hf.formatHeading(1, 3)).toBe('Part')
  })

  it('handles empty prefix', () => {
    const hf = useHeadingFormat()
    hf.setFormat(3, { prefix: '', numbering: 'arabic' })
    expect(hf.formatHeading(3, 5)).toBe('5')
  })

  it('handles both empty prefix and no numbering', () => {
    const hf = useHeadingFormat()
    hf.setFormat(3, { prefix: '', numbering: 'none' })
    expect(hf.formatHeading(3, 5)).toBe('')
  })

  it('saves formats to localStorage', () => {
    const hf = useHeadingFormat()
    hf.setFormat(1, { prefix: 'Section' })
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'rite-heading-formats',
      expect.stringContaining('Section')
    )
  })

  it('loads saved formats', () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify({
      1: { prefix: 'Book', numbering: 'roman', autoGenerate: true },
    }))
    const hf = useHeadingFormat()
    hf.loadPrefs()
    expect(hf.headingFormats.value[1].prefix).toBe('Book')
    expect(hf.headingFormats.value[1].numbering).toBe('roman')
  })

  it('merges loaded formats with defaults', () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify({
      1: { prefix: 'Book' },
    }))
    const hf = useHeadingFormat()
    hf.loadPrefs()
    expect(hf.headingFormats.value[1].prefix).toBe('Book')
    expect(hf.headingFormats.value[2].prefix).toBe('Chapter')
  })

  it('returns empty string for unknown level', () => {
    const hf = useHeadingFormat()
    expect(hf.formatHeading(99, 1)).toBe('')
  })

  it('converts 1 to roman I', () => {
    const hf = useHeadingFormat()
    hf.setFormat(1, { numbering: 'roman' })
    expect(hf.formatHeading(1, 1)).toBe('Part I')
  })

  it('converts 4 to roman IV', () => {
    const hf = useHeadingFormat()
    hf.setFormat(1, { numbering: 'roman' })
    expect(hf.formatHeading(1, 4)).toBe('Part IV')
  })

  it('converts 9 to roman IX', () => {
    const hf = useHeadingFormat()
    hf.setFormat(1, { numbering: 'roman' })
    expect(hf.formatHeading(1, 9)).toBe('Part IX')
  })
})
