import { test, expect } from '@playwright/test'
import { installTauriIpc } from './helpers/tauri-ipc.js'

// The References view end to end (SPEC.md 5.20, S-004, S-005, S-023 … S-028).
//
// The unit layer covers the row model, the controlled tab and the generation
// gate. This file needs a real page for the toolbar and its theming, and for
// the jump landing in the editor.

const textStyle = { bold: false, italic: false, underline: false, fontSize: null }

const paragraph = (id, text) => ({
  id,
  elements: [{ textRun: { content: text, textStyle } }],
  leftIndent: null,
  rightIndent: null,
  firstLineIndent: null,
})

const section = (id, title, sectionType, paragraphs, extra = {}) => ({
  id,
  title,
  sectionType,
  hidden: false,
  paragraphs,
  ...extra,
})

const seededDoc = {
  title: 'Outline Novel',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    section('c1', 'The Arrival', 'chapter', [paragraph('p-c1', 'The door opened on an empty street.')]),
    section('s1', 'Interlude', 'section', [paragraph('p-s1', 'A pause between two turns.')]),
    // A chapter whose stored title is only its subtitle, and empty: 5.9 makes
    // that legitimate, so the row must be named by its derived number.
    section('c2', '', 'chapter', [paragraph('p-c2', 'The letter is opened at last.')]),
    section('s2', 'Ashes', 'section', [paragraph('p-s2', 'Everything ends in ashes.')], {
      hidden: true,
    }),
  ],
}

/// What `retrieve_summaries` returns: manuscript order, summarized sections
/// only. s1 (no summary) and s2 (hidden, no summary) are deliberately absent.
const summaries = [
  {
    sectionId: 'c1',
    chapterIndex: 1,
    title: 'The Arrival',
    sectionType: 'chapter',
    summary: 'Mara arrives by night and finds the door open.',
    stale: false,
  },
  {
    sectionId: 'c2',
    chapterIndex: 2,
    title: '',
    sectionType: 'chapter',
    summary: 'The letter is read and the plan changes.',
    stale: true,
  },
]

const referencesTab = (page) => page.locator('.view-tab').filter({ hasText: 'References' })
const editorTab = (page) => page.locator('.view-tab').filter({ hasText: 'Editor' })
const outlineTab = (page) => page.locator('.references-tab[data-tab="outline"]')
const notesTab = (page) => page.locator('.references-tab[data-tab="notes"]')
const row = (page, id) => page.locator(`.outline-row[data-section-id="${id}"]`)

/// Mount the app with the summaries route answering `entries`, and optionally a
/// configured chat model (localStorage is where llm settings live).
async function openApp(page, { entries = summaries, model = 'llama3', theme = null } = {}) {
  await installTauriIpc(page, { doc: seededDoc })
  await page.addInitScript(
    ({ entries, model, theme }) => {
      window.__tauriMock.route('retrieve_summaries', () => {
        if (entries.length === 0) {
          // The command's real empty-store behaviour is an error. A view has
          // to read that error as "nothing generated yet".
          return window.__tauriMock.fail(
            'no summaries yet — generate them from the AI options, then set the Feedback Target to Summaries',
          )
        }
        return entries
      })
      if (model !== null) {
        const stored = JSON.parse(localStorage.getItem('rite-llm-settings') || '{}')
        localStorage.setItem('rite-llm-settings', JSON.stringify({ ...stored, model }))
      }
      if (theme) {
        localStorage.setItem('rite-bg', theme)
      }
    },
    { entries, model, theme },
  )
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
}

/// Assert the tab, then the view: a missing References tab must fail as an
/// assertion rather than an opaque click timeout.
async function openReferences(page) {
  const tab = referencesTab(page)
  await expect(tab).toBeVisible({ timeout: 5000 })
  await tab.click()
  await expect(page.locator('.references-view')).toBeVisible({ timeout: 5000 })
}

test('S-023: opens References from the toolbar and shows each section with its summary in document order', async ({ page }) => {
  await openApp(page)
  await openReferences(page)

  // Outline is the tab the view opens on.
  await expect(outlineTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.outline-row')).toHaveCount(4)

  const titles = await page.locator('.outline-title').allTextContents()
  expect(titles).toEqual(['Chapter 1: The Arrival', 'Interlude', 'Chapter 2', 'Ashes'])

  await expect(row(page, 'c1').locator('.outline-summary')).toHaveText(
    'Mara arrives by night and finds the door open.',
  )
  // A section with no summary keeps its row and says so, rather than vanishing.
  await expect(row(page, 's1').locator('.outline-summary')).toHaveText('')
  await expect(row(page, 's1')).toContainText(/no summary yet/i)
})

test('S-024: opens the section in the editor when its Outline row is chosen', async ({ page }) => {
  await openApp(page)
  await openReferences(page)

  const target = row(page, 's1')
  await expect(target).toBeVisible({ timeout: 5000 })
  await target.click()

  await expect(page.locator('.editor-sheet')).toBeVisible({ timeout: 5000 })
  // The title, not any paragraph: the jump lands on the section's heading.
  await expect(
    page.locator('.editor-sheet .section-title[data-section-id="s1"]'),
  ).toBeInViewport()
})

test('S-025: still opens, edits and saves a note on the Notes tab inside References', async ({ page }) => {
  await openApp(page)
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
  await openReferences(page)

  await expect(notesTab(page)).toBeVisible({ timeout: 5000 })
  await notesTab(page).click()
  await expect(page.locator('.notes-view')).toBeVisible({ timeout: 5000 })

  const entry = page.locator('.notes-entry[data-entry-id="s1"]')
  await expect(entry).toBeVisible({ timeout: 5000 })
  await entry.click()

  const pencil = page.locator('.note-edit')
  await expect(pencil).toBeVisible({ timeout: 5000 })
  await pencil.click()
  await page.locator('.note-source').fill('The interlude needs a storm.')
  await page.locator('.note-save').click()

  await expect(page.locator('.note-pane')).toContainText('The interlude needs a storm.')
  // The note is the writer's text, and the tab it was written in is still the
  // one in front.
  await expect(notesTab(page)).toHaveAttribute('aria-selected', 'true')
})

test('S-005: returns to References with the Notes tab selected after a section jump from a note', async ({ page }) => {
  await openApp(page)
  await page.addInitScript(() => {
    window.__tauriMock.route('retrieve_notes', () => ({
      overview: '',
      sections: { s1: 'A pause worth keeping.' },
      orphaned: '',
    }))
  })
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
  await openReferences(page)
  await expect(notesTab(page)).toBeVisible({ timeout: 5000 })
  await notesTab(page).click()

  const entry = page.locator('.notes-entry[data-entry-id="s1"]')
  await expect(entry).toBeVisible({ timeout: 5000 })
  await entry.click()

  const jump = page.locator('.note-jump')
  await expect(jump).toBeVisible({ timeout: 5000 })
  await jump.click()
  await expect(page.locator('.editor-sheet')).toBeVisible({ timeout: 5000 })

  // Coming back lands where the writer left: the notes, not the outline.
  await openReferences(page)
  await expect(notesTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.notes-view')).toBeVisible({ timeout: 5000 })
})

test('S-026: paints the References view with the active theme', async ({ page }) => {
  await openApp(page, { theme: '#101010' })
  await openReferences(page)

  await expect(page.locator('.references-view')).toHaveCSS(
    'background-color',
    'rgb(16, 16, 16)',
  )
})

test('S-027: names a subtitle-less chapter by its number and labels its summary', async ({ page }) => {
  await openApp(page)
  await openReferences(page)

  const untitled = row(page, 'c2')
  await expect(untitled.locator('.outline-title')).toHaveText('Chapter 2')
  await expect(untitled.locator('.outline-title')).not.toHaveText('')

  // Model text is attributed, so it cannot be read as the writer's own line.
  await expect(untitled.locator('.outline-summary-label')).toBeVisible()
  await expect(untitled.locator('.outline-summary-label')).toContainText(/summary/i)
  // A drifted summary is marked as such.
  await expect(untitled.locator('.outline-stale')).toBeVisible()
})

test('S-028: shows the generation controls only when a model is configured', async ({ page }) => {
  await openApp(page, { entries: [], model: '' })
  await openReferences(page)

  await expect(page.locator('.outline-awaiting')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('.outline-generate')).toHaveCount(0)
  await expect(page.locator('.outline-refresh-stale')).toHaveCount(0)
  await expect(page.locator('.outline-view')).toContainText(/general options/i)

  // With a model configured the empty state offers generation instead of
  // sending the writer to settings.
  await openApp(page, { entries: [], model: 'llama3' })
  await openReferences(page)

  await expect(page.locator('.outline-awaiting')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('.outline-generate')).toBeVisible()
})
