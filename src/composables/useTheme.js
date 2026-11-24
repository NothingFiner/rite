import { ref, computed } from 'vue'
import { THEMES } from '../constants/themes.js'
import { CHROME_PALETTE } from '../constants/palette.js'

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Returns a six-digit hex string so accentHover keeps the palette's stored format.
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
  // A partial record is a persisted record holding only the background. The
  // missing text and accent stay null, so loadPrefs keeps their defaults.
  const isPartial = isColour(bg) && !isColour(text) && !isColour(accent)
  if (isPartial) return { bg, text: null, accent: null }
  return null
}

export function useTheme(viewModeRef) {
  const editorTheme = ref(0)
  const editorZoom = ref(16)
  const editorMargin = ref('compact')
  const showThemePicker = ref(false)

  // The theme selection is three colours, not an index. Each ref holds one
  // colour, and a preset sets all three together.
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

  // A combination no preset repeats has no entry in the themes list, so
  // findIndex returns -1.
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

  // Outside the editor the chrome paints from the published palette, so the
  // stylesheet's first paint and the runtime values cannot drift (S-117).
  const chrome = (token) => (viewModeRef.value === 'editor' ? null : CHROME_PALETTE[token])
  const uiTextPrimary = computed(() => chrome('--text-primary') ?? currentTheme.value.text)
  const uiTextSecondary = computed(() => chrome('--text-secondary') ?? currentTheme.value.text + '99')
  const uiAccent = computed(() => chrome('--accent') ?? currentTheme.value.accent)
  const uiAccentBg = computed(() => chrome('--accent-bg') ?? currentTheme.value.accentBg)
  const uiAccentHover = computed(() => chrome('--accent-hover') ?? currentTheme.value.accentHover)
  const uiGlassBg = computed(() => chrome('--glass-bg') ?? hexToRgba(currentTheme.value.bg, 0.78))
  const uiScrollBg = computed(() => {
    if (viewModeRef.value !== 'editor') return 'var(--bg-base)'
    // The editor scroll layer sits behind the editor sheet, which paints the
    // full theme bg itself. Painting the same opaque bg here (instead of a
    // translucent tint over the near-black app background) means the area below
    // a short document reads as one continuous surface with the sheet — no
    // black void showing through when the content is shorter than the viewport.
    return currentTheme.value.bg
  })
  const uiGlassBorder = computed(() => chrome('--bg-glass-border') ?? currentTheme.value.text + '33')
  const uiHoverBg = computed(() => chrome('--hover-bg') ?? currentTheme.value.text + '11')
  const uiHoverBgStrong = computed(() => chrome('--hover-bg-strong') ?? currentTheme.value.text + '22')
  const uiInputBg = computed(() => chrome('--input-bg') ?? currentTheme.value.text + '22')
  const uiPopupBg = computed(() => chrome('--popup-bg') ?? currentTheme.value.bg)

  function loadPrefs() {
    try {
      const storedColours = readStoredColourSet()
      if (storedColours) {
        editorBg.value = storedColours.bg
        if (storedColours.text) editorText.value = storedColours.text
        if (storedColours.accent) editorAccent.value = storedColours.accent
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
