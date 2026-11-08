import { test, expect } from '@playwright/test'
import { installTauriIpc } from './helpers/tauri-ipc.js'

// Focus / typewriter mode (roadmap 5.3), end to end in real Chromium.
//
// The unit layer (src/composables/useFocusMode.test.js) covers the mode's state
// and keyboard routing; jsdom has no layout, so everything observable only with
// a real viewport lives here: the chrome actually disappearing, the editor
// actually widening, and the caret paragraph actually landing in the middle.
//
// Tauri IPC is the shared mock from ./helpers/tauri-ipc.js, seeded with a LONG
// document instead of the default one — centring a paragraph is meaningless in a
// one-paragraph document.

const PARAGRAPH_COUNT = 40

const seededDoc = (() => {
  const style = { bold: false, italic: false, underline: false, fontSize: null }
  const paragraph = (i) => ({
    id: 'p-' + i,
    elements: [
      {
        textRun: {
          content:
            `Paragraph ${i}. ` +
            'The door opened onto a quiet street and the rain kept falling, ' +
            'steady and grey, until the whole afternoon had gone soft at the edges.',
          textStyle: style,
        },
      },
    ],
    leftIndent: null,
    rightIndent: null,
    firstLineIndent: null,
  })
  const sections = [0, 1].map((s) => ({
    id: 's-' + s,
    title: '',
    sectionType: 'section',
    hidden: false,
    paragraphs: Array.from({ length: PARAGRAPH_COUNT / 2 }, (_, k) =>
      paragraph(s * (PARAGRAPH_COUNT / 2) + k),
    ),
  }))

  return {
    title: 'Untitled',
    author: 'Author Name',
    authorContact: '',
    hasTOC: false,
    sections,
  }
})()

function installIpcMock(page) {
  return installTauriIpc(page, { doc: seededDoc })
}

async function open(page) {
  await installIpcMock(page)
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
}

async function enterFocusMode(page) {
  await page.keyboard.press('Meta+Shift+f')
  await expect(page.locator('.toolbar')).toBeHidden()
}

/// Vertical distance between an element's centre and the viewport's centre.
///
/// Takes a Locator, never a CSS selector, so the element measured is provably
/// the same node the test acted on. The editor renders `.paragraph` and
/// `.section-title` as sibling <div>s (useParagraphHTML.js), so any positional
/// selector — `:nth-of-type`, `:nth-child` — counts both kinds and silently
/// drifts onto a different paragraph at every section boundary. Binding to
/// `data-para-id` (stamped by the renderer) removes that failure mode: a
/// mistyped id throws "element not found" instead of returning a distance to
/// some other paragraph.
function centreOffset(locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return Math.abs(r.top + r.height / 2 - window.innerHeight / 2)
  })
}

test.describe('focus mode', () => {
  test('S-011: hides the toolbar, activity bar and status bar', async ({ page }) => {
    await open(page)
    await expect(page.locator('.toolbar')).toBeVisible()

    await page.keyboard.press('Meta+Shift+f')

    await expect(page.locator('.toolbar')).toBeHidden()
    await expect(page.locator('.activity-bar')).toBeHidden()
    await expect(page.locator('.statusbar')).toBeHidden()
  })

  test('S-012: widens the editor to the full window width', async ({ page }) => {
    await open(page)
    const before = await page.locator('.editor-sheet').boundingBox()

    await enterFocusMode(page)

    expect(before.x).toBeGreaterThan(40)
    // The sheet widens when the sidebars unmount, which lands later than the
    // toolbar hiding that `enterFocusMode` waits for. A one-shot boundingBox()
    // can therefore measure the pre-reflow layout and fail a correct build, so
    // poll the same assertion rather than sampling once.
    await expect
      .poll(async () => (await page.locator('.editor-sheet').boundingBox()).x)
      .toBeLessThan(16)
  })

  test('S-013: keeps the text editable', async ({ page }) => {
    await open(page)
    await enterFocusMode(page)

    const first = page.locator('.editor-sheet .paragraph').first()
    await first.click()
    await page.keyboard.type('Still typing in focus mode')

    await expect(first).toContainText('Still typing in focus mode')
  })

  test('S-014: restores the chrome on exit, leaving the text unchanged', async ({ page }) => {
    await open(page)
    const first = page.locator('.editor-sheet .paragraph').first()
    await first.click()
    await page.keyboard.type('A line that should survive')
    await enterFocusMode(page)
    await expect(page.locator('.toolbar')).toBeHidden()

    await page.keyboard.press('Meta+Shift+f')

    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(page.locator('.activity-bar')).toBeVisible()
    await expect(page.locator('.statusbar')).toBeVisible()
    await expect(first).toContainText('A line that should survive')
  })

  test('S-015: opens the search panel without leaving focus mode', async ({ page }) => {
    await open(page)
    await enterFocusMode(page)

    await page.keyboard.press('Meta+f')

    await expect(page.locator('.search-panel')).toBeVisible()
    await expect(page.locator('.toolbar')).toBeHidden()
  })

  test('S-009: does not open the sections drawer while focus mode is active', async ({ page }) => {
    await open(page)
    await enterFocusMode(page)

    await page.keyboard.press('Meta+Enter')

    await expect(page.locator('.drawer.left.open')).toHaveCount(0)
    await expect(page.locator('.toolbar')).toBeHidden()
  })

  test('S-016: centres the caret paragraph when entering focus mode', async ({ page }) => {
    await open(page)
    const target = page.locator('.editor-sheet .paragraph[data-para-id="p-20"]')
    await target.click()

    await enterFocusMode(page)

    await expect.poll(() => centreOffset(target), {
      timeout: 3000,
    }).toBeLessThan(60)
  })

  test('S-017: re-centres when the caret moves to another paragraph', async ({ page }) => {
    await open(page)
    await enterFocusMode(page)
    const other = page.locator('.editor-sheet .paragraph[data-para-id="p-32"]')
    await other.click()

    await expect.poll(() => centreOffset(other), {
      timeout: 3000,
    }).toBeLessThan(60)
  })

  test('S-018: leaves no blank space above the first paragraph', async ({ page }) => {
    await open(page)
    const first = page.locator('.editor-sheet .paragraph').first()
    await first.click()

    await enterFocusMode(page)

    const top = await page.evaluate(() => {
      const el = document.querySelector('.editor-sheet .paragraph')
      return el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY
    })
    const viewportHeight = page.viewportSize().height
    expect(top).toBeGreaterThanOrEqual(0)
    expect(top).toBeLessThan(viewportHeight / 4)
  })
})
