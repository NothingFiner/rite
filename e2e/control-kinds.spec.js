import { test, expect } from '@playwright/test'
import { installTauriIpc } from './helpers/tauri-ipc.js'
import { paragraph, referenceEntry, section } from './helpers/fixtures.js'
import { contrastRatio, TEXT_CONTRAST_FLOOR } from '../src/composables/paperPalette.js'

// The control layer in a real browser (SPEC.md revision 9, S-129 … S-131).
//
// The unit layer can only see which class a component publishes. These three
// ask the questions jsdom cannot answer: how tall and how joined a control is,
// and what colour it actually resolves to. The colour question matters here
// because the reference panel lives on the writer's paper, not the chrome.

const seededDoc = {
  title: 'Control Novel',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    section('c1', 'Chapter One', 'chapter', [
      paragraph('p-c1', 'Izildar Qualen kept the record of the Ashfall.'),
      paragraph('p-c2', 'The square was empty by the second bell.'),
    ]),
  ],
}

const references = {
  entries: [
    referenceEntry('e-qualen', 'character', 'Izildar Qualen', {
      definition: 'The keeper of the Ashfall record.',
    }),
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

test('S-129: opens the two add options at the circle’s height, joined to it', async ({ page }) => {
  await openApp(page)

  await page.click('button[title="Sections"]')
  await expect(page.locator('.drawer.left.open .add-btn')).toBeVisible({ timeout: 5000 })
  await page.click('.drawer.left.open .add-btn')
  await expect(page.locator('.drawer.left.open .add-confirm').first()).toBeVisible()

  // The circle scales under the pointer and the options slide in, so the
  // resting geometry is polled rather than sampled once after the click.
  const geometry = () =>
    page.evaluate(() => {
      const read = (node) => {
        const { height, left, right } = node.getBoundingClientRect()
        return { height, left, right }
      }
      return {
        circle: read(document.querySelector('.drawer.left.open .add-btn')),
        options: [...document.querySelectorAll('.drawer.left.open .add-confirm')].map(read),
      }
    })

  await page.mouse.move(0, 0)

  const joined = () =>
    geometry().then(
      (boxes) =>
        boxes.options.length === 2
        && Math.abs(boxes.options[0].left - boxes.circle.right) <= 1
        && Math.abs(boxes.options[1].left - boxes.options[0].right) <= 1,
    )
  await expect.poll(joined, { timeout: 3000 }).toBe(true)

  const boxes = await geometry()
  for (const option of boxes.options) {
    expect(Math.abs(option.height - boxes.circle.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(option.height - 32)).toBeLessThanOrEqual(1)
  }
})

test('S-130: paints only the chosen segment in the accent', async ({ page }) => {
  await openApp(page)

  const segmentPaint = (selector) =>
    page.evaluate((chosen) => {
      const active = document.querySelector(`${chosen}[aria-selected="true"]`)
      const resting = [...document.querySelectorAll(chosen)].find(
        (node) => node.getAttribute('aria-selected') !== 'true',
      )
      const read = (node) => {
        const style = getComputedStyle(node)
        return { color: style.color, background: style.backgroundColor }
      }
      return { active: read(active), resting: read(resting) }
    }, selector)

  const toolbar = await segmentPaint('.view-tabs .view-tab')
  expect(toolbar.active.color).toBe('rgb(79, 142, 247)')
  expect(toolbar.active.background).not.toBe(toolbar.resting.background)
  expect(toolbar.resting.color).not.toBe(toolbar.active.color)

  await page.locator('.view-tab').filter({ hasText: 'References' }).click()
  await expect(page.locator('.surface-tabs')).toBeVisible({ timeout: 5000 })

  // The panel is on the paper, so the chosen surface takes the theme's accent
  // (Mist #B5651D), never the chrome's blue.
  const surfaces = await segmentPaint('.surface-tabs .surface-tab')
  expect(surfaces.active.color).toBe('rgb(181, 101, 29)')
  expect(surfaces.active.background).not.toBe(surfaces.resting.background)
})

test('S-131: paints a control on the References page in the theme ink', async ({ page }) => {
  await openApp(page)

  await page.locator('.view-tab').filter({ hasText: 'References' }).click()
  await expect(page.locator('.surface-tabs')).toBeVisible({ timeout: 5000 })

  const painted = await page.evaluate(() => {
    const control = document.querySelector('.surface-tab[aria-selected="false"]')
    const panel = document.querySelector('.references-view')
    return {
      text: getComputedStyle(control).color,
      border: getComputedStyle(control).borderRightColor,
      paper: getComputedStyle(panel).backgroundColor,
    }
  })

  // The default theme is Mist: paper #D8D3D6 with ink #515359.
  expect(painted.text).not.toBe('rgb(240, 240, 245)')
  expect(painted.text.startsWith('rgba(81, 83, 89')).toBe(true)
  expect(painted.border.startsWith('rgba(81, 83, 89')).toBe(true)
  expect(contrastRatio(painted.text, painted.paper)).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR)
})
