import { test, expect } from '@playwright/test'
import { installTauriIpc, ipcCalls } from './helpers/tauri-ipc.js'

// Automatic first-line indent on Return (SPEC.md follow-up to 5.18, S-023–S-033).
//
// Everything here needs a real viewport. The caret, `insertParagraph`'s default
// action and the computed text-indent do not exist in jsdom. The app therefore
// runs in Chromium with the shared Tauri v2 IPC mock, as TESTING.md requires.

const textStyle = { bold: false, italic: false, underline: false, fontSize: null }
const para = (id, text) => ({
  id,
  elements: [{ textRun: { content: text, textStyle } }],
  leftIndent: null,
  rightIndent: null,
  firstLineIndent: null,
})

const seededDoc = {
  title: 'Untitled',
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
        para('p-1', 'First paragraph'),
        para('p-2', 'Second paragraph'),
        para('p-3', 'Third paragraph'),
      ],
    },
  ],
}

/// Same section, but p-2 is empty. This seeds the "Return in an empty
/// paragraph" edge case, where the automatic rule gives 0 after an empty one.
const emptyParagraphDoc = {
  ...seededDoc,
  sections: [
    {
      ...seededDoc.sections[0],
      paragraphs: [para('p-1', 'First paragraph'), para('p-2', ''), para('p-3', 'Third paragraph')],
    },
  ],
}

async function open(page, doc = seededDoc) {
  await installTauriIpc(page, { doc })
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
}

/// Click a paragraph (which focuses the editor sheet), then place a collapsed
/// caret at `offset` in its first text node.
async function caretAt(page, paraId, offset) {
  await page.locator(`[data-para-id="${paraId}"]`).click()
  await page.evaluate(
    ({ id, at }) => {
      const p = document.querySelector(`[data-para-id="${id}"]`)
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      const node = walker.nextNode()
      const range = document.createRange()
      if (node) range.setStart(node, Math.min(at, node.textContent.length))
      else range.setStart(p, 0)
      range.collapse(true)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      p.closest('.editor-sheet')?.focus()
    },
    { id: paraId, at: offset },
  )
}

const paragraphs = (page) => page.locator('.editor-sheet .paragraph')
const indentOf = (page, index) =>
  paragraphs(page).nth(index).evaluate((el) => getComputedStyle(el).textIndent)
const autoOf = (page, index) =>
  paragraphs(page).nth(index).evaluate((el) => el.dataset.autoIndent ?? null)
const textOf = (page, index) => paragraphs(page).nth(index).evaluate((el) => el.textContent)
const paraIdOf = (page, index) =>
  paragraphs(page).nth(index).evaluate((el) => el.dataset.paraId ?? null)

const syncCount = (page) =>
  ipcCalls(page).then((calls) => calls.filter((c) => c.cmd === 'sync_document').length)

async function nextSyncDoc(page, before) {
  await expect.poll(() => syncCount(page), { timeout: 7000 }).toBeGreaterThan(before)
  const calls = (await ipcCalls(page)).filter((c) => c.cmd === 'sync_document')
  return calls[calls.length - 1].args.data
}

/// The model paragraph at `index` in the single seeded section, after a sync.
const modelParagraph = (doc, index) => doc.sections[0].paragraphs[index]

test.describe('automatic indent on Return', () => {
  test('S-023: Return at the end of a body paragraph indents the new paragraph by 0.5 inch', async ({ page }) => {
    await open(page)
    await caretAt(page, 'p-2', 'Second paragraph'.length)
    await page.keyboard.press('Enter')

    await expect(paragraphs(page)).toHaveCount(4)
    expect(await textOf(page, 2)).toBe('')
    expect(await indentOf(page, 2)).toBe('48px')
    expect(await autoOf(page, 2)).toBe('true')
  })

  test('S-024: Return at the end of a section-first paragraph makes the second paragraph 0.5 inch', async ({ page }) => {
    await open(page)
    await caretAt(page, 'p-1', 'First paragraph'.length)
    await page.keyboard.press('Enter')

    await expect(paragraphs(page)).toHaveCount(4)
    expect(await textOf(page, 1)).toBe('')
    expect(await indentOf(page, 1)).toBe('48px')
    expect(await autoOf(page, 1)).toBe('true')
  })

  test('S-025: Return inside a paragraph splits the text and indents the second half', async ({ page }) => {
    await open(page)
    await caretAt(page, 'p-2', 6) // "Second| paragraph"
    await page.keyboard.press('Enter')

    await expect(paragraphs(page)).toHaveCount(4)
    expect(await paraIdOf(page, 1)).toBe('p-2')
    expect(await textOf(page, 1)).toBe('Second')
    expect(await textOf(page, 2)).toBe(' paragraph')
    expect(await indentOf(page, 2)).toBe('48px')
    expect(await autoOf(page, 2)).toBe('true')
  })

  test('S-026: Return in an empty paragraph gives the new paragraph no indent and keeps it automatic', async ({ page }) => {
    await open(page, emptyParagraphDoc)
    await caretAt(page, 'p-2', 0)
    await page.keyboard.press('Enter')

    await expect(paragraphs(page)).toHaveCount(4)
    expect(await textOf(page, 2)).toBe('')
    expect(await indentOf(page, 2)).toBe('0px')
    expect(await autoOf(page, 2)).toBe('true')
  })

  test('S-027: the paragraph created by Return is automatic in the model', async ({ page }) => {
    await open(page)
    await caretAt(page, 'p-2', 'Second paragraph'.length)

    const before = await syncCount(page)
    await page.keyboard.press('Enter')

    // Assert the DOM first so a missing marker fails here, not as a sync timeout.
    await expect(paragraphs(page)).toHaveCount(4)
    expect(await autoOf(page, 2)).toBe('true')
    expect(await indentOf(page, 2)).toBe('48px')

    const doc = await nextSyncDoc(page, before)
    const created = modelParagraph(doc, 2)
    expect(created.firstLineIndent).toBe(null)
    expect(created.id).toBe(await paraIdOf(page, 2))
  })

  test('S-028: typing into the new paragraph keeps it automatic and indented', async ({ page }) => {
    await open(page)
    await caretAt(page, 'p-2', 'Second paragraph'.length)

    const before = await syncCount(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('New')

    expect(await textOf(page, 2)).toBe('New')
    expect(await autoOf(page, 2)).toBe('true')
    expect(await indentOf(page, 2)).toBe('48px')

    const doc = await nextSyncDoc(page, before)
    const created = modelParagraph(doc, 2)
    expect(created.elements.map((e) => e.textRun.content).join('')).toBe('New')
    expect(created.firstLineIndent).toBe(null)
  })

  test('S-029: an automatic paragraph keeps its indent through a later sync', async ({ page }) => {
    await open(page)
    await caretAt(page, 'p-2', 'Second paragraph'.length)
    await page.keyboard.press('Enter')
    await page.keyboard.type('New')

    // A later edit elsewhere in the document triggers another localized readback.
    const before = await syncCount(page)
    await caretAt(page, 'p-3', 0)
    await page.keyboard.type('x')

    expect(await indentOf(page, 2)).toBe('48px')
    expect(await autoOf(page, 2)).toBe('true')

    const doc = await nextSyncDoc(page, before)
    expect(modelParagraph(doc, 2).firstLineIndent).toBe(null)
  })

  test('S-030: Return at the start moves the text down and both paragraphs follow the automatic rule', async ({ page }) => {
    await open(page)
    await caretAt(page, 'p-2', 0)
    await page.keyboard.press('Enter')

    await expect(paragraphs(page)).toHaveCount(4)
    // Measured contenteditable behaviour. The original id stays on the empty
    // paragraph above. The text moves into the new paragraph below.
    expect(await paraIdOf(page, 1)).toBe('p-2')
    expect(await textOf(page, 1)).toBe('')
    expect(await textOf(page, 2)).toBe('Second paragraph')

    // An empty first paragraph of a section gives 0. A text paragraph after an
    // empty one also gives 0. Both stay automatic, not explicit.
    expect(await indentOf(page, 1)).toBe('0px')
    expect(await autoOf(page, 1)).toBe('true')
    expect(await indentOf(page, 2)).toBe('0px')
    expect(await autoOf(page, 2)).toBe('true')
  })

  test('S-031: Return after an explicit indent creates an automatic 0.5-inch paragraph', async ({ page }) => {
    await open(page)
    await caretAt(page, 'p-2', 0)
    await page.keyboard.press('Tab') // explicit 1 inch (automatic 0.5 + one step)
    expect(await indentOf(page, 1)).toBe('96px')

    await caretAt(page, 'p-2', 'Second paragraph'.length)
    await page.keyboard.press('Enter')

    await expect(paragraphs(page)).toHaveCount(4)
    expect(await indentOf(page, 2)).toBe('48px')
    expect(await autoOf(page, 2)).toBe('true')
  })
})

test.describe('automatic marker on render', () => {
  test('S-033: loaded automatic paragraphs keep their marker and model null after typing', async ({ page }) => {
    await open(page)

    // The automatic rule must be visible in the DOM before any edit. Otherwise
    // the first readback turns 0 and 0.5 into explicit numbers.
    expect(await autoOf(page, 0)).toBe('true')
    expect(await autoOf(page, 1)).toBe('true')

    const before = await syncCount(page)
    await caretAt(page, 'p-1', 'First paragraph'.length)
    await page.keyboard.type('x')

    const doc = await nextSyncDoc(page, before)
    expect(modelParagraph(doc, 0).firstLineIndent).toBe(null)
    expect(modelParagraph(doc, 1).firstLineIndent).toBe(null)
  })
})
