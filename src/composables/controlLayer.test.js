// The stylesheet's own guard (SPEC.md S-121 and S-122).
//
// A class name on a mounted component says nothing about the CSS behind it. A
// rule that hardcoded a colour would pass every component test. Both cases
// here read src/style.css as text.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(join(process.cwd(), 'src', 'style.css'), 'utf8')

/// The controls section: from its header comment to the end of the file.
const controls = stylesheet.slice(stylesheet.indexOf('/* ---------- Controls ----------'))

/// Every custom property the stylesheet declares, wherever it is declared.
/// The control aliases sit on .app-container, because a var() resolves where
/// its property is declared (SPEC.md revision 10, S-132).
const declaredNames = new Set(
  [...stylesheet.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((match) => match[1]),
)

const varNames = (text) => [...text.matchAll(/var\((--[a-z0-9-]+)\s*\)/g)].map((match) => match[1])

describe('control layer stylesheet', () => {
  it('S-121: takes every control colour from a control or chip token', () => {
    // Radius tokens are geometry, not colour, so they pass. Any chrome token
    // (--text-secondary, --accent, --hover-bg...) is what this forbids.
    const foreign = varNames(controls).filter(
      (name) => !name.startsWith('--control-') && !name.startsWith('--chip-')
        && !name.startsWith('--radius-'),
    )
    expect(foreign).toEqual([])

    // Every name a control reads is declared before use, so no rule can
    // resolve to nothing and inherit whatever sits behind it.
    const undeclared = varNames(controls).filter((name) => !declaredNames.has(name))
    expect(undeclared).toEqual([])

    // Positive control: the section really does read tokens, and the filter
    // above notices a chrome name when one is offered.
    expect(varNames(controls)).toContain('--control-text')
    expect(
      varNames('color: var(--text-secondary)').filter((name) => !name.startsWith('--control-')),
    ).toEqual(['--text-secondary'])
  })

  it('S-122: declares each of the four kinds once', () => {
    for (const kind of ['borderless', 'bordered', 'chip']) {
      const base = controls.match(new RegExp(`^\\.control-${kind} \\{`, 'gm')) ?? []
      expect(base.length, `.control-${kind}`).toBe(1)
    }

    const track = controls.match(/^\.control-segmented \{/gm) ?? []
    expect(track, '.control-segmented track').toHaveLength(1)

    // A segment paints only as a child of the track, so no stray segment rule
    // can draw itself outside a set.
    const segments = controls.match(/\.control-segmented > \.control-segment/g) ?? []
    expect(segments.length).toBeGreaterThanOrEqual(5)
    expect(controls).not.toMatch(/^\.control-segment \{/m)

    // The four kinds, named in one place.
    for (const kind of ['control-borderless', 'control-bordered', 'control-chip', 'control-segmented']) {
      expect(controls, kind).toContain(`.${kind}`)
    }
  })
})
