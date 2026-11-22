import { test, expect } from '@playwright/test'
import { paragraph, referenceEntry } from './helpers/fixtures.js'
import { emitMenu, installTauriIpc, invoked } from './helpers/tauri-ipc.js'

// The reference lookup from a word in the manuscript (SPEC.md revision 6,
// S-105, S-106 and S-112).
//
// Playwright cannot click a native menu. These tests assert that the right-click
// asked Rust for the menu, then deliver the id that menu emits and follow what
// the app does next. The submenu's own contents are pinned in `src-tauri/tests`.

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
      paragraphs: [paragraph('p-c1', 'Essidor Agjadoff met Izildar Qualen by Qualen Square.')],
    },
  ],
}

const references = {
  entries: [
    referenceEntry('e-qualen', 'character', 'Izildar Qualen'),
    referenceEntry('e-square', 'place', 'Qualen Square'),
  ],
}

async function openApp(page) {
  await installTauriIpc(page, { doc: seededDoc })
  await page.addInitScript((seed) => {
    window.__tauriMock.route('retrieve_references', () => seed)
  }, references)
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

/// Right-click `needle`, prove the word reached Rust, then deliver the id the
/// menu would emit for `entryId`.
async function chooseFromMenu(page, needle, entryId) {
  const point = await wordPoint(page, needle)
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect
    .poll(() => invoked(page, 'show_word_menu', (args) => args.word === needle), { timeout: 5000 })
    .toBe(true)
  await emitMenu(page, `look_up_reference:${entryId}`)
}

test('S-105: choosing a menu item opens References on that entry and its surface', async ({
  page,
}) => {
  await openApp(page)
  await chooseFromMenu(page, 'Square', 'e-square')

  await expect(surfaceTab(page, 'glossary')).toHaveAttribute('aria-selected', 'true', {
    timeout: 5000,
  })
  await expect(page.locator('.reference-entry-heading')).toHaveText('Qualen Square')
})

test('S-106: a name in the manuscript offers the lookup and opens the chosen entry', async ({
  page,
}) => {
  await openApp(page)
  await chooseFromMenu(page, 'Izildar', 'e-qualen')

  await expect(page.locator('.reference-entry-heading')).toHaveText('Izildar Qualen', {
    timeout: 5000,
  })
  await expect(page.locator('.reference-entry-view')).toBeVisible()
})

test('S-112: the entry opens straight from the menu item, with no chooser between', async ({
  page,
}) => {
  await openApp(page)
  await chooseFromMenu(page, 'Izildar', 'e-qualen')

  // The positive control: the entry really opened, so the absence below is not
  // a page that never updated.
  await expect(page.locator('.reference-entry-view')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('.reference-lookup')).toHaveCount(0)
})
