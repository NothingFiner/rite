import { test, expect } from '@playwright/test'
import { installTauriIpc, ipcCalls, emitMenu, invoked } from './helpers/tauri-ipc.js'

// The Notes view end to end (SPEC.md 5.17, S-013 … S-018, S-022 and S-026).
//
// jsdom has no caret, no layout, no page mapping and no menus. These sentences
// need a browser page. They pin the caret section, the manuscript page, and the
// scroll layer's landing place after a jump. They also pin a theme's computed
// colours and the native menu's undo/redo route.

const textStyle = { bold: false, italic: false, underline: false, fontSize: null }

const paragraph = (id, text) => ({
  id,
  elements: [{ textRun: { content: text, textStyle } }],
  leftIndent: null,
  rightIndent: null,
  firstLineIndent: null,
})

const section = (id, title, sectionType, paragraphs) => ({
  id,
  title,
  sectionType,
  hidden: false,
  paragraphs,
})

const seededDoc = {
  title: 'Notes Novel',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    section('c1', 'Chapter One', 'chapter', [
      paragraph('p-c1a', 'The first chapter opens on the door.'),
      paragraph('p-c1b', 'Rain runs down the glass.'),
    ]),
    section('s1', 'The Door', 'section', [
      paragraph('p-s1a', 'A section about the door and what it hides.'),
    ]),
    section('c2', 'Chapter Two', 'chapter', [
      paragraph('p-c2a', 'The second chapter turns on a letter.'),
    ]),
    section('s2', 'Ashes', 'section', [
      paragraph('p-s2a', 'Everything ends in ashes.'),
    ]),
  ],
}

/// Long enough to spill the manuscript onto several pages, so S-016 has a page
/// that is not page one to open Notes from.
const longDoc = {
  ...seededDoc,
  sections: [
    section(
      'c1',
      'Chapter One',
      'chapter',
      Array.from({ length: 28 }, (_, index) =>
        paragraph(
          `p-long-${index}`,
          `Paragraph ${index}. ${'The rain kept falling on the empty street while the lamp above the door guttered and went out. '.repeat(4)}`,
        ),
      ),
    ),
    section('s1', 'The Door', 'section', [
      paragraph('p-s1a', 'The door section sits on a later page.'),
    ]),
    section('s2', 'Ashes', 'section', [
      paragraph('p-s2a', 'The ashes section closes the chapter.'),
    ]),
  ],
}

async function openApp(page, doc = seededDoc) {
  await installTauriIpc(page, { doc })
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
}

const notesTab = (page) => page.locator('.view-tab').filter({ hasText: 'Notes' })
const editorTab = (page) => page.locator('.view-tab').filter({ hasText: 'Editor' })
const manuscriptTab = (page) => page.locator('.view-tab').filter({ hasText: 'Manuscript' })

const entry = (page, id) => page.locator(`.notes-entry[data-entry-id="${id}"]`)

/// Assert the tab, then the view: a missing Notes view must read as a failed
/// assertion rather than an opaque click timeout.
async function openNotes(page) {
  const tab = notesTab(page)
  await expect(tab).toBeVisible({ timeout: 5000 })
  await tab.click()
  await expect(page.locator('.notes-view')).toBeVisible({ timeout: 5000 })
}

async function selectEntry(page, id) {
  const row = entry(page, id)
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()
}

async function startEditing(page) {
  const pencil = page.locator('.note-edit')
  await expect(pencil).toBeVisible({ timeout: 5000 })
  await pencil.click()
  await expect(page.locator('.note-source')).toBeVisible({ timeout: 5000 })
}

async function commit(page) {
  const check = page.locator('.note-save')
  await expect(check).toBeVisible({ timeout: 5000 })
  await check.click()
}

const wordCount = (page) =>
  page.locator('.statusbar .word-count').evaluate((el) => Number((el.textContent.match(/\d+/) || ['0'])[0]))

async function caretIn(page, paraId, offset) {
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
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      p.closest('.editor-sheet')?.focus()
    },
    { id: paraId, at: offset },
  )
}

test('S-013: opens Notes as a fourth view and replaces the editor pane', async ({ page }) => {
  await openApp(page)
  await expect(page.locator('.editor-sheet')).toBeVisible()

  await openNotes(page)

  await expect(page.locator('.notes-view')).toBeVisible()
  await expect(page.locator('.editor-sheet')).toHaveCount(0)
})

test('S-014: keeps a committed note across a view switch and across reopening the saved file', async ({ page }) => {
  await installTauriIpc(page, { doc: seededDoc })
  await page.addInitScript(() => {
    const empty = { overview: '', sections: {}, orphaned: '' }
    window.__tauriMock
      .route('update_notes', (args) => {
        localStorage.setItem('e2e-notes', JSON.stringify(args.notes))
        return null
      })
      .route('retrieve_notes', () => {
        const raw = localStorage.getItem('e2e-notes')
        return raw ? JSON.parse(raw) : empty
      })
  })
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })

  await openNotes(page)
  await selectEntry(page, 's1')
  await startEditing(page)
  const draft = 'The door note survives.'
  await page.locator('.note-source').fill(draft)
  await commit(page)

  await expect.poll(() => invoked(page, 'update_notes'), { timeout: 5000 }).toBe(true)
  const saved = (await ipcCalls(page)).filter((call) => call.cmd === 'update_notes').at(-1)
  expect(saved.args.notes.sections.s1).toBe(draft)

  await editorTab(page).click()
  await expect(page.locator('.editor-sheet')).toBeVisible()
  await openNotes(page)
  await selectEntry(page, 's1')
  await expect(page.locator('.note-rendered')).toContainText(draft)

  await page.reload()
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
  await openNotes(page)
  await selectEntry(page, 's1')
  await expect(page.locator('.note-rendered')).toContainText(draft)
})

test('S-015: selects the note for the section at the caret when opened from the editor', async ({ page }) => {
  await openApp(page)
  await caretIn(page, 'p-s2a', 4)

  await openNotes(page)

  await expect(page.locator('.notes-entry.selected')).toHaveAttribute('data-entry-id', 's2')
})

test('S-016: selects the note for the section on the current manuscript page', async ({ page }) => {
  await openApp(page, longDoc)
  await manuscriptTab(page).click()
  await expect(page.locator('.manuscript-viewport')).toBeVisible({ timeout: 5000 })

  const target = page.locator('.manuscript-viewport [data-section-id="s2"]')
  await expect(target).toHaveCount(1)
  await page.evaluate(() => {
    document
      .querySelector('.manuscript-viewport [data-section-id="s2"]')
      .scrollIntoView({ block: 'start' })
  })

  await openNotes(page)

  await expect(page.locator('.notes-entry.selected')).toHaveAttribute('data-entry-id', 's2')
})

test('S-017: the section jump returns to the note section in the view the writer came from', async ({ page }) => {
  await openApp(page)
  await openNotes(page)
  await selectEntry(page, 's1')

  const jump = page.locator('.note-jump')
  await expect(jump).toBeVisible({ timeout: 5000 })
  await jump.click()

  await expect(page.locator('.editor-sheet')).toBeVisible()
  // The section title, not any paragraph of the section: both carry
  // data-section-id in the editor (the manuscript does not), so the unscoped
  // selector resolved to two elements and Playwright's strict mode rejected it
  // before it could check the thing S-017 is about. The jump scrolls to the
  // first element with the id in document order, and that is the title.
  await expect(page.locator('.editor-sheet .section-title[data-section-id="s1"]')).toBeInViewport()

  await manuscriptTab(page).click()
  await expect(page.locator('.manuscript-viewport')).toBeVisible({ timeout: 5000 })
  await openNotes(page)
  await selectEntry(page, 's1')
  await expect(page.locator('.note-jump')).toBeVisible()
  await page.locator('.note-jump').click()

  await expect(page.locator('.manuscript-viewport')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('.manuscript-viewport [data-section-id="s1"]')).toBeInViewport()
})

test('S-018: note text leaves the word count and the manuscript unchanged', async ({ page }) => {
  await openApp(page)
  const before = await wordCount(page)
  expect(before).toBeGreaterThan(0)

  await openNotes(page)
  await selectEntry(page, 's1')
  await startEditing(page)
  await page.locator('.note-source').fill('Four more words that are only notes. ')
  await commit(page)

  await editorTab(page).click()
  await expect(page.locator('.editor-sheet')).toBeVisible()

  expect(await wordCount(page)).toBe(before)
  await expect(page.locator('.editor-sheet')).not.toContainText('only notes')

  await manuscriptTab(page).click()
  await expect(page.locator('.manuscript-viewport')).not.toContainText('only notes')
})

test('S-022: paints the notes view and its rendered notes with the active theme', async ({ page }) => {
  await installTauriIpc(page, { doc: seededDoc })
  await page.addInitScript(() => {
    localStorage.setItem('rite-bg', '#475841')
    localStorage.setItem('rite-text', '#FFE2D6')
    localStorage.setItem('rite-accent', '#C9A96E')
  })
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })

  await openNotes(page)
  await selectEntry(page, 's1')
  await startEditing(page)
  await page.locator('.note-source').fill('A **themed** note.')
  await commit(page)

  await expect(page.locator('.notes-view')).toHaveCSS('background-color', 'rgb(71, 88, 65)')
  await expect(page.locator('.note-rendered')).toHaveCSS('color', 'rgb(255, 226, 214)')
  await expect(page.locator('.notes-entry.selected')).toHaveCSS('color', 'rgb(201, 169, 110)')
})

test('S-026: undo and redo the note draft without moving the manuscript history', async ({ page }) => {
  await openApp(page)
  const manuscriptBefore = await page.locator('.editor-sheet').innerText()

  await openNotes(page)
  await selectEntry(page, 's1')
  await startEditing(page)
  const source = page.locator('.note-source')
  await expect(source).toBeVisible({ timeout: 5000 })
  await source.fill('first draft')
  await source.fill('second draft')

  await emitMenu(page, 'undo')
  await expect(source).toHaveValue('first draft')

  await emitMenu(page, 'redo')
  await expect(source).toHaveValue('second draft')

  expect(await invoked(page, 'undo')).toBe(false)
  expect(await invoked(page, 'redo')).toBe(false)

  await editorTab(page).click()
  await expect(page.locator('.editor-sheet')).toBeVisible()
  expect(await page.locator('.editor-sheet').innerText()).toBe(manuscriptBefore)
})
