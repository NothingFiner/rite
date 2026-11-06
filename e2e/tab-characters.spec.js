import { test, expect } from '@playwright/test'
import { installTauriIpc, ipcCalls, emitMenu } from './helpers/tauri-ipc.js'

// Tab characters and first-line indent (SPEC.md 5.18), end to end in Chromium.
//
// jsdom has no caret, no layout and no key default actions, so these need a real
// viewport: whether Tab is captured, where the caret lands, how wide a tab
// renders, and whether the value reaches the model.

const textStyle = { bold: false, italic: false, underline: false, fontSize: null }
const para = (id, text) => ({
  id,
  elements: [{ textRun: { content: text, textStyle } }],
  leftIndent: null,
  rightIndent: null,
  firstLineIndent: null,
})

// p-1 follows the section title, so the automatic rule gives it indent 0; p-2
// follows a body paragraph and gets 0.5 in (48 px).
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
      paragraphs: [para('p-1', 'First paragraph'), para('p-2', 'Second paragraph')],
    },
  ],
}

async function open(page, initScript, initArg) {
  await installTauriIpc(page, { doc: seededDoc })
  if (initScript) await page.addInitScript(initScript, initArg)
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

/// Select [start, end) in a paragraph's first text node.
async function selectInParagraph(page, paraId, start, end) {
  await page.locator(`[data-para-id="${paraId}"]`).click()
  await page.evaluate(
    ({ id, from, to }) => {
      const p = document.querySelector(`[data-para-id="${id}"]`)
      const node = p.firstChild
      const range = document.createRange()
      range.setStart(node, from)
      range.setEnd(node, to)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      p.closest('.editor-sheet')?.focus()
    },
    { id: paraId, from: start, to: end },
  )
}

const textOf = (page, paraId) =>
  page.locator(`[data-para-id="${paraId}"]`).evaluate((el) => el.textContent)

const indentOf = (page, paraId) =>
  page.locator(`[data-para-id="${paraId}"]`).evaluate((el) => getComputedStyle(el).textIndent)

/// Dispatch Ctrl+Tab at the focused element. A synthetic event is used because
/// Chromium may consume the real shortcut before the page sees it; the app's
/// own handler is what this feature is about.
async function pressCtrlTab(page) {
  await page.evaluate(() => {
    const target = document.activeElement
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        code: 'Tab',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
}

const syncCount = (page) =>
  ipcCalls(page).then((calls) => calls.filter((c) => c.cmd === 'sync_document').length)

async function nextSyncDoc(page, before) {
  await expect.poll(() => syncCount(page), { timeout: 7000 }).toBeGreaterThan(before)
  const calls = (await ipcCalls(page)).filter((c) => c.cmd === 'sync_document')
  return calls[calls.length - 1].args.data
}

/// Run `action`, then return the document carried by the next `sync_document`.
async function syncDocAfter(page, action) {
  const before = await syncCount(page)
  await action()
  return nextSyncDoc(page, before)
}

const paragraphWithId = (doc, id) =>
  doc.sections.flatMap((s) => s.paragraphs).find((p) => p.id === id)

/// Horizontal offset of the glyph `letter` from a paragraph's left content edge.
const offsetOfLetter = (locator, letter) =>
  locator.evaluate((el, ch) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && !node.textContent.includes(ch)) node = walker.nextNode()
    if (!node) throw new Error(`no text node contains ${ch}`)
    const i = node.textContent.indexOf(ch)
    const range = document.createRange()
    range.setStart(node, i)
    range.setEnd(node, i + 1)
    return range.getBoundingClientRect().left - el.getBoundingClientRect().left
  }, letter)

test.describe('indent', () => {
  test('S-001: Tab at the start of a section-first paragraph sets a 0.5-inch indent and inserts no character', async ({ page }) => {
    await open(page)
    await expect(page.locator('[data-para-id="p-1"]')).toBeVisible()
    expect(await indentOf(page, 'p-1')).toBe('0px')

    await caretAt(page, 'p-1', 0)
    await page.keyboard.press('Tab')

    expect(await indentOf(page, 'p-1')).toBe('48px')
    expect(await textOf(page, 'p-1')).toBe('First paragraph')
    expect(await page.evaluate(() => !!document.activeElement.closest('.editor-sheet'))).toBe(true)
  })

  test('S-002: Tab at the start of a paragraph at the automatic 0.5 inch raises it to 1 inch', async ({ page }) => {
    await open(page)
    expect(await indentOf(page, 'p-2')).toBe('48px')

    await caretAt(page, 'p-2', 0)
    await page.keyboard.press('Tab')

    expect(await indentOf(page, 'p-2')).toBe('96px')
    expect(await textOf(page, 'p-2')).toBe('Second paragraph')
  })

  test('S-003: a Tab-set indent survives typing elsewhere and the following sync', async ({ page }) => {
    await open(page)
    await caretAt(page, 'p-1', 0)
    await page.keyboard.press('Tab')
    expect(await indentOf(page, 'p-1')).toBe('48px')

    const doc = await syncDocAfter(page, async () => {
      await caretAt(page, 'p-2', 0)
      await page.keyboard.type('x')
    })

    const p1 = paragraphWithId(doc, 'p-1')
    expect(p1.firstLineIndent).toBe(0.5)
    expect(p1.elements.map((e) => e.textRun.content).join('')).toBe('First paragraph')
    // The readback must not recompute the automatic 0 back over the explicit 0.5.
    expect(await indentOf(page, 'p-1')).toBe('48px')
  })
})

test.describe('literal tab', () => {
  test('S-007: Tab mid-paragraph inserts one tab character and keeps focus in the editor', async ({ page }) => {
    await open(page)
    await caretAt(page, 'p-2', 6)
    await page.keyboard.press('Tab')
    await page.keyboard.type('x')

    expect(await textOf(page, 'p-2')).toBe('Second\tx paragraph')
    expect(await page.evaluate(() => !!document.activeElement.closest('.editor-sheet'))).toBe(true)
  })

  test('S-008: the inserted tab reaches the document model', async ({ page }) => {
    await open(page)
    await caretAt(page, 'p-2', 6)

    const before = await syncCount(page)
    await page.keyboard.press('Tab')
    await page.keyboard.type('x')

    // Assert the editor first: without the tab this fails here, not as a sync
    // timeout.
    expect(await textOf(page, 'p-2')).toBe('Second\tx paragraph')

    const doc = await nextSyncDoc(page, before)

    const p2 = paragraphWithId(doc, 'p-2')
    const text = p2.elements.map((e) => e.textRun.content).join('')
    expect(text).toBe('Second\tx paragraph')
    expect(text).toContain('\t')
  })

  test('S-009: Tab replaces a selection with one tab character', async ({ page }) => {
    await open(page)
    await selectInParagraph(page, 'p-2', 0, 6)
    await page.keyboard.press('Tab')

    expect(await textOf(page, 'p-2')).toBe('\t paragraph')
  })

  test('S-010: Ctrl+Tab inserts a literal tab without changing the indent', async ({ page }) => {
    await open(page)
    await caretAt(page, 'p-1', 0)
    expect(await indentOf(page, 'p-1')).toBe('0px')

    await pressCtrlTab(page)

    expect(await textOf(page, 'p-1')).toBe('\tFirst paragraph')
    expect(await indentOf(page, 'p-1')).toBe('0px')
  })

  test('S-012: Tab is scoped to body paragraphs and leaves a section title unchanged', async ({ page }) => {
    await open(page)

    // A literal tab in the body (mid-paragraph, so Tab means "tab" there).
    await caretAt(page, 'p-1', 5)
    await page.keyboard.press('Tab')
    expect(await textOf(page, 'p-1')).toContain('\t')

    // The title is a label, not an editing surface for tabs.
    await page.locator('.section-title').first().click()
    await page.keyboard.press('Tab')

    const title = await page.locator('.section-title').first().evaluate((el) => el.textContent)
    expect(title).not.toContain('\t')
    expect(await page.evaluate(() => !!document.activeElement.closest('.editor-sheet'))).toBe(false)
  })
})

test.describe('leaving the editor', () => {
  test('S-022: Escape moves focus out of the editor when no panel wants the key', async ({ page }) => {
    await open(page)
    await caretAt(page, 'p-2', 6)
    await page.keyboard.type('ab')
    const before = await textOf(page, 'p-2')

    await page.keyboard.press('Escape')

    expect(await page.evaluate(() => !!document.activeElement.closest('.editor-sheet'))).toBe(false)
    await page.keyboard.type('x')
    expect(await textOf(page, 'p-2')).toBe(before)
  })
})

test.describe('indent and tab stay distinct', () => {
  test('S-013: deleting a tab leaves the paragraph indent in place', async ({ page }) => {
    await open(page)

    await caretAt(page, 'p-1', 0)
    await page.keyboard.press('Tab') // indent 0.5, no character
    expect(await indentOf(page, 'p-1')).toBe('48px')

    await page.keyboard.type('A')
    await page.keyboard.press('Tab') // mid-line: literal tab
    expect(await textOf(page, 'p-1')).toBe('A\tFirst paragraph')

    await page.keyboard.press('Backspace') // removes only the tab
    expect(await textOf(page, 'p-1')).toBe('AFirst paragraph')
    expect(await indentOf(page, 'p-1')).toBe('48px')
  })
})

test.describe('rendering', () => {
  test('S-014: body paragraphs preserve whitespace and use 48 px tab stops', async ({ page }) => {
    await open(page)
    const styles = await page.locator('[data-para-id="p-1"]').evaluate((el) => {
      const s = getComputedStyle(el)
      return { whiteSpace: s.whiteSpace, tabSize: s.tabSize }
    })
    expect(styles.whiteSpace).toBe('pre-wrap')
    expect(styles.tabSize).toBe('48px')
  })

  test('S-015: a tab advances to the next 48 px stop, after the indent', async ({ page }) => {
    await open(page)

    // No indent: the tab puts the text 48 px in.
    await caretAt(page, 'p-1', 0)
    await pressCtrlTab(page)
    expect(await textOf(page, 'p-1')).toBe('\tFirst paragraph')
    const plain = await offsetOfLetter(page.locator('[data-para-id="p-1"]'), 'F')
    expect(Math.abs(plain - 48)).toBeLessThanOrEqual(1.5)

    // With a 0.5-inch indent the same tab lands on the NEXT stop, 96 px in.
    await page.keyboard.press('Backspace') // remove the tab
    await page.keyboard.press('Tab') // indent 0.5
    expect(await indentOf(page, 'p-1')).toBe('48px')
    await pressCtrlTab(page)
    expect(await textOf(page, 'p-1')).toBe('\tFirst paragraph')
    const indented = await offsetOfLetter(page.locator('[data-para-id="p-1"]'), 'F')
    expect(Math.abs(indented - 96)).toBeLessThanOrEqual(1.5)
  })

  test('S-016: the manuscript view preserves the tab at the same 48 px stop', async ({ page }) => {
    await open(page)

    await caretAt(page, 'p-1', 0)
    const before = await syncCount(page)
    await pressCtrlTab(page)
    expect(await textOf(page, 'p-1')).toBe('\tFirst paragraph')
    await nextSyncDoc(page, before)

    await page.click('button.view-tab:has-text("Manuscript")')
    const msParagraph = page.locator('.ms-para', { hasText: 'First paragraph' }).first()
    await expect(msParagraph).toBeVisible({ timeout: 5000 })

    const styles = await msParagraph.evaluate((el) => {
      const s = getComputedStyle(el)
      return { whiteSpace: s.whiteSpace, tabSize: s.tabSize }
    })
    expect(styles.whiteSpace).toBe('pre-wrap')
    expect(styles.tabSize).toBe('48px')

    const offset = await offsetOfLetter(msParagraph, 'F')
    expect(Math.abs(offset - 48)).toBeLessThanOrEqual(1.5)
  })
})

test.describe('undo', () => {
  // The Rust side journals the change; these tests stub `undo` to return the
  // pre-edit document and assert the editor reflects it.
  test('S-020: one undo removes a Tab-set indent', async ({ page }) => {
    await open(page, (doc) => window.__tauriMock.route('undo', () => doc), seededDoc)
    await caretAt(page, 'p-1', 0)
    await page.keyboard.press('Tab')
    expect(await indentOf(page, 'p-1')).toBe('48px')

    await emitMenu(page, 'undo')

    await expect.poll(() => indentOf(page, 'p-1'), { timeout: 5000 }).toBe('0px')
  })

  test('S-021: one undo removes a literal tab and restores the text', async ({ page }) => {
    await open(page, (doc) => window.__tauriMock.route('undo', () => doc), seededDoc)
    await caretAt(page, 'p-2', 6)
    await page.keyboard.press('Tab')
    expect(await textOf(page, 'p-2')).toBe('Second\t paragraph')

    await emitMenu(page, 'undo')

    await expect.poll(() => textOf(page, 'p-2'), { timeout: 5000 }).toBe('Second paragraph')
  })
})
