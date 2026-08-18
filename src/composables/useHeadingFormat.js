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

export function useHeadingFormat() {
  const headingFormats = ref(defaultFormats())

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
      const raw = localStorage.getItem('finewrite-heading-formats')
      if (raw) {
        const parsed = JSON.parse(raw)
        headingFormats.value = { ...defaultFormats(), ...parsed }
      }
    } catch {}
  }

  function savePrefs() {
    try {
      localStorage.setItem('finewrite-heading-formats', JSON.stringify(headingFormats.value))
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
