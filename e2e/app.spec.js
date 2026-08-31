import { test, expect } from '@playwright/test'

test.describe('Rite App', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.editor-sheet, .manuscript-viewport', { timeout: 5000 })
  })

  test('loads with editor visible', async ({ page }) => {
    const editor = page.locator('.editor-sheet')
    await expect(editor).toBeVisible()
  })

  test('toolbar is visible', async ({ page }) => {
    const toolbar = page.locator('.toolbar')
    await expect(toolbar).toBeVisible()
  })

  test('status bar is visible', async ({ page }) => {
    const statusBar = page.locator('.statusbar')
    await expect(statusBar).toBeVisible()
  })

  test('can toggle manuscript mode', async ({ page }) => {
    await page.click('button:has-text("Manuscript")')
    await expect(page.locator('.manuscript-viewport')).toBeVisible()
    await expect(page.locator('.manuscript-page')).toHaveCount(1)
  })

  test('can toggle back to editor mode', async ({ page }) => {
    await page.click('button:has-text("Manuscript")')
    await expect(page.locator('.manuscript-viewport')).toBeVisible()
    await page.click('button:has-text("Editor")')
    await expect(page.locator('.editor-sheet')).toBeVisible()
  })

  test('can open left drawer', async ({ page }) => {
    await page.click('button[title="Open Navigation"]')
    const drawer = page.locator('.drawer.left')
    await expect(drawer).toHaveClass(/open/)
  })

  test('can open right drawer', async ({ page }) => {
    await page.click('button[title="Open Info"]')
    const drawer = page.locator('.drawer.right')
    await expect(drawer).toHaveClass(/open/)
  })

  test('typing in editor creates paragraphs', async ({ page }) => {
    const editor = page.locator('.editor-sheet')
    await editor.click()
    await page.keyboard.type('Hello world')
    await expect(editor).toContainText('Hello world')
  })

  test('search panel opens with Cmd+F', async ({ page }) => {
    await page.keyboard.press('Meta+f')
    await expect(page.locator('.search-panel')).toBeVisible()
  })

  test('search panel closes with Escape', async ({ page }) => {
    await page.keyboard.press('Meta+f')
    await expect(page.locator('.search-panel')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.search-panel')).not.toBeVisible()
  })

  test('can toggle replace in search panel', async ({ page }) => {
    await page.keyboard.press('Meta+f')
    await page.click('button[title="Toggle Replace"]')
    await expect(page.locator('input[placeholder="Replace..."]')).toBeVisible()
  })

  test('word count updates when typing', async ({ page }) => {
    const editor = page.locator('.editor-sheet')
    await editor.click()
    await page.keyboard.type('One two three')
    await page.waitForTimeout(200)
    const wordCount = page.locator('.word-count')
    await expect(wordCount).toContainText('3 words')
  })
})
