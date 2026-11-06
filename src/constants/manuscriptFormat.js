// Manuscript page-format presets. Each preset is a complete description of one
// physical manuscript layout: page size, margins, body font, line height, page
// background, first-line indent, and text color. The ACTIVE preset is chosen by
// `useManuscriptFormat` (persisted to localStorage) and consumed in three
// places that MUST stay in lockstep:
//   - `manuscriptPage.vue` — renders the visible page at this size/font/color.
//   - `usePagination.js` — measures paragraph heights at this content width /
//     font to decide where pages break. If the render and the measure disagree,
//     the visible pages and the computed page breaks drift apart.
//   - the options drawer — shows the picker.
//
// `contentWidth` / `contentHeight` are derived (page minus both margins) and are
// what pagination measures against. They're precomputed per preset so the
// pagination measure and the CSS render read the exact same numbers with no
// runtime arithmetic to diverge.
//
// The `standard` preset is byte-identical to the values that were previously
// hardcoded in `manuscriptPage.vue` and `constants/page.js` (720x960, 96px
// margins, Courier 12pt / 24px line-height, cream #FFFFE3, 48px indent), so the
// default behavior is unchanged — this file just makes those numbers live in
// one place and switchable.

function preset(values) {
  const contentWidth = values.pageWidth - values.margin * 2
  const contentHeight = values.pageHeight - values.margin * 2
  return { ...values, contentWidth, contentHeight }
}

export const MANUSCRIPT_FORMATS = [
  preset({
    id: 'standard',
    name: 'Standard Manuscript',
    pageWidth: 720,
    pageHeight: 960,
    margin: 96,
    fontFamily: "'Courier New', Courier, monospace",
    fontSize: 12,
    lineHeight: 24,
    pageBackground: '#FFFFE3',
    textIndent: 48,
    textColor: '#1a1a1a',
  }),
  // Shunn Modern manuscript format: US Letter (8.5x11in = 816x1056px at 96dpi),
  // 1in margins, 12pt Courier double-spaced (24px line-height), white paper.
  preset({
    id: 'shunn',
    name: 'Shunn Modern (US Letter)',
    pageWidth: 816,
    pageHeight: 1056,
    margin: 96,
    fontFamily: "'Courier New', Courier, monospace",
    fontSize: 12,
    lineHeight: 24,
    pageBackground: '#FFFFFF',
    textIndent: 48,
    textColor: '#000000',
  }),
  // A4 (210x297mm ≈ 794x1123px at 96dpi), 1in margins, 12pt Courier, white paper.
  preset({
    id: 'a4',
    name: 'A4',
    pageWidth: 794,
    pageHeight: 1123,
    margin: 96,
    fontFamily: "'Courier New', Courier, monospace",
    fontSize: 12,
    lineHeight: 24,
    pageBackground: '#FFFFFF',
    textIndent: 48,
    textColor: '#000000',
  }),
]

export const DEFAULT_MANUSCRIPT_FORMAT_ID = 'standard'

export function findManuscriptFormat(id) {
  return MANUSCRIPT_FORMATS.find((f) => f.id === id) || MANUSCRIPT_FORMATS[0]
}