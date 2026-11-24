// The control block in src/style.css (SPEC.md revision 9, S-121 and S-122).
//
// Every other unit test here reads a class name off a mounted component, which
// cannot see what the stylesheet does with it. A control rule that hardcoded a
// colour would pass all of them. These two read the stylesheet text itself.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(join(process.cwd(), 'src', 'style.css'), 'utf8')

/// The controls section: from its header comment to the end of the file.
const controls = stylesheet.slice(stylesheet.indexOf('/* ---------- Controls ----------'))

/// The :root block, which declares the first paint of every token.
const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(stylesheet)?.[1] ?? ''

const declaredNames = new Set(
  [...rootBlock.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((match) => match[1]),
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
