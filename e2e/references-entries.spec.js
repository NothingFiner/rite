import { test, expect } from '@playwright/test'
import { installTauriIpc, invoked } from './helpers/tauri-ipc.js'

// Reference entries end to end (SPEC.md 5.19a, S-021 … S-024).
//
// The record is authored source in the `.rite`, so the mock persists it in
// localStorage the way the old notes tests did: `update_references` writes,
// `retrieve_references` reads, and a reload proves the record survives.
// jsdom has no layout and no real dialogs; the jump sentence needs a page.

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
  title: 'Reference Novel',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    section('c1', 'Chapter One', 'chapter', [
      paragraph('p-c1', 'Izildar Qualen kept the record of the Ashfall.'),
    ]),
    section('s1', 'The Square', 'section', [
      paragraph('p-s1', 'Essidor Agjadoff waited by Qualen Square.'),
    ]),
  ],
}

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

async function openApp(page, references = { entries: [] }) {
  await installTauriIpc(page, { doc: seededDoc })
  await page.addInitScript((seed) => {
    window.__tauriMock.route('retrieve_references', () => {
      const stored = localStorage.getItem('rite-references')
      return JSON.parse(stored || seed)
    })
    window.__tauriMock.route('update_references', (args) => {
      localStorage.setItem('rite-references', JSON.stringify(args.references))
      return null
    })
  }, JSON.stringify(references))
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
}

const referencesTab = (page) => page.locator('.view-tab').filter({ hasText: 'References' })
const surfaceTab = (page, surface) => page.locator(`.surface-tab[data-surface="${surface}"]`)
const referenceRow = (page, id) => page.locator(`.reference-entry[data-entry-id="${id}"]`)

async function openReferences(page) {
  const tab = referencesTab(page)
  await expect(tab).toBeVisible({ timeout: 5000 })
  await tab.click()
  await expect(page.locator('.references-view')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('.references-drawer')).toBeVisible({ timeout: 5000 })
}

async function openSurface(page, surface) {
  const control = surfaceTab(page, surface)
  await expect(control).toBeVisible({ timeout: 5000 })
  await control.click()
}

test('S-021: adds a term, defines it, reopens the file and shows the definition', async ({ page }) => {
  await openApp(page)
  await openReferences(page)
  await openSurface(page, 'glossary')

  const addTerm = page.locator('[data-add-kind="term"]')
  await expect(addTerm).toBeVisible({ timeout: 5000 })
  await addTerm.click()

  const source = page.locator('.reference-definition-source')
  await expect(source).toBeVisible({ timeout: 5000 })
  await source.fill('The **seasonal** fall of grey ash.')
  await page.locator('.reference-save').click()

  await expect
    .poll(() => invoked(page, 'update_references', (args) => JSON.stringify(args).includes('seasonal')))
    .toBe(true)

  // Reopening the file re-reads the record from the same place Rust keeps it.
  await page.reload()
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
  await openReferences(page)
  await openSurface(page, 'glossary')

  const row = page.locator('.reference-entry').first()
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()

  const definition = page.locator('.reference-definition')
  await expect(definition).toBeVisible({ timeout: 5000 })
  await expect(definition).toContainText('seasonal fall of grey ash')
})

test('S-022: shows a character’s appears-in sections and jumps to one', async ({ page }) => {
  await openApp(page, {
    entries: [entry('r-essidor', 'character', 'Essidor Agjadoff')],
  })
  await openReferences(page)
  await openSurface(page, 'characters')

  const row = referenceRow(page, 'r-essidor')
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()

  const mention = page.locator('.reference-mention[data-section-id="s1"]')
  await expect(mention).toBeVisible({ timeout: 5000 })
  await mention.locator('.reference-mention-go').click()

  await expect(page.locator('.editor-sheet')).toBeVisible({ timeout: 5000 })
  await expect(
    page.locator('.editor-sheet .section-title[data-section-id="s1"]'),
  ).toBeInViewport({ timeout: 5000 })
})

test('S-023: merges two entries and shows the survivor carrying both names', async ({ page }) => {
  await openApp(page, {
    entries: [
      entry('r-qualen', 'character', 'Izildar Qualen'),
      entry('r-essidor', 'character', 'Essidor Agjadoff'),
    ],
  })
  await openReferences(page)
  await openSurface(page, 'characters')

  const absorbed = referenceRow(page, 'r-essidor')
  await expect(absorbed).toBeVisible({ timeout: 5000 })
  await absorbed.click()

  const merge = page.locator('.reference-merge')
  await expect(merge).toBeVisible({ timeout: 5000 })
  await merge.click()

  const target = page.locator('.reference-merge-target[data-entry-id="r-qualen"]')
  await expect(target).toBeVisible({ timeout: 5000 })
  await target.click()

  await expect(page.locator('.reference-entry')).toHaveCount(1, { timeout: 5000 })
  await referenceRow(page, 'r-qualen').click()

  const aliases = page.locator('.reference-alias')
  await expect(aliases.filter({ hasText: 'Essidor Agjadoff' })).toBeVisible({ timeout: 5000 })
})

test('S-024: switches between Outline, Characters and Glossary without leaving References', async ({ page }) => {
  await openApp(page, {
    entries: [entry('r-maren', 'character', 'Maren')],
  })
  await openReferences(page)

  await expect(page.locator('.references-view')).toBeVisible()
  await openSurface(page, 'characters')
  await expect(page.locator('.references-view')).toBeVisible()
  await expect(referenceRow(page, 'r-maren')).toBeVisible({ timeout: 5000 })

  await openSurface(page, 'glossary')
  await expect(page.locator('.references-view')).toBeVisible()

  await openSurface(page, 'outline')
  await expect(page.locator('.references-view')).toBeVisible()
  await expect(page.locator('.notes-entry').first()).toBeVisible({ timeout: 5000 })
})
