// The pages that paint themselves with the writer's theme
// (SPEC.md revision 7, S-115).
//
// The contrast bug was one rule reaching for a chrome token, and it will come
// back the same way: a new page rule copies a nearby one. So the guard reads
// the four components' style blocks and fails on any chrome token, whether or
// not the current palette would survive it.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES = [
  'ReferencesView.vue',
  'ReferenceEntryView.vue',
  'ReferencesNavDrawer.vue',
  'NotesView.vue',
]

// The chrome palette useTheme.js flips outside the editor. A themed page owns
// none of these names.
const CHROME_TOKENS = [
  'text-primary',
  'text-secondary',
  'glass-bg',
  'bg-glass-border',
  'hover-bg',
  'hover-bg-strong',
  'input-bg',
  'popup-bg',
  'accent',
  'accent-bg',
  'accent-hover',
  'bg-base',
]

function styleBlocks(file) {
  const source = readFileSync(join(process.cwd(), 'src', 'components', file), 'utf8')
  return source.match(/<style[^>]*>[\s\S]*?<\/style>/g) ?? []
}

describe('theme-painted pages', () => {
  it('S-115: read no chrome colour token in their styles', () => {
    for (const page of PAGES) {
      const blocks = styleBlocks(page)
      expect(blocks.length, `${page} should carry a style block`).toBeGreaterThan(0)

      for (const block of blocks) {
        // `var(--note-accent` must not count as `var(--accent`, so the match
        // is anchored on the opening parenthesis.
        const used = block.match(new RegExp(`var\\(--(${CHROME_TOKENS.join('|')})\\)`, 'g')) ?? []
        expect(used, `${page} reads chrome tokens: ${used.join(', ')}`).toEqual([])
      }
    }

    // Positive control: the guard notices a violation when one exists.
    const sample = 'color: var(--text-primary);'
    expect(sample.match(new RegExp(`var\\(--(${CHROME_TOKENS.join('|')})\\)`, 'g'))).toEqual([
      'var(--text-primary)',
    ])
  })
})
