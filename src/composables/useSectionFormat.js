import { ref } from 'vue'

// Chapter naming preferences: a single format for the one auto-numbered section
// type (Chapter). Replaces the old 6-level useHeadingFormat — sections are flat
// now, so there is no Part/Chapter/H3–H6 hierarchy, just one numbered kind.
//
// The chapter NUMBER is render-derived (position among Chapter-type sections),
// so this format only controls the prefix word ("Chapter") and the numbering
// scheme (arabic/roman). The subtitle is the section's editable title.

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

function defaultFormat() {
  return { prefix: 'Chapter', numbering: 'arabic' }
}

// Module-level shared ref so every caller of useSectionFormat sees the same
// format. The editor (editorDisplay.vue) and the General Options drawer
// (GeneralOptionsDrawer.vue) must share one source of truth, or the editor
// would render default labels while the drawer held the user's customization.
let sectionFormatRef = null
function sharedSectionFormat() {
  if (!sectionFormatRef) sectionFormatRef = ref(defaultFormat())
  return sectionFormatRef
}

// Test-only: reset the shared ref so mutations in one test don't leak into the
// next. Not called in production.
export function resetSectionFormatForTests() {
  sectionFormatRef = ref(defaultFormat())
}

export function useSectionFormat() {
  const sectionFormat = sharedSectionFormat()

  function formatNumber(numbering, index) {
    if (numbering === 'roman') return toRoman(index)
    if (numbering === 'arabic') return String(index)
    return ''
  }

  /// Render the locked, non-editable chapter prefix for the index-th chapter,
  /// e.g. "Chapter 3: " (with trailing separator) or "Chapter 3 " when no
  /// numbering. The subtitle is appended by the caller.
  function formatChapter(index) {
    const fmt = sectionFormat.value
    const numStr = formatNumber(fmt.numbering, index)
    const parts = [fmt.prefix, numStr].filter(Boolean)
    const base = parts.join(' ')
    return base + ': '
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem('rite-section-format')
      if (raw) {
        const parsed = JSON.parse(raw)
        sectionFormat.value = { ...defaultFormat(), ...parsed }
      }
    } catch {}
  }

  function savePrefs() {
    try {
      localStorage.setItem('rite-section-format', JSON.stringify(sectionFormat.value))
    } catch {}
  }

  function setFormat(updates) {
    sectionFormat.value = { ...sectionFormat.value, ...updates }
    savePrefs()
  }

  return {
    sectionFormat,
    formatChapter,
    loadPrefs,
    savePrefs,
    setFormat,
  }
}