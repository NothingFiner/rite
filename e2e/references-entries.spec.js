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

// Revision 2: a usable entry page, and a References panel that stays put.

const railItem = (page, label) => page.locator(`.activity-icon[aria-label="${label}"]`)

test('S-037: names a character, shows its mentions and keeps the name after reopening', async ({ page }) => {
  await openApp(page, { entries: [entry('r-qualen', 'character', '')] })
  await openReferences(page)
  await openSurface(page, 'characters')

  await referenceRow(page, 'r-qualen').click()

  const nameField = page.locator('.reference-name')
  await expect(nameField).toBeVisible({ timeout: 5000 })
  await nameField.fill('Izildar Qualen')
  await nameField.blur()

  await expect(page.locator('.reference-entry-heading')).toContainText('Izildar Qualen')
  await expect(page.locator('.reference-mention[data-section-id="c1"]')).toBeVisible({ timeout: 5000 })

  await page.reload()
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
  await openReferences(page)
  await openSurface(page, 'characters')
  await referenceRow(page, 'r-qualen').click()

  await expect(page.locator('.reference-entry-heading')).toContainText('Izildar Qualen')
  await expect(page.locator('.reference-mention[data-section-id="c1"]')).toBeVisible({ timeout: 5000 })
})

test('S-038: adds an entry from Characters, selects its row and opens its page', async ({ page }) => {
  await openApp(page)
  await openReferences(page)
  await openSurface(page, 'characters')

  const add = page.locator('[data-add-kind="character"]')
  await expect(add).toBeVisible({ timeout: 5000 })
  await add.click()

  const selected = page.locator('.reference-entry.selected')
  await expect(selected).toHaveCount(1, { timeout: 5000 })
  await expect(selected).toContainText('Untitled character')
  await expect(page.locator('.reference-entry-heading')).toContainText('Untitled character')
  await expect(page.locator('.reference-definition-source')).toBeVisible({ timeout: 5000 })
})

test('S-039: removes a mention and adds the same section back by hand', async ({ page }) => {
  await openApp(page, { entries: [entry('r-essidor', 'character', 'Essidor Agjadoff')] })
  await openReferences(page)
  await openSurface(page, 'characters')
  await referenceRow(page, 'r-essidor').click()

  const mentionRow = page.locator('.reference-mention[data-section-id="s1"]')
  await expect(mentionRow).toBeVisible({ timeout: 5000 })
  await mentionRow.locator('.reference-mention-remove').click()
  await expect(mentionRow).toHaveCount(0, { timeout: 5000 })

  await page.locator('.reference-mention-add').selectOption('s1')

  await expect(page.locator('.reference-mention[data-section-id="s1"]')).toBeVisible({ timeout: 5000 })
})

test('S-046: regenerates all summaries from the Assistant panel', async ({ page }) => {
  await installTauriIpc(page, { doc: seededDoc })
  await page.addInitScript(() => {
    if (!localStorage.getItem('rite-llm-settings')) {
      localStorage.setItem('rite-llm-settings', JSON.stringify({
        endpoint: 'http://localhost:11434',
        model: 'llama3',
        apiKey: '',
        contextLength: 8192,
      }))
    }
  })
  await page.addInitScript(() => {
    window.__tauriMock.route('retrieve_summaries', () => [])
    window.__tauriMock.route('retrieve_document_summary', () => null)
    window.__tauriMock.route('summarize_and_store_section', () => null)
    window.__tauriMock.route('summarize_and_store_document', () => null)
  })
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })

  await page.locator('.tool-btn.drawer-toggle').click()
  const control = page.locator('.llm-panel .regenerate-all')
  await expect(control).toBeVisible({ timeout: 5000 })
  await control.click()

  await expect
    .poll(() => invoked(page, 'summarize_and_store_section'))
    .toBe(true)
  await expect
    .poll(() => invoked(page, 'summarize_and_store_document'))
    .toBe(true)
})

test('S-049: keeps the References panel open while the References view is active', async ({ page }) => {
  await openApp(page)
  await openReferences(page)

  // Check `aria-expanded`, not visibility: the panel slides for 250ms, so a
  // visibility read right after an action is still true.
  await expect(railItem(page, 'References')).toHaveAttribute('aria-expanded', 'true')

  await openSurface(page, 'characters')

  await expect(railItem(page, 'References')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.surface-tabs')).toBeVisible({ timeout: 5000 })
})

test('S-050: returns to the References panel after closing another panel', async ({ page }) => {
  await openApp(page)
  await openReferences(page)

  await railItem(page, 'Stats').click()
  await expect(railItem(page, 'References')).toHaveAttribute('aria-expanded', 'false')

  await railItem(page, 'Stats').click()

  await expect(railItem(page, 'References')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.surface-tabs')).toBeVisible({ timeout: 5000 })
})

test('S-051: clicking the References rail item while the panel shows does not collapse it', async ({ page }) => {
  await openApp(page)
  await openReferences(page)

  await railItem(page, 'References').click()

  await expect(railItem(page, 'References')).toHaveAttribute('aria-expanded', 'true')
})

test('S-052: shows the References panel after a Stats round trip', async ({ page }) => {
  await openApp(page)
  await openReferences(page)

  await expect(railItem(page, 'References')).toHaveAttribute('aria-expanded', 'true')

  await railItem(page, 'Stats').click()
  await railItem(page, 'Stats').click()

  await expect(railItem(page, 'References')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.surface-tabs')).toBeVisible({ timeout: 5000 })
})
