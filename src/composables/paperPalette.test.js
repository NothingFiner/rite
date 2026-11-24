// The paper palette (SPEC.md revision 7, S-113 and S-114).
//
// A page painted with the writer's theme must take every colour from that
// theme. The chrome tokens flip to a dark palette outside the editor, so the
// failure this guards against is near-white text on light paper: measurable,
// not a matter of taste.

import { describe, expect, it } from 'vitest'
import { THEMES } from '../constants/themes.js'
import { contrastRatio, paperPalette, TEXT_CONTRAST_FLOOR } from './paperPalette.js'

describe('paperPalette', () => {
  it('S-113: derives every page colour from the writer’s theme', () => {
    for (const theme of THEMES) {
      const palette = paperPalette(theme)

      expect(palette['--note-text'], theme.name).toBe(theme.text)
      expect(palette['--note-accent'], theme.name).toBe(theme.accent)

      // The chrome's values must not appear at all, whatever the derivation.
      const published = JSON.stringify(palette)
      expect(published, theme.name).not.toContain('#f0f0f5')
      expect(published, theme.name).not.toContain('#a0a0b0')
      expect(published, theme.name).not.toContain('#4f8ef7')
      expect(published, theme.name).not.toContain('rgba(20, 20, 25')

      // The hairline, field and hover tokens carry the theme's ink.
      const ink = theme.text.toLowerCase()
      expect(palette['--note-border'].toLowerCase(), theme.name).toMatch(
        new RegExp(`^${ink}[0-9a-f]{2}$`),
      )
      expect(palette['--note-field-bg'].toLowerCase(), theme.name).toMatch(
        new RegExp(`^${ink}[0-9a-f]{2}$`),
      )

      // A palette is a function of its theme, not a constant.
      expect(palette['--note-text-muted'], theme.name).toBeTruthy()
    }

    // Positive control: a second theme yields a different palette, so the
    // assertions above cannot pass on one frozen object.
    const mist = paperPalette(THEMES[0])
    const midnight = paperPalette(THEMES[5])
    expect(mist['--note-border']).not.toBe(midnight['--note-border'])
    expect(mist['--note-text']).not.toBe(midnight['--note-text'])
  })

  it('S-114: keeps every preset’s page text above the AA floor on its own paper', () => {
    for (const theme of THEMES) {
      const palette = paperPalette(theme)

      expect(
        contrastRatio(palette['--note-text'], theme.bg),
        `${theme.name}: page text on its own paper`,
      ).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR)

      expect(
        contrastRatio(palette['--note-text-muted'], theme.bg),
        `${theme.name}: muted text on its own paper`,
      ).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR)
    }

    // Positive control: the colour that used to be painted here is the
    // failure this sentence exists for. On the default paper it is below 1.4:1.
    expect(contrastRatio('#f0f0f5', THEMES[0].bg)).toBeLessThan(2)
  })
})
