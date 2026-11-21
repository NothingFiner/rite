import { test, expect } from '@playwright/test'
import { paragraph, referenceEntry } from './helpers/fixtures.js'
import { emitMenu, installTauriIpc, invoked } from './helpers/tauri-ipc.js'

// The reference lookup from a word in the manuscript (SPEC.md revision 5, S-105
// and S-106).
//
// Playwright cannot click a native menu. These tests assert that the right-click
// asked Rust for the menu, then deliver that menu's event and follow what the
// app does next. The item's own contents are pinned in `src-tauri/tests`.

const seededDoc = {
  title: 'Reference Novel',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    {
      id: 'c1',
      title: 'Chapter One',
      sectionType: 'chapter',
      hidden: false,
      paragraphs: [paragraph('p-c1', 'Essidor Agjadoff waited by Qualen Square.')],
    },
  ],
}

const references = {
  entries: [
    referenceEntry('e-qualen', 'character', 'Izildar Qualen'),
    referenceEntry('e-square', 'place', 'Qualen Square'),
  ],
}

/// What Rust's matcher returns for the word `Qualen`: both entries the word
/// belongs to, each with the name and kind the chooser shows.
const matches = [
  { id: 'e-qualen', name: 'Izildar Qualen', kind: 'character' },
  { id: 'e-square', name: 'Qualen Square', kind: 'place' },
]

async function openApp(page) {
  await installTauriIpc(page, { doc: seededDoc })
  await page.addInitScript(
    ({ seed, found }) => {
      window.__tauriMock
        .route('retrieve_references', () => seed)
        .route('reference_matches_for_word', () => found)
    },
    { seed: references, found: matches },
  )
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
}

/// The viewport point at the centre of the first `needle` in the editor sheet.
async function wordPoint(page, needle) {
  const point = await page.evaluate((text) => {
    const sheet = document.querySelector('.editor-sheet')
    const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const index = node.textContent.indexOf(text)
      if (index >= 0) {
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + text.length)
        const rect = range.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      }
      node = walker.nextNode()
    }
    return null
  }, needle)
  expect(point, `the paragraph should contain ${needle}`).not.toBeNull()
  return point
}

const surfaceTab = (page, surface) => page.locator(`.surface-tab[data-surface="${surface}"]`)
const lookupItem = (page, id) => page.locator(`.reference-lookup-item[data-entry-id="${id}"]`)

test('S-105: choosing a match opens References on that entry and its surface', async ({ page }) => {
  await openApp(page)

  const point = await wordPoint(page, 'Qualen')
  await page.mouse.click(point.x, point.y, { button: 'right' })
  // The control: the right-click reached Rust with the word under the pointer.
  await expect.poll(() => invoked(page, 'show_word_menu'), { timeout: 5000 }).toBe(true)

  await emitMenu(page, 'look_up_reference')

  const lookup = page.locator('.reference-lookup')
  await expect(lookup).toBeVisible({ timeout: 5000 })
  await expect(page.locator('.reference-lookup-item')).toHaveCount(2)
  await expect(lookupItem(page, 'e-square')).toContainText('Qualen Square')

  await lookupItem(page, 'e-square').click()

  await expect(surfaceTab(page, 'glossary')).toHaveAttribute('aria-selected', 'true', {
    timeout: 5000,
  })
  await expect(page.locator('.reference-entry-heading')).toHaveText('Qualen Square')
})

test('S-106: a name in the manuscript offers the lookup and opens the chosen entry', async ({
  page,
}) => {
  await openApp(page)

  const point = await wordPoint(page, 'Qualen')
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect
    .poll(
      () => invoked(page, 'show_word_menu', (args) => args.word === 'Qualen'),
      { timeout: 5000 },
    )
    .toBe(true)

  await emitMenu(page, 'look_up_reference')
  await expect(page.locator('.reference-lookup')).toBeVisible({ timeout: 5000 })

  await lookupItem(page, 'e-qualen').click()

  await expect(page.locator('.reference-entry-heading')).toHaveText('Izildar Qualen', {
    timeout: 5000,
  })
  await expect(page.locator('.reference-entry-view')).toBeVisible()
})
