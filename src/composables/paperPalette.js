// The paper palette (SPEC.md revision 7, S-113 … S-116).
//
// A page painted with the writer's theme takes every colour from that theme.
// The chrome tokens in useTheme.js switch to a dark palette outside the
// editor, so a page rule that reaches for one paints near-white text on light
// paper.
//
// This module is the only owner of the derived tokens: ink, muted ink, accent,
// hairline, field surface and hover wash. Components spread the result onto
// their root and name no other colour.

/** Alpha bytes layered under the theme ink, the shipped look for each one. */
const INK_ALPHAS = { fieldBg: '14', border: '59', hoverBg: '1f' }

/** WCAG AA for normal text. Every preset's own ink already meets it. */
export const TEXT_CONTRAST_FLOOR = 4.5

/** Muted ink is searched upward from here, so hierarchy never costs legibility. */
const MUTED_ALPHA_START = 0.6
const MUTED_ALPHA_STEP = 0.02

/// Reads one CSS colour into channels, or null for a value it cannot parse.
/// Accepts the three forms the theme pickers write: #rgb, #rrggbb and rgb().
function parseInk(value) {
  if (typeof value !== 'string') return null
  const colour = value.trim()

  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour)
  if (hexMatch) {
    const digits = hexMatch[1]
    const expanded = digits.length === 3
      ? [...digits].map((digit) => digit + digit).join('')
      : digits
    return {
      r: parseInt(expanded.slice(0, 2), 16),
      g: parseInt(expanded.slice(2, 4), 16),
      b: parseInt(expanded.slice(4, 6), 16),
      a: 1,
    }
  }

  const rgbMatch = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(colour)
  if (!rgbMatch) return null
  const channel = (raw) => Math.min(Number(raw), 255)
  const alpha = rgbMatch[4] === undefined ? 1 : Math.min(Number(rgbMatch[4]), 1)
  return { r: channel(rgbMatch[1]), g: channel(rgbMatch[2]), b: channel(rgbMatch[3]), a: alpha }
}

/// The lowercase #rrggbb form of an opaque colour, for an alpha byte to follow.
function inkHex(ink) {
  return `#${[ink.r, ink.g, ink.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

/// `ink` laid over `under` at `alpha`, the way the browser composites.
function blend(ink, under, alpha) {
  return {
    r: Math.round(ink.r * alpha + under.r * (1 - alpha)),
    g: Math.round(ink.g * alpha + under.g * (1 - alpha)),
    b: Math.round(ink.b * alpha + under.b * (1 - alpha)),
    a: 1,
  }
}

function channelLuminance(value) {
  const scaled = value / 255
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of an opaque colour. */
export function relativeLuminance(colour) {
  return 0.2126 * channelLuminance(colour.r)
    + 0.7152 * channelLuminance(colour.g)
    + 0.0722 * channelLuminance(colour.b)
}

/**
 * WCAG contrast of `foreground` over `background`, both CSS colour strings.
 *
 * A translucent foreground is composited onto the background first, because
 * that is the pair the writer's eye actually receives.
 */
export function contrastRatio(foreground, background) {
  const under = parseInk(background)
  if (!under) return null
  let over = parseInk(foreground)
  if (!over) return null
  if (over.a < 1) over = blend(over, under, over.a)

  const overLuminance = relativeLuminance(over)
  const underLuminance = relativeLuminance(under)
  const lighter = Math.max(overLuminance, underLuminance)
  const darker = Math.min(overLuminance, underLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * The faintest ink over `background` that still clears {@link TEXT_CONTRAST_FLOOR}.
 *
 * Searched upward from 60% so the muted token keeps as much hierarchy as the
 * theme allows. A theme whose own ink cannot clear the floor (a user-edited
 * pair) gets its ink back unchanged: there is nothing fainter to offer.
 */
export function mutedInk(text, background) {
  const ink = parseInk(text)
  const under = parseInk(background)
  if (!ink || !under) return null
  if (contrastRatio(text, background) < TEXT_CONTRAST_FLOOR) return text

  for (let alpha = MUTED_ALPHA_START; alpha < 1; alpha += MUTED_ALPHA_STEP) {
    const candidate = blend(ink, under, alpha)
    if (contrastRatio(`rgb(${candidate.r}, ${candidate.g}, ${candidate.b})`, background) >= TEXT_CONTRAST_FLOOR) {
      return `rgba(${ink.r}, ${ink.g}, ${ink.b}, ${alpha.toFixed(2)})`
    }
  }
  return text
}

/**
 * The custom properties a theme-painted page spreads onto its root.
 *
 * Empty for a missing theme, so a component mounted without one keeps the
 * inherited colour instead of inventing a palette.
 */
export function paperPalette(theme) {
  if (!theme || typeof theme !== 'object') return {}

  const styles = {
    color: theme.text,
    '--note-text': theme.text,
    '--note-accent': theme.accent,
  }

  const ink = parseInk(theme.text)
  if (ink) {
    const hex = inkHex(ink)
    styles['--note-border'] = `${hex}${INK_ALPHAS.border}`
    styles['--note-field-bg'] = `${hex}${INK_ALPHAS.fieldBg}`
    styles['--note-field-border'] = `${hex}${INK_ALPHAS.border}`
    styles['--note-hover-bg'] = `${hex}${INK_ALPHAS.hoverBg}`
  }

  const muted = mutedInk(theme.text, theme.bg)
  if (muted) styles['--note-text-muted'] = muted

  // A wash of the theme's own accent, so a selected row never borrows the
  // chrome's blue outside the editor.
  const accent = parseInk(theme.accent)
  if (accent) styles['--note-accent-bg'] = `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.25)`

  // The control layer (revision 9). A page reuses the control classes, so it
  // republishes their names here. Without this a page control would resolve to
  // the dark chrome tokens on light paper.
  // SPEC.md S-133. The 60% secondary is for prose. An action reads at the ink
  // the writer chose, and the chip name stays faint two lines down.
  styles['--control-text'] = theme.text
  styles['--control-text-hover'] = theme.text
  styles['--control-text-active'] = theme.accent
  styles['--control-border-hover'] = theme.accent
  styles['--control-active-border'] = theme.accent
  styles['--control-on-primary'] = theme.bg
  // Reuse the wash computed above, so a selected control and a selected row
  // cannot drift apart.
  styles['--control-active-bg'] = styles['--note-accent-bg'] ?? theme.accentBg ?? theme.accent
  if (ink) {
    const hex = inkHex(ink)
    styles['--control-bg'] = `${hex}${INK_ALPHAS.fieldBg}`
    styles['--control-border'] = `${hex}${INK_ALPHAS.border}`
    styles['--control-hover-bg'] = `${hex}${INK_ALPHAS.hoverBg}`
    styles['--chip-bg'] = `${hex}${INK_ALPHAS.fieldBg}`
  }
  if (muted) styles['--chip-text'] = muted
  styles['--chip-border'] = 'transparent'

  return styles
}
