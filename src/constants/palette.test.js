// The chrome palette (SPEC.md revision 8, S-117 … S-119).
//
// One colour, one owner. The stylesheet declares the first paint, useTheme.js
// publishes the runtime values, and components used to restate both as `var()`
// fallbacks. Those copies drifted: `--text-secondary` was opaque in the
// stylesheet and 60% at runtime, and `.glass` promised a 4% white surface while
// the token held a 78% near-black one.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { CHROME_BASE, CHROME_PALETTE } from './palette.js'
import { useTheme } from '../composables/useTheme.js'

const SRC = join(process.cwd(), 'src')

function readRootTokens() {
  const css = readFileSync(join(SRC, 'style.css'), 'utf8')
  const block = /:root\s*\{([\s\S]*?)\}/.exec(css)
  expect(block, 'style.css should declare a :root block').not.toBeNull()
  const tokens = {}
  for (const line of block[1].split('\n')) {
    const match = /^\s*(--[a-z0-9-]+)\s*:\s*(.+?);\s*$/.exec(line)
    if (match) tokens[match[1]] = match[2]
  }
  return tokens
}

function sourceFiles(dir = SRC) {
  const found = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (/\.(vue|css)$/.test(name)) found.push(path)
  }
  return found
}

describe('chrome palette', () => {
  it('S-117: declares the same colours in the stylesheet as at runtime', () => {
    const root = readRootTokens()

    for (const [token, value] of Object.entries({ ...CHROME_BASE, ...CHROME_PALETTE })) {
      expect(root[token], `${token} in style.css`).toBe(value)
    }

    // Positive control: the parse reads real values, so a missing token above
    // is not a parse that silently found nothing.
    expect(root['--text-primary']).toBe('#f0f0f5')
  })

  it('S-118: restates no colour as a var() fallback', () => {
    const literal = /var\(--[a-z0-9-]+,\s*(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))\)/g

    for (const path of sourceFiles()) {
      const source = readFileSync(path, 'utf8')
      const found = source.match(literal) ?? []
      expect(found, `${path} restates colours: ${found.join(', ')}`).toEqual([])
    }

    // Positive control: the pattern notices the shape it forbids.
    expect('color: var(--text-primary, #f0f0f5)'.match(literal)).toEqual([
      'var(--text-primary, #f0f0f5)',
    ])
    // A neutral fallback is allowed: it fails visibly, not with another colour.
    expect('color: var(--note-text, currentColor)'.match(literal)).toBeNull()
  })

  it('S-119: publishes the palette outside the editor and the theme inside it', () => {
    const references = useTheme(ref('references'))
    expect(references.uiTextPrimary.value).toBe(CHROME_PALETTE['--text-primary'])
    expect(references.uiTextSecondary.value).toBe(CHROME_PALETTE['--text-secondary'])
    expect(references.uiAccent.value).toBe(CHROME_PALETTE['--accent'])
    expect(references.uiAccentActive).toBeDefined()
    expect(references.uiAccentActive.value).toBe(CHROME_PALETTE['--accent-active'])
    expect(references.uiGlassBg.value).toBe(CHROME_PALETTE['--glass-bg'])

    // Positive control: inside the editor the same computed reads the theme,
    // so the assertions above are not passing on one frozen value.
    const editor = useTheme(ref('editor'))
    expect(editor.uiTextPrimary.value).toBe(editor.currentTheme.value.text)
    expect(references.uiTextPrimary.value).not.toBe(editor.uiTextPrimary.value)

    // A computed that never reaches the return object binds undefined, and the
    // element inherits the root's first-paint blue instead (S-132's trap).
    expect(editor.uiAccentActive.value).toBe(editor.currentTheme.value.accentActive)
    expect(editor.uiAccentActive.value).not.toBe(CHROME_PALETTE['--accent-active'])
  })
})
