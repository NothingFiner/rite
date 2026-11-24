// The chrome palette (SPEC.md revision 8, S-117 … S-119).
//
// One source for the colours the app chrome paints itself with outside the
// editor. `src/style.css` declares them for the first paint and `useTheme.js`
// publishes them at runtime; the two had drifted, with `--text-secondary`
// opaque in the stylesheet and 60% at runtime, so a surface could change
// colour once the app finished mounting.
//
// Page-level palettes are separate on purpose: a page painted with the
// writer's theme derives its own tokens in `paperPalette.js`.

export const CHROME_PALETTE = Object.freeze({
  '--text-primary': '#f0f0f5',
  '--text-secondary': '#a0a0b099',
  '--accent': '#4f8ef7',
  '--accent-bg': 'rgba(79, 142, 247, 0.25)',
  '--accent-hover': '#3a7de0',
  '--glass-bg': 'rgba(20, 20, 25, 0.78)',
  '--bg-glass-border': 'rgba(255, 255, 255, 0.1)',
  '--hover-bg': 'rgba(255, 255, 255, 0.06)',
  '--hover-bg-strong': 'rgba(255, 255, 255, 0.12)',
  '--input-bg': 'rgba(0, 0, 0, 0.25)',
  '--popup-bg': '#0f0f11',
  // The ink that sits on an accent fill: a primary control's label. A
  // theme-painted page republishes it as the paper colour instead (revision 9).
  '--control-on-primary': '#ffffff',
})

/** The base the chrome sits on, declared in the stylesheet only. */
export const CHROME_BASE = Object.freeze({
  '--bg-base': '#0f0f11',
  '--bg-editor': '#141416',
  '--bg-glass': 'rgba(255, 255, 255, 0.06)',
})
