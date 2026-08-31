import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useManuscriptFormat, resetManuscriptFormatForTests } from './useManuscriptFormat.js'
import { MANUSCRIPT_FORMATS, DEFAULT_MANUSCRIPT_FORMAT_ID } from '../constants/manuscriptFormat.js'

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
  resetManuscriptFormatForTests()
})

describe('useManuscriptFormat', () => {
  it('defaults to the standard manuscript format', () => {
    const mf = useManuscriptFormat()
    expect(mf.formatId.value).toBe(DEFAULT_MANUSCRIPT_FORMAT_ID)
    expect(mf.format.value.id).toBe('standard')
    // The standard preset is byte-identical to the old hardcoded values.
    expect(mf.format.value.pageWidth).toBe(720)
    expect(mf.format.value.pageHeight).toBe(960)
    expect(mf.format.value.pageBackground).toBe('#FFFFE3')
  })

  it('exposes all presets', () => {
    const mf = useManuscriptFormat()
    expect(mf.formats.map((f) => f.id)).toEqual(
      MANUSCRIPT_FORMATS.map((f) => f.id),
    )
  })

  it('derives contentWidth/contentHeight from page size minus both margins', () => {
    const mf = useManuscriptFormat()
    const f = mf.format.value
    expect(f.contentWidth).toBe(f.pageWidth - f.margin * 2)
    expect(f.contentHeight).toBe(f.pageHeight - f.margin * 2)
  })

  it('selectFormat changes the active format and persists the id', () => {
    const mf = useManuscriptFormat()
    mf.selectFormat('shunn')
    expect(mf.formatId.value).toBe('shunn')
    expect(mf.format.value.pageWidth).toBe(816)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('rite-manuscript-format', 'shunn')
  })

  it('selectFormat ignores an unknown id (keeps the current format)', () => {
    const mf = useManuscriptFormat()
    mf.selectFormat('legal')
    expect(mf.formatId.value).toBe(DEFAULT_MANUSCRIPT_FORMAT_ID)
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })

  it('loadPrefs restores a saved id', () => {
    localStorageMock.getItem.mockReturnValue('a4')
    const mf = useManuscriptFormat()
    mf.loadPrefs()
    expect(mf.formatId.value).toBe('a4')
    expect(mf.format.value.pageWidth).toBe(794)
  })

  it('loadPrefs ignores a stored id that no longer exists (falls back to default)', () => {
    localStorageMock.getItem.mockReturnValue('legal')
    const mf = useManuscriptFormat()
    mf.loadPrefs()
    expect(mf.formatId.value).toBe(DEFAULT_MANUSCRIPT_FORMAT_ID)
  })

  it('shares one active format across callers (module-level singleton)', () => {
    const a = useManuscriptFormat()
    const b = useManuscriptFormat()
    a.selectFormat('shunn')
    expect(b.formatId.value).toBe('shunn')
    expect(b.format.value.id).toBe('shunn')
  })

  it('resetManuscriptFormatForTests clears mutations between tests', () => {
    const a = useManuscriptFormat()
    a.selectFormat('a4')
    expect(a.formatId.value).toBe('a4')
    resetManuscriptFormatForTests()
    const b = useManuscriptFormat()
    expect(b.formatId.value).toBe(DEFAULT_MANUSCRIPT_FORMAT_ID)
  })
})