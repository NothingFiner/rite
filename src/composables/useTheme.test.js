import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTheme } from './useTheme.js'
import { ref } from 'vue'

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
})

function createTheme(viewMode = 'editor') {
  const viewModeRef = ref(viewMode)
  return useTheme(viewModeRef)
}

describe('useTheme', () => {
  it('has 10 themes', () => {
    const theme = createTheme()
    expect(theme.themes).toHaveLength(10)
  })

  it('defaults to theme 0', () => {
    const theme = createTheme()
    expect(theme.editorTheme.value).toBe(0)
  })

  it('defaults zoom to 16', () => {
    const theme = createTheme()
    expect(theme.editorZoom.value).toBe(16)
  })

  it('defaults margin to compact', () => {
    const theme = createTheme()
    expect(theme.editorMargin.value).toBe('compact')
  })

  it('computes editor UI colors from theme', () => {
    const theme = createTheme('editor')
    theme.editorTheme.value = 0
    expect(theme.uiTextPrimary.value).toBe('#515359')
    expect(theme.uiAccent.value).toBe('#B5651D')
  })

  it('computes manuscript UI colors independently', () => {
    const theme = createTheme('manuscript')
    theme.editorTheme.value = 0
    expect(theme.uiTextPrimary.value).toBe('#f0f0f5')
    expect(theme.uiAccent.value).toBe('#4f8ef7')
  })

  it('computes glass bg from theme background', () => {
    const theme = createTheme('editor')
    theme.editorTheme.value = 5 // deep navy #030027
    expect(theme.uiGlassBg.value).toContain('rgba(3, 0, 39')
  })

  it('saves theme and zoom to localStorage', () => {
    const theme = createTheme()
    theme.selectTheme(2)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('rite-theme', '2')
  })

  it('saves margin to localStorage', () => {
    const theme = createTheme()
    theme.setMargin('manuscript')
    expect(localStorageMock.setItem).toHaveBeenCalledWith('rite-margin', 'manuscript')
  })

  it('loads saved preferences', () => {
    localStorageMock.getItem.mockImplementation((key) => {
      if (key === 'rite-theme') return '3'
      if (key === 'rite-zoom') return '20'
      if (key === 'rite-margin') return 'manuscript'
      return null
    })
    const theme = createTheme()
    theme.loadPrefs()
    expect(theme.editorTheme.value).toBe(3)
    expect(theme.editorZoom.value).toBe(20)
    expect(theme.editorMargin.value).toBe('manuscript')
  })

  it('clamps out-of-range theme indices', () => {
    const theme = createTheme()
    theme.selectTheme(99)
    expect(theme.editorTheme.value).toBeLessThan(99)
    theme.selectTheme(-1)
    expect(theme.editorTheme.value).toBe(0)
  })

  it('computes light-theme glass differently', () => {
    const theme = createTheme('editor')
    theme.editorTheme.value = 3 // light theme with purple text #DBE1F1
    expect(theme.uiGlassBg.value).toContain('rgba(219, 225, 241')
  })

  it('computes manuscript scroll background', () => {
    const theme = createTheme('manuscript')
    expect(theme.uiScrollBg.value).toBe('var(--bg-base)')
  })

  it('computes editor scroll background', () => {
    const theme = createTheme('editor')
    theme.editorTheme.value = 0
    // Editor scroll layer paints the full theme bg so it matches the editor
    // sheet (no translucent tint letting the black app base show through).
    expect(theme.uiScrollBg.value).toBe('#D8D3D6')
  })

  it('computes manuscript glass border', () => {
    const theme = createTheme('manuscript')
    expect(theme.uiGlassBorder.value).toBe('rgba(255, 255, 255, 0.1)')
  })

  it('computes editor glass border from theme text', () => {
    const theme = createTheme('editor')
    theme.editorTheme.value = 0
    expect(theme.uiGlassBorder.value).toBe('#51535933')
  })

  it('computes hover backgrounds in manuscript mode', () => {
    const theme = createTheme('manuscript')
    expect(theme.uiHoverBg.value).toBe('rgba(255, 255, 255, 0.06)')
    expect(theme.uiHoverBgStrong.value).toBe('rgba(255, 255, 255, 0.12)')
  })

  it('computes input and popup backgrounds in manuscript mode', () => {
    const theme = createTheme('manuscript')
    expect(theme.uiInputBg.value).toBe('rgba(0, 0, 0, 0.25)')
    expect(theme.uiPopupBg.value).toBe('#0f0f11')
  })

  it('sets zoom and saves preference', () => {
    const theme = createTheme()
    theme.setZoom(20)
    expect(theme.editorZoom.value).toBe(20)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('rite-zoom', '20')
  })

  it('clamps loaded theme index to valid range', () => {
    localStorageMock.getItem.mockImplementation((key) => {
      if (key === 'rite-theme') return '999'
      return null
    })
    const theme = createTheme()
    theme.loadPrefs()
    expect(theme.editorTheme.value).toBeLessThan(99)
  })

  it('parses malformed zoom values from localStorage as NaN', () => {
    localStorageMock.getItem.mockImplementation((key) => {
      if (key === 'rite-zoom') return 'NaN'
      return null
    })
    const theme = createTheme()
    theme.loadPrefs()
    expect(theme.editorZoom.value).toBeNaN()
  })

  it('ignores invalid margin values from localStorage', () => {
    localStorageMock.getItem.mockImplementation((key) => {
      if (key === 'rite-margin') return 'invalid'
      return null
    })
    const theme = createTheme()
    theme.loadPrefs()
    expect(theme.editorMargin.value).toBe('compact') // default
  })

  it('hides theme picker after selection', () => {
    const theme = createTheme()
    theme.showThemePicker.value = true
    theme.selectTheme(2)
    expect(theme.showThemePicker.value).toBe(false)
  })
})
