import { test, expect } from '@playwright/test'
import { installTauriIpc } from './helpers/tauri-ipc.js'

// 5.4 writing stats end to end: ActivityBar → StatsDrawer → useWritingStats.
//
// `docFails: true` makes get_document reject so the store falls back to its default
// document, exactly as the other harness specs do; nothing here depends on the Rust
// sync path. The word count that matters comes from useWordCount over the live
// document, so typing in the real editor is the only way to move it.

async function openApp(page) {
  await installTauriIpc(page, { docFails: true })
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
}

async function openStats(page) {
  // Assert, then click: a missing Stats item must read as a failed assertion
  // rather than an opaque timeout deeper in the flow.
  const button = page.locator('.activity-icon[title="Stats"]')
  await expect(button).toBeVisible({ timeout: 5000 })
  await button.click()
  await expect(page.locator('.stats-drawer')).toBeVisible({ timeout: 5000 })
}

async function setTarget(page, words) {
  const input = page.locator('.stats-drawer input')
  await input.fill(String(words))
  await input.press('Enter')
}

/** The number in "N written of M", or null when the graph is not drawn. */
async function written(page) {
  const graph = page.locator('.stats-drawer [role="img"]')
  if ((await graph.count()) === 0) return null
  const label = await graph.getAttribute('aria-label')
  const found = /^(\d+) written of (\d+)$/.exec(label ?? '')
  return found ? Number(found[1]) : NaN
}

const typeWords = (page, text) => page.keyboard.type(text)

test('S-015: Stats item accepts a target and shows progress that grows with typing', async ({ page }) => {
  await openApp(page)
  await openStats(page)
  await setTarget(page, 1000)

  await expect(page.locator('.stats-drawer [role="img"]'))
    .toHaveAttribute('aria-label', /^\d+ written of 1000$/)

  const before = await written(page)
  expect(before).not.toBeNull()

  await page.locator('.editor-sheet .paragraph').first().click()
  await typeWords(page, 'alpha bravo charlie delta echo')

  await expect.poll(() => written(page), { timeout: 5000 }).toBe(before + 5)
})

test('S-016: target and today\'s progress survive a reload', async ({ page }) => {
  await openApp(page)
  await openStats(page)
  await setTarget(page, 750)

  await page.locator('.editor-sheet .paragraph').first().click()
  await typeWords(page, 'one two three')
  await expect.poll(() => written(page), { timeout: 5000 }).not.toBeNull()

  await page.reload()
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
  await openStats(page)

  // The target is remembered, so the graph renders instead of the prompt.
  await expect(page.locator('.stats-drawer input')).toHaveValue('750')
  await expect(page.locator('.stats-drawer [role="img"]'))
    .toHaveAttribute('aria-label', /^\d+ written of 750$/)
})
