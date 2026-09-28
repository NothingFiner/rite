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
    // The ActivityBar's Sections button (title="Sections") opens the chapters
    // left drawer. (Was `button[title="Open Navigation"]` — a stale selector from
    // before the ActivityBar rename.)
    await page.click('button[title="Sections"]')
    const drawer = page.locator('.drawer.left')
    await expect(drawer).toHaveClass(/open/)
  })

  test('can open right drawer', async ({ page }) => {
    // The Toolbar's Assistant toggle (title="Open Assistant" when closed) opens
    // the right drawer. (Was `button[title="Open Info"]` — a stale selector.)
    await page.click('button[title="Open Assistant"]')
    const drawer = page.locator('.drawer.right')
    await expect(drawer).toHaveClass(/open/)
  })

  test('can toggle the history version-list drawer', async ({ page }) => {
    // The History view tab switches to the History view AND opens the version
    // list on first entry (Scheme A: the tab is view-switch-only thereafter).
    await page.click('button.view-tab:has-text("History")')
    await expect(page.locator('.history-view')).toBeVisible()
    const drawer = page.locator('.drawer.left')
    await expect(drawer).toHaveClass(/open/)

    // The in-header Versions button (not the tab) owns open/close of the list.
    const versionsToggle = page.locator('.history-versions-toggle')
    await versionsToggle.click()
    await expect(drawer).not.toHaveClass(/open/)

    // ...and toggles it open again.
    await versionsToggle.click()
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
