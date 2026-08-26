import { ref, computed } from 'vue'
import { THEMES } from '../constants/themes.js'

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function darkenHex(hex, factor) {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor)
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor)
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor)
  return `rgb(${Math.max(0, r)}, ${Math.max(0, g)}, ${Math.max(0, b)})`
}

const themes = THEMES

function isLightColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6
}

function clampThemeIndex(idx) {
  return Math.max(0, Math.min(themes.length - 1, idx))
}

export function useTheme(viewModeRef) {
  const editorTheme = ref(0)
  const editorZoom = ref(16)
  const editorMargin = ref('compact')
  const showThemePicker = ref(false)

  const currentTheme = computed(() => themes[clampThemeIndex(editorTheme.value)])

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
    return hexToRgba(currentTheme.value.bg, 0.12)
  })
  const uiGlassBorder = computed(() => viewModeRef.value === 'editor' ? currentTheme.value.text + '33' : 'rgba(255, 255, 255, 0.1)')
  const uiHoverBg = computed(() => viewModeRef.value === 'editor' ? currentTheme.value.text + '11' : 'rgba(255, 255, 255, 0.06)')
  const uiHoverBgStrong = computed(() => viewModeRef.value === 'editor' ? currentTheme.value.text + '22' : 'rgba(255, 255, 255, 0.12)')
  const uiInputBg = computed(() => viewModeRef.value === 'editor' ? currentTheme.value.text + '22' : 'rgba(0, 0, 0, 0.25)')
  const uiPopupBg = computed(() => viewModeRef.value === 'editor' ? currentTheme.value.bg : '#0f0f11')

  function loadPrefs() {
    try {
      const t = localStorage.getItem('rite-theme')
      if (t !== null) {
        const idx = parseInt(t, 10)
        editorTheme.value = clampThemeIndex(idx)
      }
      const z = localStorage.getItem('rite-zoom')
      if (z !== null) editorZoom.value = parseInt(z, 10)
      const m = localStorage.getItem('rite-margin')
      if (m === 'manuscript' || m === 'compact') editorMargin.value = m
    } catch {}
  }

  function savePrefs() {
    try {
      localStorage.setItem('rite-theme', String(editorTheme.value))
      localStorage.setItem('rite-zoom', String(editorZoom.value))
      localStorage.setItem('rite-margin', editorMargin.value)
    } catch {}
  }

  function selectTheme(i) {
    editorTheme.value = clampThemeIndex(i)
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
