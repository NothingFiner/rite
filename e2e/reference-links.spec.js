import { test, expect } from '@playwright/test'
import { installTauriIpc, invoked } from './helpers/tauri-ipc.js'

// Reference links in notes and definitions, end to end (SPEC.md revision 5,
// S-091, S-094, S-095, S-096).
//
// A link is not navigation: it assigns the view, the surface and the selection.
// That is `App.vue` shell state, so these sentences need a page. Each test
// asserts the rendered link before it clicks one, so a broken link and a broken
// harness do not look the same.

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

const entry = (id, kind, name, overrides = {}) => ({
  id,
  kind,
  name,
  definition: '',
  aliases: [],
  tags: [],
  facts: [],
  includedSections: [],
  excludedSections: [],
  ...overrides,
})

const seededDoc = {
  title: 'Reference Novel',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    section('c1', 'Chapter One', 'chapter', [
      paragraph('p-c1', 'Izildar Qualen kept the record of the Ashfall.'),
      paragraph('p-c1b', 'Essidor Agjadoff waited by Qualen Square.'),
    ]),
  ],
}

const references = {
  entries: [
    entry('e-qualen', 'character', 'Izildar Qualen'),
    entry('e-izildar', 'character', 'Izildar', { aliases: ['Izi'] }),
    entry('e-square', 'place', 'Qualen Square'),
    entry('e-figure', 'character', 'Izildar Queln'),
    entry('e-ashfall', 'term', 'Ashfall', {
      definition: 'Named for [[Izildar Queln]], though the statue is gone.',
    }),
  ],
}

async function openApp(page, notes) {
  await installTauriIpc(page, { doc: seededDoc })
  await page.addInitScript(
    ({ seed, seedNotes }) => {
      window.__tauriMock.route('retrieve_references', () => seed)
      window.__tauriMock.route('retrieve_notes', () => seedNotes)
    },
    { seed: references, seedNotes: notes },
  )
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
}

const referencesTab = (page) => page.locator('.view-tab').filter({ hasText: 'References' })
const editorTab = (page) => page.locator('.view-tab').filter({ hasText: 'Editor' })
const surfaceTab = (page, surface) => page.locator(`.surface-tab[data-surface="${surface}"]`)
const referenceRow = (page, id) => page.locator(`.reference-entry[data-entry-id="${id}"]`)
const noteLink = (page, id) => page.locator(`.note-rendered .reference-link[data-entry-id="${id}"]`)

async function openNotes(page) {
  const tab = referencesTab(page)
  await expect(tab).toBeVisible({ timeout: 5000 })
  await tab.click()
  await expect(page.locator('.references-drawer')).toBeVisible({ timeout: 5000 })
  const overview = page.locator('.notes-entry[data-entry-id="overview"]')
  await expect(overview).toBeVisible({ timeout: 5000 })
  await overview.click()
}

async function openDefinition(page, surface, id) {
  await referencesTab(page).click()
  const control = surfaceTab(page, surface)
  await expect(control).toBeVisible({ timeout: 5000 })
  await control.click()
  const row = referenceRow(page, id)
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()
  await expect(page.locator('.reference-entry-view')).toBeVisible({ timeout: 5000 })
}

test('S-091: a note link opens References on the entry surface with that entry selected', async ({
  page,
}) => {
  await openApp(page, {
    overview: 'The square is named for [[Qualen Square]].',
    sections: {},
    orphaned: '',
  })
  await openNotes(page)

  const link = noteLink(page, 'e-square')
  await expect(link).toBeVisible({ timeout: 5000 })
  // Nothing has been written into the note: the brackets are the note's text.
  expect(await page.locator('.note-rendered').innerText()).toContain('Qualen Square')
  await link.click()

  await expect(surfaceTab(page, 'glossary')).toHaveAttribute('aria-selected', 'true', {
    timeout: 5000,
  })
  await expect(referenceRow(page, 'e-square')).toHaveClass(/selected/, { timeout: 5000 })
  await expect(page.locator('.reference-entry-heading')).toHaveText('Qualen Square')
})

test('S-094: a definition link selects the entry and switches to its surface', async ({
  page,
}) => {
  await openApp(page, { overview: '', sections: {}, orphaned: '' })
  await openDefinition(page, 'glossary', 'e-ashfall')

  const link = page.locator('.reference-definition .reference-link[data-entry-id="e-figure"]')
  await expect(link).toBeVisible({ timeout: 5000 })
  await link.click()

  await expect(surfaceTab(page, 'characters')).toHaveAttribute('aria-selected', 'true', {
    timeout: 5000,
  })
  await expect(referenceRow(page, 'e-figure')).toHaveClass(/selected/, { timeout: 5000 })
  await expect(page.locator('.reference-entry-heading')).toHaveText('Izildar Queln')
})

test('S-095: a note shows the link as its name and opens the entry page', async ({ page }) => {
  await openApp(page, {
    overview: 'The [[Izi]] thread runs through everything.',
    sections: {},
    orphaned: '',
  })
  await openNotes(page)

  const link = noteLink(page, 'e-izildar')
  await expect(link).toBeVisible({ timeout: 5000 })
  await expect(link).toHaveText('Izi')
  await link.click()

  await expect(page.locator('.reference-entry-heading')).toHaveText('Izildar', { timeout: 5000 })
  await expect(page.locator('.reference-entry-view')).toBeVisible()
})

test('S-096: a note link leaves the manuscript and its word count alone', async ({ page }) => {
  await openApp(page, {
    overview: 'Cross-reference: [[Izi]] waits by [[Qualen Square]].',
    sections: {},
    orphaned: '',
  })

  const wordCount = page.locator('.statusbar .word-count')
  await expect(wordCount).toContainText('word', { timeout: 5000 })
  const before = await wordCount.innerText()

  await openNotes(page)
  // The control: the note really does hold links, so an unchanged manuscript
  // below is the note's doing and not a missing feature's.
  await expect(noteLink(page, 'e-izildar')).toBeVisible({ timeout: 5000 })
  await expect(noteLink(page, 'e-square')).toBeVisible()

  await editorTab(page).click()
  await expect(page.locator('.editor-sheet')).toBeVisible({ timeout: 5000 })
  await expect(wordCount).toHaveText(before)
  expect(await page.locator('.editor-sheet').innerText()).not.toContain('[[')
})
