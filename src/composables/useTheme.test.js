import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTheme } from './useTheme.js'
import { THEMES } from '../constants/themes.js'
import { ref } from 'vue'

// The theme model behind Text Options (SPEC.md 5.13). The selection is three
// colors, not an index: `editorBg`, `editorText` and `editorAccent` hold the
// chosen hex strings, and a preset is one shortcut that sets all three.
//
// The stub in useTheme.js returns the first preset's colors and ignores the
// setters. Every case below that depends on a choice is therefore red until the
// model is real.

const localStorageMock = (() => {
  let store = {}

  const defaultGet = (key) => (key in store ? store[key] : null)
  const defaultSet = (key, value) => {
    store[key] = String(value)
  }

  const getItem = vi.fn(defaultGet)
  const setItem = vi.fn(defaultSet)

  function reset() {
    store = {}
    getItem.mockReset()
    getItem.mockImplementation(defaultGet)
    setItem.mockReset()
    setItem.mockImplementation(defaultSet)
  }

  return { getItem, setItem, reset }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

beforeEach(() => {
  localStorageMock.reset()
})

function createTheme(viewMode = 'editor') {
  const viewModeRef = ref(viewMode)
  return useTheme(viewModeRef)
}

function storedPrefs(values) {
  localStorageMock.getItem.mockImplementation((key) =>
    key in values ? values[key] : null,
  )
}

describe('useTheme', () => {
  it('has 10 themes', () => {
    const theme = createTheme()
    expect(theme.themes).toHaveLength(10)
  })

  it('starts on the first theme in all three colors', () => {
    const theme = createTheme()
    expect(theme.editorBg.value).toBe(THEMES[0].bg)
    expect(theme.editorText.value).toBe(THEMES[0].text)
    expect(theme.editorAccent.value).toBe(THEMES[0].accent)
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
    theme.selectTheme(0)
    expect(theme.uiTextPrimary.value).toBe('#515359')
    expect(theme.uiAccent.value).toBe('#B5651D')
  })

  it('computes manuscript UI colors independently', () => {
    const theme = createTheme('manuscript')
    theme.selectTheme(0)
    expect(theme.uiTextPrimary.value).toBe('#f0f0f5')
    expect(theme.uiAccent.value).toBe('#4f8ef7')
  })

  it('computes glass bg from theme background', () => {
    const theme = createTheme('editor')
    theme.selectTheme(5) // deep navy #030027
    expect(theme.uiGlassBg.value).toContain('rgba(3, 0, 39')
  })

  it('computes light-theme glass differently', () => {
    const theme = createTheme('editor')
    theme.selectTheme(3) // light background #DBE1F1
    expect(theme.uiGlassBg.value).toContain('rgba(219, 225, 241')
  })

  it('computes manuscript scroll background', () => {
    const theme = createTheme('manuscript')
    expect(theme.uiScrollBg.value).toBe('var(--bg-base)')
  })

  it('computes editor scroll background', () => {
    const theme = createTheme('editor')
    theme.selectTheme(0)
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
    theme.selectTheme(0)
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

  it('saves margin to localStorage', () => {
    const theme = createTheme()
    theme.setMargin('manuscript')
    expect(localStorageMock.setItem).toHaveBeenCalledWith('rite-margin', 'manuscript')
  })

  it('sets zoom and saves preference', () => {
    const theme = createTheme()
    theme.setZoom(20)
    expect(theme.editorZoom.value).toBe(20)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('rite-zoom', '20')
  })

  it('selectTheme replaces all three colors and saves them', () => {
    const theme = createTheme()
    theme.selectTheme(2)

    expect(theme.editorBg.value).toBe(THEMES[2].bg)
    expect(theme.editorText.value).toBe(THEMES[2].text)
    expect(theme.editorAccent.value).toBe(THEMES[2].accent)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('rite-bg', THEMES[2].bg)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('rite-text', THEMES[2].text)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('rite-accent', THEMES[2].accent)
  })

  it('clamps a preset index out of range', () => {
    const theme = createTheme()
    theme.selectTheme(99)
    expect(theme.editorBg.value).toBe(THEMES[THEMES.length - 1].bg)
    theme.selectTheme(-1)
    expect(theme.editorBg.value).toBe(THEMES[0].bg)
  })

  it('loads saved zoom and margin', () => {
    storedPrefs({ 'rite-zoom': '20', 'rite-margin': 'manuscript' })
    const theme = createTheme()
    theme.loadPrefs()
    expect(theme.editorZoom.value).toBe(20)
    expect(theme.editorMargin.value).toBe('manuscript')
  })

  it('S-009: derives the accent background and accent hover from the chosen accent', () => {
    const theme = createTheme()
    theme.selectAccent('#E88C5A')

    expect(theme.currentTheme.value.accent).toBe('#E88C5A')
    expect(theme.currentTheme.value.accentBg).toBe('rgba(232, 140, 90, 0.25)')

    const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const hover = theme.currentTheme.value.accentHover
    expect(hover).toMatch(/^#[0-9A-Fa-f]{6}$/)
    const chosen = channels('#E88C5A')
    const darker = channels(hover)
    expect(darker).not.toEqual(chosen)
    darker.forEach((value, i) => expect(value).toBeLessThanOrEqual(chosen[i]))
  })

  it('S-010: keeps the chosen background, text and accent across a reload', () => {
    const theme = createTheme()
    theme.selectBackground('#DBE1F1')
    theme.selectText('#664B47')
    theme.selectAccent('#C9A96E')

    expect(localStorageMock.setItem).toHaveBeenCalledWith('rite-bg', '#DBE1F1')
    expect(localStorageMock.setItem).toHaveBeenCalledWith('rite-text', '#664B47')
    expect(localStorageMock.setItem).toHaveBeenCalledWith('rite-accent', '#C9A96E')

    const reloaded = createTheme()
    reloaded.loadPrefs()
    expect(reloaded.editorBg.value).toBe('#DBE1F1')
    expect(reloaded.editorText.value).toBe('#664B47')
    expect(reloaded.editorAccent.value).toBe('#C9A96E')
  })

  it('S-010: loads the legacy theme index when the three color keys are absent', () => {
    storedPrefs({ 'rite-theme': '3' })
    const theme = createTheme()
    theme.loadPrefs()
    expect(theme.editorBg.value).toBe(THEMES[3].bg)
    expect(theme.editorText.value).toBe(THEMES[3].text)
    expect(theme.editorAccent.value).toBe(THEMES[3].accent)
  })

  it('S-011: loads a stored combination that matches no preset and marks no preset current', () => {
    storedPrefs({
      'rite-bg': THEMES[3].bg,
      'rite-text': THEMES[1].text,
      'rite-accent': THEMES[4].accent,
    })
    const theme = createTheme()
    theme.loadPrefs()

    expect(theme.editorBg.value).toBe(THEMES[3].bg)
    expect(theme.editorText.value).toBe(THEMES[1].text)
    expect(theme.editorAccent.value).toBe(THEMES[4].accent)
    expect(theme.matchedPreset.value).toBe(-1)
  })

  it('S-012: falls back to the first preset when the stored colors are corrupt, unreadable or repeat', () => {
    const cases = [
      { 'rite-bg': 'not-a-color', 'rite-text': THEMES[1].text, 'rite-accent': THEMES[1].accent },
      { 'rite-bg': THEMES[0].bg, 'rite-text': THEMES[0].bg, 'rite-accent': THEMES[0].accent },
      { 'rite-bg': '', 'rite-text': '', 'rite-accent': '' },
    ]

    for (const values of cases) {
      storedPrefs(values)
      const theme = createTheme()
      theme.loadPrefs()
      expect(theme.editorBg.value).toBe(THEMES[0].bg)
      expect(theme.editorText.value).toBe(THEMES[0].text)
      expect(theme.editorAccent.value).toBe(THEMES[0].accent)
      expect(theme.matchedPreset.value).toBe(0)
    }
  })

  it('clamps loaded theme index to valid range', () => {
    storedPrefs({ 'rite-theme': '999' })
    const theme = createTheme()
    theme.loadPrefs()
    expect(theme.editorTheme.value).toBeLessThan(99)
  })

  it('parses malformed zoom values from localStorage as NaN', () => {
    storedPrefs({ 'rite-zoom': 'NaN' })
    const theme = createTheme()
    theme.loadPrefs()
    expect(theme.editorZoom.value).toBeNaN()
  })

  it('ignores invalid margin values from localStorage', () => {
    storedPrefs({ 'rite-margin': 'invalid' })
    const theme = createTheme()
    theme.loadPrefs()
    expect(theme.editorMargin.value).toBe('compact') // default
  })
})
