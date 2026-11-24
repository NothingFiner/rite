// Where a token alias is declared (SPEC.md revision 10, S-132).
//
// Revision 9 declared the control aliases in :root while App.vue publishes the
// chrome tokens on .app-container. A var() inside a custom property resolves on
// the element that declares it, so the aliases froze to the root's dark-chrome
// values and every control painted chrome white on the editor's light glass.
//
// This is a source guard because the failure is a placement, not a value: no
// computed value on the root is wrong. Only the pairing of "which element
// publishes" with "which element aliases" is.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')

/// The custom properties App.vue binds in its root element's :style object.
/// Those are the tokens a descendant sees only through that element.
function publishedTokens() {
  const app = readFileSync(join(SRC, 'App.vue'), 'utf8')
  const style = /:style="\{([\s\S]*?)\}"/.exec(app)?.[1]
  expect(style, 'App.vue should publish tokens in a :style object').toBeTruthy()
  return new Set([...style.matchAll(/'(--[a-z0-9-]+)'\s*:/g)].map((match) => match[1]))
}

/// Every rule in style.css, as selector plus body.
function rules() {
  const css = readFileSync(join(SRC, 'style.css'), 'utf8')
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }))
}

/// The aliases a rule declares: `--a: var(--b)` pairs, with the rule's selector.
function aliases(selector, body) {
  const found = []
  for (const match of body.matchAll(/(-{2}[a-z0-9-]+)\s*:\s*var\((--[a-z0-9-]+)\)/g)) {
    found.push({ selector, token: match[1], source: match[2] })
  }
  return found
}

describe('token alias placement', () => {
  it('S-132: declares an alias where its source token is published', () => {
    const published = publishedTokens()
    const offenders = rules()
      .flatMap((rule) => aliases(rule.selector, rule.body))
      .filter((alias) => published.has(alias.source) && !alias.selector.includes('.app-container'))
      .map((alias) => `${alias.selector} aliases ${alias.source} as ${alias.token}`)

    expect(offenders).toEqual([])

    // Positive control: App.vue really does publish the token the control ink
    // aliases, and the control ink is declared on the element that receives it.
    expect([...published]).toContain('--text-primary')
    const controlInk = rules()
      .flatMap((rule) => aliases(rule.selector, rule.body))
      .filter((alias) => alias.token === '--control-text')
    expect(controlInk.length).toBeGreaterThanOrEqual(1)
    expect(controlInk.every((alias) => alias.selector.includes('.app-container'))).toBe(true)
  })
})
