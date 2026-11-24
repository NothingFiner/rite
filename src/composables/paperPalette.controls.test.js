// What a themed page hands a control (SPEC.md S-120 and S-133).
//
// The rules in style.css read nothing but --control-* and --chip-*. A themed
// page publishes that set itself. This file checks the publication: every name
// arrives, in the theme's colours, with ink strong enough to read.

import { describe, expect, it } from 'vitest'
import { THEMES } from '../constants/themes.js'
import { contrastRatio, paperPalette, TEXT_CONTRAST_FLOOR } from './paperPalette.js'

const CONTROL_TOKENS = [
  '--control-text',
  '--control-text-hover',
  '--control-text-active',
  '--control-bg',
  '--control-border',
  '--control-border-hover',
  '--control-hover-bg',
  '--control-active-bg',
  '--control-active-border',
  '--control-on-primary',
  '--chip-bg',
  '--chip-text',
  '--chip-border',
]

describe('paperPalette control tokens', () => {
  it('S-120: publishes the control layer from the page’s theme', () => {
    for (const theme of THEMES) {
      const palette = paperPalette(theme)

      for (const token of CONTROL_TOKENS) {
        expect(palette[token], `${theme.name} ${token}`).toBeTruthy()
      }

      // The accent decides what a chosen control looks like, and the paper
      // decides what its label looks like on an accent fill.
      expect(palette['--control-text-active'], theme.name).toBe(theme.accent)
      expect(palette['--control-active-border'], theme.name).toBe(theme.accent)
      expect(palette['--control-on-primary'], theme.name).toBe(theme.bg)
      expect(palette['--control-text-hover'], theme.name).toBe(theme.text)

      // The ink-prefixed tokens carry this theme's ink, not a chrome constant.
      const ink = theme.text.toLowerCase()
      for (const token of ['--control-bg', '--control-border', '--control-hover-bg', '--chip-bg']) {
        expect(palette[token].toLowerCase(), `${theme.name} ${token}`).toMatch(
          new RegExp(`^${ink}[0-9a-f]{2}$`),
        )
      }

      const published = JSON.stringify(palette)
      expect(published, theme.name).not.toContain('#f0f0f5')
      expect(published, theme.name).not.toContain('#a0a0b0')
      expect(published, theme.name).not.toContain('#4f8ef7')
      expect(published, theme.name).not.toContain('#ffffff')
    }

    // Positive control: two themes publish two different control layers, so a
    // frozen object would fail above rather than pass quietly.
    const mist = paperPalette(THEMES[0])
    const midnight = paperPalette(THEMES.find((theme) => theme.name === 'Midnight'))
    expect(mist['--control-bg']).not.toBe(midnight['--control-bg'])
    expect(mist['--control-text-active']).not.toBe(midnight['--control-text-active'])
  })

  // Revision 10, S-133. With the alias placed correctly the ink lands on the
  // theme's 60% secondary, which is 2.44:1 on Mist. A control is an affordance,
  // so it takes the full ink. Muted ink is for prose and for chips.
  it('S-133: publishes the full ink for a control and muted ink for chips', () => {
    for (const theme of THEMES) {
      const palette = paperPalette(theme)

      expect(palette['--control-text'], theme.name).toBe(theme.text)
      expect(contrastRatio(palette['--control-text'], theme.bg), theme.name)
        .toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR)

      // A chip is a label rather than an action, so its name is the faint one.
      expect(palette['--chip-text'], theme.name).toBe(palette['--note-text-muted'])
    }

    // Positive control: muted ink really is the fainter of the two, so the
    // assertions above are not reading one value written twice.
    const mist = paperPalette(THEMES[0])
    expect(mist['--chip-text']).not.toBe(mist['--control-text'])
    expect(contrastRatio(mist['--chip-text'], THEMES[0].bg))
      .toBeLessThan(contrastRatio(mist['--control-text'], THEMES[0].bg))
  })
})
