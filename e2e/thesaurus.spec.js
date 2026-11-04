import { test, expect } from '@playwright/test'
import { emitMenu, installTauriIpc, ipcCalls, waitForMenuListener } from './helpers/tauri-ipc.js'

// The thesaurus, end to end (SPEC.md S-031 … S-035).
//
// Playwright cannot click a native menu, and the word menu here is native — so
// these tests prove the two halves a browser CAN answer: that a right-click on
// exactly one word asks Rust for the word menu (and a right-click on a phrase
// does not), and that once the `thesaurus` event arrives the popover, the mark
// and the OK all behave, with the replacement landing in the document in the
// original word's shape.
//
// The paragraph is deliberately "Happy, said the writer." — a capital and a
// comma, so the shaping is observable in the DOM afterwards.

const seededDoc = {
  title: 'Chapter One',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    {
      id: 's-0',
      title: 'Chapter One',
      sectionType: 'chapter',
      hidden: false,
      paragraphs: [
        {
          id: 'p-0',
          elements: [
            {
              textRun: {
                content: 'Happy, said the writer.',
                textStyle: { bold: false, italic: false, underline: false, fontSize: null },
              },
            },
          ],
          leftIndent: null,
          rightIndent: null,
          firstLineIndent: null,
        },
      ],
    },
  ],
}

const LOOKUP_RESULT = {
  word: 'happy',
  senses: [
    {
      partOfSpeech: 'adjective',
      senseNumber: 1,
      gloss: 'enjoying or showing or marked by joy or pleasure',
      synonyms: ['glad', 'cheerful'],
      antonyms: ['unhappy'],
    },
    {
      partOfSpeech: 'adjective',
      senseNumber: 2,
      gloss: 'eagerly disposed to act',
      synonyms: ['willing'],
      antonyms: [],
    },
  ],
}

/** The viewport point at the centre of the first `needle` in the editor sheet. */
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

/** Select `needle` in the sheet, the way a writer's drag would. */
async function selectWord(page, needle) {
  await page.evaluate((text) => {
    const sheet = document.querySelector('.editor-sheet')
    const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const index = node.textContent.indexOf(text)
      if (index >= 0) {
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + text.length)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        return
      }
      node = walker.nextNode()
    }
  }, needle)
}

async function open(page) {
  await installTauriIpc(page, { doc: seededDoc })
  await page.addInitScript(
    ({ result, doc }) => {
      window.__tauriMock.route('thesaurus_lookup', () => result)
      // The multi-word test uses Undo as a barrier: it is another app-owned menu
      // item, so its IPC call proves the right-click had its chance to send one.
      // The real command hands back the current document; model that here
      // instead of teaching the store to tolerate an unusable reply.
      window.__tauriMock.route('undo', () => doc)
    },
    { result: LOOKUP_RESULT, doc: seededDoc }
  )
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
  await waitForMenuListener(page)
}

function wordMenuCalls(calls) {
  return calls.filter((call) => call.cmd === 'show_word_menu')
}

test('S-031: right-clicking one word asks for the word menu and changes nothing', async ({
  page,
}) => {
  await open(page)
  const before = await page.locator('.editor-sheet').innerText()
  const point = await wordPoint(page, 'Happy')

  await page.mouse.click(point.x, point.y, { button: 'right' })

  await expect
    .poll(async () => wordMenuCalls(await ipcCalls(page)).length, { timeout: 5000 })
    .toBe(1)

  const [call] = wordMenuCalls(await ipcCalls(page))
  expect(typeof call.args.x).toBe('number')
  expect(typeof call.args.y).toBe('number')
  expect(Math.abs(call.args.x - point.x)).toBeLessThan(4)
  expect(Math.abs(call.args.y - point.y)).toBeLessThan(4)

  expect(await page.locator('.editor-sheet').innerText()).toBe(before)
})

test('S-032: right-clicking a multi-word selection keeps the native menu', async ({ page }) => {
  await open(page)
  const point = await wordPoint(page, 'Happy')
  await selectWord(page, 'Happy, said')

  await page.mouse.click(point.x, point.y, { button: 'right' })

  // A deterministic barrier instead of a sleep: Undo is another app-owned menu
  // item, so once its IPC call is recorded anything the right-click was going to
  // send has already been sent.
  await emitMenu(page, 'undo')
  await expect
    .poll(async () => (await ipcCalls(page)).some((call) => call.cmd === 'undo'), {
      timeout: 5000,
    })
    .toBe(true)

  expect(wordMenuCalls(await ipcCalls(page))).toHaveLength(0)

  // Control: the same click without a selection must ask for the word menu, so
  // the assertion above cannot pass just because the listener is dead.
  await page.mouse.click(point.x, point.y)
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect
    .poll(async () => wordMenuCalls(await ipcCalls(page)).length, { timeout: 5000 })
    .toBe(1)
})

test('S-033: the thesaurus event opens the popover with the looked-up senses', async ({
  page,
}) => {
  await open(page)
  const point = await wordPoint(page, 'Happy')
  await page.mouse.click(point.x, point.y, { button: 'right' })

  await expect
    .poll(async () => wordMenuCalls(await ipcCalls(page)).length, { timeout: 5000 })
    .toBe(1)

  await emitMenu(page, 'thesaurus')

  const popover = page.locator('.thesaurus-popover')
  await expect(popover).toBeVisible()
  await expect(popover.locator('.thesaurus-word')).toHaveText('Happy,')
  await expect(popover.locator('.thesaurus-sense')).toHaveCount(2)
  await expect(popover.locator('.thesaurus-synonym')).toHaveCount(3)
  await expect(popover.locator('.thesaurus-antonyms').first()).toContainText('unhappy')
})

test('S-034: marking a synonym and pressing OK replaces the word in its own shape', async ({
  page,
}) => {
  await open(page)
  const point = await wordPoint(page, 'Happy')
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect
    .poll(async () => wordMenuCalls(await ipcCalls(page)).length, { timeout: 5000 })
    .toBe(1)
  await emitMenu(page, 'thesaurus')

  const popover = page.locator('.thesaurus-popover')
  await expect(popover).toBeVisible()
  await popover.getByRole('button', { name: 'glad' }).click()
  await popover.locator('button.thesaurus-ok').click()

  await expect(popover).toBeHidden()
  await expect(page.locator('.editor-sheet')).toContainText('Glad, said the writer.')

  // The replacement is an ordinary edit: it reaches the document model, so the
  // store is modified and the status bar says so.
  await expect(page.locator('.statusbar')).toContainText('Edited')
})

test('S-035: Escape closes the popover and leaves the document alone', async ({ page }) => {
  await open(page)
  const before = await page.locator('.editor-sheet').innerText()
  const point = await wordPoint(page, 'Happy')
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect
    .poll(async () => wordMenuCalls(await ipcCalls(page)).length, { timeout: 5000 })
    .toBe(1)
  await emitMenu(page, 'thesaurus')

  const popover = page.locator('.thesaurus-popover')
  await expect(popover).toBeVisible()
  await popover.locator('button.thesaurus-synonym').first().click()
  await page.keyboard.press('Escape')

  await expect(popover).toBeHidden()
  expect(await page.locator('.editor-sheet').innerText()).toBe(before)
})

test('S-038: a word near the right edge keeps the whole popover inside the window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 400 })
  await open(page)
  const point = await wordPoint(page, 'writer')
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect
    .poll(async () => wordMenuCalls(await ipcCalls(page)).length, { timeout: 5000 })
    .toBe(1)
  await emitMenu(page, 'thesaurus')

  const popover = page.locator('.thesaurus-popover')
  await expect(popover).toBeVisible()

  const box = await popover.boundingBox()
  const window = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(window.width)
  expect(box.y + box.height).toBeLessThanOrEqual(window.height)
  // Control: this click really was near the edge, so the assertion above is
  // not vacuous — placing the popover at the click point would have overflowed.
  expect(point.x + box.width).toBeGreaterThan(window.width)

  // Shrinking the window behind an open popover must not push it out either.
  await page.setViewportSize({ width: 380, height: 260 })
  await expect
    .poll(async () => {
      const shrunk = await popover.boundingBox()
      const inner = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }))
      return shrunk.x >= 0 && shrunk.y >= 0 &&
        shrunk.x + shrunk.width <= inner.width &&
        shrunk.y + shrunk.height <= inner.height
    }, { timeout: 5000 })
    .toBe(true)
})

test('S-036: the rules run the popover edge to edge', async ({ page }) => {
  await open(page)
  const point = await wordPoint(page, 'Happy')
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect
    .poll(async () => wordMenuCalls(await ipcCalls(page)).length, { timeout: 5000 })
    .toBe(1)
  await emitMenu(page, 'thesaurus')

  const popover = page.locator('.thesaurus-popover')
  await expect(popover).toBeVisible()
  await expect(popover.locator('hr.thesaurus-separator')).toHaveCount(2)

  const box = await popover.boundingBox()
  for (const rule of await popover.locator('hr.thesaurus-separator').all()) {
    const line = await rule.boundingBox()
    // Within the popover's 1px border: the rule crosses the padding rather than
    // stopping inside it.
    expect(Math.abs(line.x - box.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(line.x + line.width - (box.x + box.width))).toBeLessThanOrEqual(2)
  }
})
