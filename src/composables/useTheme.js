import { ref, computed } from 'vue'
import { THEMES } from '../constants/themes.js'

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Returns a #RRGGBB string so accentHover keeps the palette's stored format.
function darkenHex(hex, factor) {
  const channels = [1, 3, 5].map((offset) =>
    Math.max(0, Math.round(parseInt(hex.slice(offset, offset + 2), 16) * factor)),
  )
  return '#' + channels
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

// 0.75: the hover reads a step darker than the accent but stays well above
// black.
const ACCENT_HOVER_FACTOR = 0.75

// Only full 6-digit forms count as a colour here. The rgba and darken helpers
// read fixed slice offsets, so anything shorter yields NaN channels.
const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/

const themes = THEMES

function isLightColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6
}

// Math.min and Math.max propagate NaN, so an unparsable index reads as the
// first preset.
function clampThemeIndex(index) {
  const parsed = Number(index)
  if (Number.isNaN(parsed)) return 0
  return Math.max(0, Math.min(themes.length - 1, parsed))
}

// A stored set counts as a choice only when all three values are hex strings
// and no two repeat. The setters refuse a colour another field holds, so a
// repeated pair is corrupt data, never a saved state.
function readStoredColourSet() {
  const bg = localStorage.getItem('rite-bg')
  const text = localStorage.getItem('rite-text')
  const accent = localStorage.getItem('rite-accent')
  const isColour = (value) => HEX_PATTERN.test(value)
  if (isColour(bg) && isColour(text) && isColour(accent) && bg !== text && bg !== accent && text !== accent) {
    return { bg, text, accent }
  }
  return null
}

export function useTheme(viewModeRef) {
  const editorTheme = ref(0)
  const editorZoom = ref(16)
  const editorMargin = ref('compact')
  const showThemePicker = ref(false)

  // The theme selection (SPEC 5.13) is three colours, not an index: the refs
  // hold the choice and a preset is a shortcut that sets all three at once.
  const editorBg = ref(themes[0].bg)
  const editorText = ref(themes[0].text)
  const editorAccent = ref(themes[0].accent)

  // currentTheme keeps the palette's shape, so a combination renders through
  // the same consumers as a preset does.
  const currentTheme = computed(() => ({
    bg: editorBg.value,
    text: editorText.value,
    accent: editorAccent.value,
    accentBg: hexToRgba(editorAccent.value, 0.25),
    accentHover: darkenHex(editorAccent.value, ACCENT_HOVER_FACTOR),
  }))

  // A combination no preset repeats has no THEMES index, so it reads as -1.
  const matchedPreset = computed(() =>
    themes.findIndex((theme) =>
      theme.bg === editorBg.value && theme.text === editorText.value && theme.accent === editorAccent.value,
    ),
  )

  // A hex another field holds is refused with no set and no save, because no
  // two fields may repeat a colour. When the choice completes a preset,
  // editorTheme moves onto it so the index keeps matching the refs.
  function applyColourChoice(colourRef, hex) {
    const heldElsewhere =
      (hex === editorBg.value && colourRef !== editorBg) ||
      (hex === editorText.value && colourRef !== editorText) ||
      (hex === editorAccent.value && colourRef !== editorAccent)
    if (heldElsewhere) return
    colourRef.value = hex
    if (matchedPreset.value !== -1) editorTheme.value = matchedPreset.value
    savePrefs()
  }

  function selectBackground(hex) {
    applyColourChoice(editorBg, hex)
  }

  function selectText(hex) {
    applyColourChoice(editorText, hex)
  }

  function selectAccent(hex) {
    applyColourChoice(editorAccent, hex)
  }

  const uiTextPrimary = computed(() => viewModeRef.value === 'editor' ? currentTheme.value.text : '#f0f0f5')
  const uiTextSecondary = computed(() => viewModeRef.value === 'editor' ? currentTheme.value.text + '99' : '#a0a0b099')
  const uiAccent = computed(() => viewModeRef.value === 'editor' ? currentTheme.value.accent : '#4f8ef7')
  const uiAccentBg = computed(() => viewModeRef.value === 'editor' ? currentTheme.value.accentBg : 'rgba(79, 142, 247, 0.25)')
  const uiAccentHover = computed(() => viewModeRef.value === 'editor' ? currentTheme.value.accentHover : '#3a7de0')
  const uiGlassBg = computed(() => {
    if (viewModeRef.value !== 'editor') return 'rgba(20, 20, 25, 0.78)'
    return hexToRgba(currentTheme.value.bg, 0.78)
  })
  const uiScrollBg = computed(() => {
    if (viewModeRef.value !== 'editor') return 'var(--bg-base)'
    // The editor scroll layer sits behind the editor sheet, which paints the
    // full theme bg itself. Painting the same opaque bg here (instead of a
    // translucent tint over the near-black app background) means the area below
    // a short document reads as one continuous surface with the sheet — no
    // black void showing through when the content is shorter than the viewport.
    return currentTheme.value.bg
  })
  const uiGlassBorder = computed(() => viewModeRef.value === 'editor' ? currentTheme.value.text + '33' : 'rgba(255, 255, 255, 0.1)')
  const uiHoverBg = computed(() => viewModeRef.value === 'editor' ? currentTheme.value.text + '11' : 'rgba(255, 255, 255, 0.06)')
  const uiHoverBgStrong = computed(() => viewModeRef.value === 'editor' ? currentTheme.value.text + '22' : 'rgba(255, 255, 255, 0.12)')
  const uiInputBg = computed(() => viewModeRef.value === 'editor' ? currentTheme.value.text + '22' : 'rgba(0, 0, 0, 0.25)')
  const uiPopupBg = computed(() => viewModeRef.value === 'editor' ? currentTheme.value.bg : '#0f0f11')

  function loadPrefs() {
    try {
      const storedColours = readStoredColourSet()
      if (storedColours) {
        editorBg.value = storedColours.bg
        editorText.value = storedColours.text
        editorAccent.value = storedColours.accent
      } else {
        // The colour keys are empty or invalid, so the legacy index drives all
        // three refs together.
        const storedThemeIndex = localStorage.getItem('rite-theme')
        if (storedThemeIndex !== null) {
          const themeIndex = clampThemeIndex(parseInt(storedThemeIndex, 10))
          editorTheme.value = themeIndex
          editorBg.value = themes[themeIndex].bg
          editorText.value = themes[themeIndex].text
          editorAccent.value = themes[themeIndex].accent
        }
      }
      const storedZoom = localStorage.getItem('rite-zoom')
      if (storedZoom !== null) editorZoom.value = parseInt(storedZoom, 10)
      const storedMargin = localStorage.getItem('rite-margin')
      if (storedMargin === 'manuscript' || storedMargin === 'compact') editorMargin.value = storedMargin
    } catch (error) {
      console.warn('useTheme: could not read saved preferences from localStorage', error)
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem('rite-bg', String(editorBg.value))
      localStorage.setItem('rite-text', String(editorText.value))
      localStorage.setItem('rite-accent', String(editorAccent.value))
      localStorage.setItem('rite-zoom', String(editorZoom.value))
      localStorage.setItem('rite-margin', String(editorMargin.value))
    } catch (error) {
      console.warn('useTheme: could not write preferences to localStorage', error)
    }
  }

  function selectTheme(presetIndex) {
    const themeIndex = clampThemeIndex(presetIndex)
    editorTheme.value = themeIndex
    editorBg.value = themes[themeIndex].bg
    editorText.value = themes[themeIndex].text
    editorAccent.value = themes[themeIndex].accent
    showThemePicker.value = false
    savePrefs()
  }

  function setZoom(z) {
    editorZoom.value = z
    savePrefs()
  }

  function setMargin(m) {
    editorMargin.value = m
    savePrefs()
  }

  return {
    themes,
    editorTheme,
    currentTheme,
    editorBg,
    editorText,
    editorAccent,
    matchedPreset,
    selectBackground,
    selectText,
    selectAccent,
    editorZoom,
    editorMargin,
    showThemePicker,
    uiTextPrimary,
    uiTextSecondary,
    uiAccent,
    uiAccentBg,
    uiAccentHover,
    uiGlassBg,
    uiScrollBg,
    uiGlassBorder,
    uiHoverBg,
    uiHoverBgStrong,
    uiInputBg,
    uiPopupBg,
    loadPrefs,
    savePrefs,
    selectTheme,
    setZoom,
    setMargin,
  }
}
