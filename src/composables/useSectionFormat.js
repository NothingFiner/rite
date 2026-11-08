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

/// The locked chapter prefix for the index-th chapter, e.g. "Chapter 3: ".
/// Pure over an explicit format record so the module-level display-title rule
/// can render without a composable instance.
function chapterPrefixFor(format, index) {
  const numStr = formatNumber(format.numbering, index)
  const parts = [format.prefix, numStr].filter(Boolean)
  return parts.join(' ') + ': '
}

function formatNumber(numbering, index) {
  if (numbering === 'roman') return toRoman(index)
  if (numbering === 'arabic') return String(index)
  return ''
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

  /// Render the locked, non-editable chapter prefix for the index-th chapter,
  /// e.g. "Chapter 3: " (with trailing separator) or "Chapter 3 " when no
  /// numbering. The subtitle is appended by the caller.
  function formatChapter(index) {
    return chapterPrefixFor(sectionFormat.value, index)
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
/// The chapter prefix for the index-th chapter, e.g. "Chapter 3: ", using the
/// shared format. Reading the shared ref here keeps a caller inside a computed
/// reactive to the writer's prefix/numbering choice.
export function chapterPrefix(index) {
  return chapterPrefixFor(sharedSectionFormat().value, index)
}

/// The display title for a section, wherever a row, heading or note draft names
/// it. A Chapter reads its derived prefix plus its subtitle ("Chapter 3: Ash"),
/// or the prefix alone when the subtitle is empty — a Chapter's stored `title`
/// IS the subtitle, so it is legitimately blank (roadmap 5.9). A Section reads
/// its literal title, or "Untitled Section".
///
/// ONE rule for every surface that shows a section name: the navigation
/// outline, the Notes list and note headings, and the assistant's notes context.
/// Do not show `section.title` raw: for a Chapter that is the subtitle only and
/// renders blank.
export function sectionDisplayTitle(section, chapterIndex) {
  if (section?.sectionType === 'chapter') {
    const prefix = chapterPrefix(chapterIndex)
    return section.title ? prefix + section.title : prefix.replace(/: $/, '')
  }
  return section.title || 'Untitled Section'
}

/// The name a note page heads an entry with: what the writer typed. A
/// Chapter's stored `title` is its subtitle (roadmap 5.9), so it counts as a
/// typed name. A blank one falls back to the numbered `sectionDisplayTitle`.
export function sectionName(section, chapterIndex) {
  return section?.title || sectionDisplayTitle(section, chapterIndex)
}
