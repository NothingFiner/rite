import { test, expect } from '@playwright/test'
import { installTauriIpc } from './helpers/tauri-ipc.js'

// The References view end to end (SPEC.md 5.20a, S-003 and S-022 … S-027).
//
// The unit layer covers the drawer rows, the page and the generation gates.
// This file needs a real page for the rail, the drawer, the theme, the status
// bar and the editor landing. It also proves the sidecar round trip.

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
  title: 'Reference Novel',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    section('c1', 'The Arrival', 'chapter', [paragraph('p-c1', 'The door opened on an empty street.')]),
    section('s1', 'Interlude', 'section', [paragraph('p-s1', 'A pause between two turns.')]),
    // A chapter whose stored title is only its subtitle, and empty: 5.9 makes
    // that legitimate, so the row must be named by its derived number.
    section('c2', '', 'chapter', [paragraph('p-c2', 'The letter is opened at last.')]),
    section('s2', 'Ashes', 'section', [paragraph('p-s2', 'Everything ends in ashes.')]),
  ],
}

/// The same manuscript, long enough to scroll. The default seed is shorter than
/// a 720px viewport, so `.scroll-layer` has maxScroll 0 and *no* landing — top,
/// centre or otherwise — can put s2's title near the top. S-025 is about where
/// the jump lands, so it needs a document where landing is possible at all.
const tallDoc = {
  ...seededDoc,
  sections: [
    section(
      'c1',
      'The Arrival',
      'chapter',
      Array.from({ length: 24 }, (_, i) =>
        paragraph('p-c1-' + i, 'The door opened on an empty street, and the town beyond it was quiet. ' + i),
      ),
    ),
    section(
      's1',
      'Interlude',
      'section',
      Array.from({ length: 12 }, (_, i) => paragraph('p-s1-' + i, 'A pause between two turns, number ' + i)),
    ),
    section('c2', '', 'chapter', [paragraph('p-c2', 'The letter is opened at last.')]),
    section('s2', 'Ashes', 'section', [paragraph('p-s2', 'Everything ends in ashes.')]),
  ],
}

/// What `retrieve_summaries` returns: manuscript order, summarized sections
/// only. s1 and s2 are deliberately absent.
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

const notes = {
  overview: 'A letter travels the wrong way.',
  sections: { c1: 'The arrival needs a bell.', c2: 'The letter is a trap.' },
  orphaned: 'Cut in draft four.',
}

const referencesTab = (page) => page.locator('.view-tab').filter({ hasText: 'References' })
const drawer = (page) => page.locator('.references-drawer')
const row = (page, id) => page.locator(`.notes-entry[data-entry-id="${id}"]`)
const pageTitle = (page) => page.locator('.note-head .note-title')
const anchorButton = (page) => page.locator('.activity-bar [title="References"]')

/// Seed the document and the notes where the app reads them back: `get_document`
/// and `retrieve_notes` both answer from localStorage, and their write commands
/// persist there. Without the round trip, a reload or a reopen would show a
/// different record from the one the page wrote.
async function install(
  page,
  { entries = summaries, model = 'llama3', theme = null, notesSeed = notes, doc = seededDoc } = {},
) {
  await installTauriIpc(page, { doc })
  await page.addInitScript(
    ({ entries, model, theme, notesSeed, doc }) => {
      // Seed only on the first load. An init script runs on every navigation,
      // so an unconditional write rewinds the record on the reload the test is
      // about to prove survives (the same trap e2e/notes-scope.spec.js's
      // installNotes calls out).
      if (localStorage.getItem('e2e-doc') === null) {
        localStorage.setItem('e2e-doc', JSON.stringify(doc))
      }
      if (localStorage.getItem('e2e-notes') === null) {
        localStorage.setItem('e2e-notes', JSON.stringify(notesSeed))
      }

      window.__tauriMock.route('retrieve_summaries', () => {
        if (entries.length === 0) {
          // The command's real empty-store behaviour is an error. A view has
          // to read that error as "nothing generated yet".
          return window.__tauriMock.fail('no summaries yet')
        }
        return entries
      })
      window.__tauriMock
        .route('get_document', () => JSON.parse(localStorage.getItem('e2e-doc')))
        .route('retrieve_notes', () => JSON.parse(localStorage.getItem('e2e-notes')))
        .route('update_notes', (args) => {
          localStorage.setItem('e2e-notes', JSON.stringify(args.notes))
          return null
        })

      if (model !== null) {
        const stored = JSON.parse(localStorage.getItem('rite-llm-settings') || '{}')
        localStorage.setItem('rite-llm-settings', JSON.stringify({ ...stored, model }))
      }
      if (theme) localStorage.setItem('rite-bg', theme)
    },
    { entries, model, theme, notesSeed, doc },
  )
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
}

async function openReferences(page) {
  const tab = referencesTab(page)
  await expect(tab).toBeVisible({ timeout: 5000 })
  await tab.click()
  await expect(page.locator('.references-view')).toBeVisible({ timeout: 5000 })
  // Entering References opens the drawer. Without it the page has no list.
  await expect(drawer(page)).toBeVisible({ timeout: 5000 })
}

async function selectRow(page, id) {
  const target = row(page, id)
  await expect(target).toBeVisible({ timeout: 5000 })
  await target.click()
}

test('S-003: opens the Reference drawer on entry, and the rail button closes and reopens it', async ({ page }) => {
  await install(page)
  await openReferences(page)

  // The rail must offer the drawer handle in this view. 5.20 shipped with an
  // empty visibility map, so every icon vanished.
  const anchor = anchorButton(page)
  await expect(anchor).toBeVisible({ timeout: 5000 })

  await anchor.click()
  await expect(drawer(page)).toBeHidden({ timeout: 5000 })

  await anchor.click()
  await expect(drawer(page)).toBeVisible({ timeout: 5000 })
})

test('S-022: shows the drawer rows in document order with the selected section on the page', async ({ page }) => {
  await install(page)
  await openReferences(page)

  const ids = await page.locator('.notes-entry').evaluateAll((rows) =>
    rows.map((entry) => entry.getAttribute('data-entry-id')),
  )
  expect(ids).toEqual(['overview', 'c1', 's1', 'c2', 's2', 'orphaned'])

  // A chapter heading groups the rows beneath it. An untitled chapter is named
  // by its number, and the retired group holds the orphaned draft.
  const groups = await page.locator('h3.drawer-heading.notes-group').allTextContents()
  expect(groups).toEqual(['The Arrival', 'Chapter 2', 'Retired'])

  await selectRow(page, 'c1')

  await expect(pageTitle(page)).toHaveText('The Arrival')
  await expect(page.locator('.note-rendered')).toContainText('The arrival needs a bell.')
  await expect(page.locator('.note-recap-label')).toContainText(/assistant recap/i)
  await expect(page.locator('.note-recap')).toContainText(
    'Mara arrives by night and finds the door open.',
  )
})

test('S-023: selecting another chapter changes the page without leaving References', async ({ page }) => {
  await install(page)
  await openReferences(page)

  await selectRow(page, 'c1')
  await expect(pageTitle(page)).toHaveText('The Arrival')
  await expect(page.locator('.note-rendered')).toContainText('The arrival needs a bell.')

  await selectRow(page, 'c2')
  await expect(pageTitle(page)).toHaveText('Chapter 2')
  await expect(page.locator('.note-rendered')).toContainText('The letter is a trap.')
  await expect(page.locator('.note-rendered')).not.toContainText('The arrival needs a bell.')

  // Choosing a row is selection, not navigation.
  await expect(page.locator('.references-view')).toBeVisible()
  await expect(drawer(page)).toBeVisible()
})

test('S-024: inserts the recap into the note, saves it and keeps it after reopening', async ({ page }) => {
  await install(page)
  await openReferences(page)
  await selectRow(page, 'c1')

  const insert = page.locator('.note-insert-recap')
  await expect(insert).toBeVisible({ timeout: 5000 })
  await insert.click()

  // Inserting opens the draft. Saving commits it to the notes sidecar.
  const source = page.locator('.note-source')
  await expect(source).toBeVisible({ timeout: 5000 })
  await expect(source).toHaveValue(/The arrival needs a bell\./)
  await expect(source).toHaveValue(/Mara arrives by night and finds the door open\./)
  await page.locator('.note-save').click()
  await expect(page.locator('.note-rendered')).toContainText('Mara arrives by night and finds the door open.')

  // Reopen the file: the saved note comes back from the sidecar.
  await page.reload()
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
  await openReferences(page)
  await selectRow(page, 'c1')

  await expect(page.locator('.note-rendered')).toContainText('The arrival needs a bell.')
  await expect(page.locator('.note-rendered')).toContainText(
    'Mara arrives by night and finds the door open.',
  )
})

test('S-025: Go to text returns to the origin view with the section at the top of the viewport', async ({ page }) => {
  await install(page, { doc: tallDoc })
  await openReferences(page)
  await selectRow(page, 's2')

  const jump = page.locator('.note-jump')
  await expect(jump).toBeVisible({ timeout: 5000 })
  await jump.click()

  await expect(page.locator('.editor-sheet')).toBeVisible({ timeout: 5000 })

  // The heading lands at the top of the scroll viewport, not on the page above.
  // A page is several hundred pixels, so the tolerance is a heading's worth of
  // chrome.
  const sectionTitle = page.locator('.editor-sheet .section-title[data-section-id="s2"]')
  await expect(sectionTitle).toBeVisible({ timeout: 5000 })

  await expect
    .poll(
      async () => {
        const [title, viewport] = await Promise.all([
          sectionTitle.boundingBox(),
          page.locator('.scroll-layer').boundingBox(),
        ])
        if (!title || !viewport) return Number.POSITIVE_INFINITY
        return Math.round(title.y - viewport.y)
      },
      { timeout: 5000 },
    )
    .toBeLessThan(200)
})

test('S-026: keeps the rail and the drawer, and paints the page with the active theme', async ({ page }) => {
  await install(page, { theme: '#101010' })
  await openReferences(page)

  await expect(page.locator('.activity-bar')).toBeVisible()
  const railTitles = await page
    .locator('.activity-bar .activity-icons .activity-icon')
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('title')))
  expect(railTitles).toContain('References')

  await expect(drawer(page)).toBeVisible()
  await expect(page.locator('.notes-view')).toHaveCSS('background-color', 'rgb(16, 16, 16)')
})

test('S-027: names the anchor section in the status bar and marks its drawer row', async ({ page }) => {
  await install(page)

  // Put the caret in Ashes before opening References: that section is where
  // the writer came from.
  await page.locator('.editor-sheet .paragraph').filter({ hasText: 'Everything ends in ashes.' }).click()

  await openReferences(page)

  const chip = page.locator('.anchor-chip')
  await expect(chip).toBeVisible()
  await expect(chip).toContainText('Ashes')

  await expect(row(page, 's2')).toHaveClass(/is-anchor/)
  await expect(row(page, 'c1')).not.toHaveClass(/is-anchor/)
})
