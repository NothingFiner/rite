import { ref } from 'vue'

function toRoman(num) {
  const romans = [
    ['M', 1000], ['CM', 900], ['D', 500], ['CD', 400],
    ['C', 100], ['XC', 90], ['L', 50], ['XL', 40],
    ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1],
  ]
  let result = ''
  for (const [letter, value] of romans) {
    while (num >= value) {
      result += letter
      num -= value
    }
  }
  return result
}

function defaultFormats() {
  return {
    1: { prefix: 'Part', numbering: 'arabic', autoGenerate: true },
    2: { prefix: 'Chapter', numbering: 'arabic', autoGenerate: true },
    3: { prefix: '', numbering: 'none', autoGenerate: false },
    4: { prefix: '', numbering: 'none', autoGenerate: false },
    5: { prefix: '', numbering: 'none', autoGenerate: false },
    6: { prefix: '', numbering: 'none', autoGenerate: false },
  }
}

// Module-level shared ref so every caller of useHeadingFormat sees the same
// heading formats. Without this, the editor (editorDisplay.vue) and the General
// Options drawer (App.vue) each held an independent ref — the editor's never
// had loadPrefs() called on it, so it always generated default labels and
// ignored the user's customizations. One shared ref fixes that: the drawer's
// loadPrefs/setFormat now reach the editor too.
let headingFormatsRef = null
function sharedHeadingFormats() {
  if (!headingFormatsRef) headingFormatsRef = ref(defaultFormats())
  return headingFormatsRef
}

// Test-only: reset the shared ref so mutations in one test don't leak into the
// next. Not called in production.
export function resetHeadingFormatsForTests() {
  headingFormatsRef = ref(defaultFormats())
}

export function useHeadingFormat() {
  const headingFormats = sharedHeadingFormats()

  function formatNumber(numbering, index) {
    if (numbering === 'roman') return toRoman(index)
    if (numbering === 'arabic') return String(index)
    return ''
  }

  function formatHeading(level, index) {
    const fmt = headingFormats.value[level]
    if (!fmt) return ''
    const numStr = formatNumber(fmt.numbering, index)
    const parts = [fmt.prefix, numStr].filter(Boolean)
    return parts.join(' ')
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem('rite-heading-formats')
      if (raw) {
        const parsed = JSON.parse(raw)
        headingFormats.value = { ...defaultFormats(), ...parsed }
      }
    } catch {}
  }

  function savePrefs() {
    try {
      localStorage.setItem('rite-heading-formats', JSON.stringify(headingFormats.value))
    } catch {}
  }

  function setFormat(level, updates) {
    headingFormats.value[level] = { ...headingFormats.value[level], ...updates }
    savePrefs()
  }

  return {
    headingFormats,
    formatHeading,
    loadPrefs,
    savePrefs,
    setFormat,
  }
}
