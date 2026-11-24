// The control layer on a painted page (SPEC.md revision 9, S-120).
//
// A control rule in style.css reads only --control-* and --chip-*. On the dark
// chrome those come from :root. On a page painted with the writer's theme they
// have to come from the theme, or a bordered button on the References page
// would paint near-white chrome again. This file checks the second half: the
// names are published, and every one of them is the writer's colour.

import { describe, expect, it } from 'vitest'
import { THEMES } from '../constants/themes.js'
import { paperPalette } from './paperPalette.js'

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
})
