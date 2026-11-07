import { test, expect } from '@playwright/test'
import { installTauriIpc } from './helpers/tauri-ipc.js'

// Color controls in the Text Options drawer (SPEC.md 5.13, S-007, S-008 and
// S-015), in real Chromium.
//
// The unit layer (src/components/TextOptionsDrawer.spec.js and
// src/composables/useTheme.test.js) covers the swatch rows, the preset match and
// the stored preferences in isolation. What only a real page can show is the
// paint reaching the editor sheet while the drawer stays open. The keyboard path
// through the swatches into the sheet itself is here too.
//
// Tauri IPC is the shared mock from ./helpers/tauri-ipc.js, seeded with a short
// document so the sheet is on screen at load.

function paragraph(id, body) {
  return {
    id,
    elements: [
      {
        textRun: {
          content: body,
          textStyle: { bold: false, italic: false, underline: false, fontSize: null },
        },
      },
    ],
    leftIndent: null,
    rightIndent: null,
    firstLineIndent: null,
  }
}

const DOC = {
  title: 'Color',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    {
      id: 's-1',
      title: 'Chapter One',
      sectionType: 'chapter',
      hidden: false,
      paragraphs: [
        paragraph('s-1-p1', 'The lamp was still lit when the rain began.'),
        paragraph('s-1-p2', 'She read until the house had gone quiet around her.'),
      ],
    },
  ],
}

const sheet = (page) => page.locator('.editor-sheet')
const swatch = (page, name) => page.getByRole('button', { name, exact: true })
const preset = (page, name) => page.getByRole('button', { name, exact: true })
const drawer = (page) => page.locator('.drawer.left.open')

async function openTextOptions(page) {
  await installTauriIpc(page, { doc: DOC })
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
  await page.locator('.activity-icon[title="Text Options"]').click()
  await expect(drawer(page)).toBeVisible({ timeout: 5000 })
}

const focusedName = (page) =>
  page.evaluate(() => {
    const active = document.activeElement
    return active ? (active.getAttribute('aria-label') || active.textContent || '').trim() : ''
  })

test('S-007: the Forest preset repaints the sheet with the drawer still open', async ({ page }) => {
  await openTextOptions(page)
  await expect(sheet(page)).toHaveCSS('background-color', 'rgb(216, 211, 214)')

  await expect(preset(page, 'Forest')).toBeVisible()
  await preset(page, 'Forest').click()

  await expect(sheet(page)).toHaveCSS('background-color', 'rgb(71, 88, 65)')
  await expect(sheet(page)).toHaveCSS('color', 'rgb(255, 226, 214)')
  await expect(drawer(page)).toBeVisible()
})

test('S-008: a mixed background and text paint the sheet, and the background survives the text pick', async ({ page }) => {
  await openTextOptions(page)

  await expect(swatch(page, 'Background Sky background')).toBeVisible()
  await swatch(page, 'Background Sky background').click()

  await expect(sheet(page)).toHaveCSS('background-color', 'rgb(219, 225, 241)')
  await expect(sheet(page)).toHaveCSS('color', 'rgb(81, 83, 89)')

  await expect(swatch(page, 'Text Sepia text')).toBeVisible()
  await swatch(page, 'Text Sepia text').click()

  await expect(sheet(page)).toHaveCSS('color', 'rgb(102, 75, 71)')
  await expect(sheet(page)).toHaveCSS('background-color', 'rgb(219, 225, 241)')
})

test('S-015: Tab reaches the swatches and Enter applies the focused one', async ({ page }) => {
  await openTextOptions(page)

  // The manuscript format select is the last control before the color rows.
  await page.locator('.text-options select').last().focus()
  await page.keyboard.press('Tab')

  expect(await focusedName(page)).toBe('Background Mist background')

  // The text and accent rows already hold two of the Mist colors, which
  // disables them. A browser tab order skips a disabled button.
  await page.keyboard.press('Tab')
  expect(await focusedName(page)).toBe('Background Sepia background')

  await page.keyboard.press('Enter')

  await expect(sheet(page)).toHaveCSS('background-color', 'rgb(237, 209, 176)')
})

// --- affordance ----------------------------------------------------------------
//
// Whether a choice is visible, and whether a control looks clickable, are
// computed styles. jsdom loads no stylesheet, so only a real page can answer.

const ROWS = ['background', 'text', 'accent']

/** The decoration a swatch carries, ignoring the color it shows. */
const decoration = (locator) =>
  locator.evaluate((el) => {
    const style = getComputedStyle(el)
    return [style.outlineStyle, style.outlineWidth, style.boxShadow, style.backgroundImage].join('|')
  })

test('S-016: the chosen swatch in each row carries a visible mark', async ({ page }) => {
  await openTextOptions(page)

  for (const row of ROWS) {
    const swatches = page.locator(`.swatch-row[data-row="${row}"] .color-swatch`)
    const current = page.locator(
      `.swatch-row[data-row="${row}"] .color-swatch[aria-current="true"]`,
    )
    await expect(current).toHaveCount(1)

    // The last swatch of a row is neither current nor held elsewhere, so any
    // difference in decoration is the mark the sentence asks for.
    const plain = swatches.last()
    expect(await decoration(current)).not.toBe(await decoration(plain))
  }
})

test('S-017: swatches, presets and the selects show a pointer cursor', async ({ page }) => {
  await openTextOptions(page)

  for (const row of ROWS) {
    await expect(page.locator(`.swatch-row[data-row="${row}"] .color-swatch`).first()).toHaveCSS(
      'cursor',
      'pointer',
    )
  }

  await expect(page.locator('.theme-preset').first()).toHaveCSS('cursor', 'pointer')

  const selects = page.locator('.text-options select')
  await expect(selects).toHaveCount(2)
  await expect(selects.first()).toHaveCSS('cursor', 'pointer')
  await expect(selects.last()).toHaveCSS('cursor', 'pointer')
})
