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
    // Scope to `.view-tab`: a bare `button:has-text("Manuscript")` also matches
    // the manuscript view's off-screen zoom-row control (rendered but positioned
    // left of the viewport in editor view), which Playwright's non-strict click
    // would resolve first — landing the click on the activity bar instead.
    await page.click('button.view-tab:has-text("Manuscript")')
    await expect(page.locator('.manuscript-viewport')).toBeVisible()
    // The manuscript view paginates `allPages` — a title page plus one or more
    // content pages — so the page count varies with the doc. Assert at least one
    // page rendered, not a fixed count (the old `toHaveCount(1)` broke once the
    // title page existed).
    await expect(page.locator('.manuscript-page')).not.toHaveCount(0)
  })

  test('can toggle back to editor mode', async ({ page }) => {
    await page.click('button.view-tab:has-text("Manuscript")')
    await expect(page.locator('.manuscript-viewport')).toBeVisible()
    await page.click('button.view-tab:has-text("Editor")')
    await expect(page.locator('.editor-sheet')).toBeVisible()
  })

  test('can open left drawer', async ({ page }) => {
    // The ActivityBar's Sections button (title="Sections") opens the chapters
    // left drawer. (Was `button[title="Open Navigation"]` — a stale selector from
    // before the ActivityBar rename.)
    await page.click('button[title="Sections"]')
    // Four left drawers share `.drawer.left` (Sections / General / Text / History),
    // only one ever open at once — assert the open one exists, rather than the
    // strict-mode-violating `.drawer.left` which matches all four.
    const openDrawer = page.locator('.drawer.left.open')
    await expect(openDrawer).toHaveCount(1)
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
    // `.drawer.left` matches all four left drawers (strict-mode violation); the
    // open one is unique at any time, so assert on `.drawer.left.open`.
    const openDrawer = page.locator('.drawer.left.open')
    await expect(openDrawer).toHaveCount(1)

    // The in-header Versions button (not the tab) owns open/close of the list.
    const versionsToggle = page.locator('.history-versions-toggle')
    await versionsToggle.click()
    await expect(openDrawer).toHaveCount(0)

    // ...and toggles it open again.
    await versionsToggle.click()
    await expect(openDrawer).toHaveCount(1)
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
    // Click inside a paragraph BLOCK (`.paragraph`), not the bare `.editor-sheet`:
    // clicking the sheet roots the caret on the contenteditable itself, so typed
    // text becomes a direct text node of the sheet that the readback never walks
    // — the store word count stays 0. Landing in a `.paragraph` div lets the
    // reconciler pick the text up. `useWordCount` debounces 300ms; the expect's
    // own retry window covers that, so no fixed sleep.
    const firstParagraph = page.locator('.editor-sheet .paragraph').first()
    await firstParagraph.click()
    await page.keyboard.type('One two three')
    await expect(page.locator('.word-count')).toContainText('3 words')
  })

  test('a chapter inserted without a subtitle renders as just "Chapter 1" (5.9)', async ({ page }) => {
    // The subtitle is optional data: an unnamed chapter must render clean —
    // no colon, no subtitle span — once its fresh (inline-typing) state ends.
    // Insert is LOCAL (no invoke), so no IPC mock is needed; the debounced
    // sync fails silently after the assertions.
    await page.click('button[title="Sections"]')
    // The drawer slides open (250ms transform) — settle before clicking in it.
    await page.waitForTimeout(350)
    await page.click('.drawer.left.open .add-btn')
    await page.click('.drawer.left.open .add-confirm:has-text("+ Chapter")')

    // Fresh: the heading is editable with the empty subtitle span (the
    // inline type-a-subtitle affordance).
    const heading = page.locator('.editor-sheet .section-title.chapter')
    await expect(heading).toHaveCount(1)
    await expect(heading.locator('.section-subtitle')).toHaveCount(1)

    // Click away on the editor → the fresh state ends and the heading
    // collapses to "Chapter 1" with no colon and no subtitle span. Close the
    // drawer first so it doesn't overlay the click target, then land the
    // click-away inside a paragraph (the sheet's mousedown handler is what
    // ends the fresh state).
    await page.click('button[title="Sections"]')
    await expect(page.locator('.drawer.left.open')).toHaveCount(0)
    await page.click('.editor-sheet .paragraph', { position: { x: 100, y: 10 } })
    await expect(heading).toHaveText('Chapter 1')
    await expect(heading.locator('.section-subtitle')).toHaveCount(0)
    await expect(heading).toHaveAttribute('contenteditable', 'false')
  })
})
