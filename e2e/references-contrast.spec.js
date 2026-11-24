import { test, expect } from '@playwright/test'
import { installTauriIpc } from './helpers/tauri-ipc.js'
import { paragraph, referenceEntry, section } from './helpers/fixtures.js'
import { contrastRatio, TEXT_CONTRAST_FLOOR } from '../src/composables/paperPalette.js'

// The entry page's colours on the writer's paper (SPEC.md revision 7, S-116).
//
// The failing state was measured, not guessed: the definition body came out
// near-white on the default light theme. This test reads the computed styles
// the browser actually paints, so a token that resolves to the chrome palette
// fails here even if every style binding looks right.

const seededDoc = {
  title: 'Reference Novel',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    section('c1', 'Chapter One', 'chapter', [
      paragraph('p-c1', 'Izildar Qualen kept the record of the Ashfall.'),
    ]),
  ],
}

const references = {
  entries: [
    referenceEntry('e-qualen', 'character', 'Izildar Qualen', {
      definition: 'The keeper of the Ashfall record.',
      aliases: ['Izi'],
    }),
  ],
}

async function openEntryPage(page) {
  await installTauriIpc(page, { doc: seededDoc })
  await page.addInitScript((seed) => {
    window.__tauriMock.route('retrieve_references', () => seed)
  }, references)
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })

  await page.locator('.view-tab').filter({ hasText: 'References' }).click()
  await expect(page.locator('.references-view')).toBeVisible({ timeout: 5000 })
  await page.locator('.surface-tab[data-surface="characters"]').click()
  await page.locator('.reference-entry[data-entry-id="e-qualen"]').click()
  await expect(page.locator('.reference-definition')).toBeVisible({ timeout: 5000 })
}

test('S-116: paints the entry page’s text in the theme ink, not the chrome palette', async ({
  page,
}) => {
  await openEntryPage(page)

  const painted = await page.evaluate(() => {
    const definition = document.querySelector('.reference-definition')
    const view = document.querySelector('.references-view')
    return {
      text: getComputedStyle(definition).color,
      paper: getComputedStyle(view).backgroundColor,
    }
  })

  // The default theme is Mist: ink #515359 on paper #D8D3D6.
  expect(painted.text).toBe('rgb(81, 83, 89)')
  expect(painted.text).not.toBe('rgb(240, 240, 245)')
  expect(contrastRatio(painted.text, painted.paper)).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR)
})
