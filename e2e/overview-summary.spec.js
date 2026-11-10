import { test, expect } from '@playwright/test'
import { installTauriIpc } from './helpers/tauri-ipc.js'

// The Story overview's own summary (SPEC.md 5.20b, S-039). The overview is not a
// section, so the per-section summary path cannot serve it. This is the
// whole-manuscript recap, stored beside the section summaries and read back on
// reopen. The unit layer covers the page states. This covers the round trip.

const textStyle = { bold: false, italic: false, underline: false, fontSize: null }

const paragraph = (id, text) => ({
  id,
  elements: [{ textRun: { content: text } }],
  style: textStyle,
  alignment: null,
  lineSpacing: null,
  spaceBefore: null,
  spaceAfter: null,
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

const doc = {
  title: 'Overview Novel',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    section('c1', 'The Arrival', 'chapter', [paragraph('p-c1', 'The door opened on an empty street.')]),
    section('s1', 'Interlude', 'section', [paragraph('p-s1', 'A pause between two turns.')]),
  ],
}

const RECAP = 'One arrival, one letter, and no sender.'

const notes = { overview: 'A letter travels the wrong way.', sections: { c1: 'The arrival needs a bell.' }, orphaned: '' }

async function install(page) {
  await installTauriIpc(page, { doc })
  // An init script is serialized and runs in the page, so only its argument
  // object is in scope. Module-scope constants are not reachable from it, which
  // is why the recap text travels through the argument below.
  await page.addInitScript(
    ({ doc, notes, recap }) => {
      // First load only: an init script runs on every navigation, so an
      // unconditional write would rewind the record the reload must survive.
      if (localStorage.getItem('e2e-doc') === null) {
        localStorage.setItem('e2e-doc', JSON.stringify(doc))
      }
      if (localStorage.getItem('e2e-notes') === null) {
        localStorage.setItem('e2e-notes', JSON.stringify(notes))
      }
      localStorage.setItem('rite-llm-settings', JSON.stringify({ model: 'llama3' }))

      window.__tauriMock
        .route('get_document', () => JSON.parse(localStorage.getItem('e2e-doc')))
        .route('retrieve_notes', () => JSON.parse(localStorage.getItem('e2e-notes')))
        .route('retrieve_summaries', () => window.__tauriMock.fail('no summaries yet'))
        .route('retrieve_document_summary', () => {
          const stored = localStorage.getItem('e2e-document-summary')
          return stored ? JSON.parse(stored) : null
        })
        .route('summarize_and_store_document', () => {
          const entry = { summary: recap, stale: false }
          localStorage.setItem('e2e-document-summary', JSON.stringify(entry))
          return { sectionId: '', sectionHash: 0, summary: recap }
        })
    },
    { doc, notes, recap: RECAP },
  )
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
}

test('S-039: generates the overview summary, and finds it again after reopening', async ({ page }) => {
  await install(page)

  await page.locator('.view-tab').filter({ hasText: 'References' }).click()
  await expect(page.locator('.references-drawer')).toBeVisible({ timeout: 5000 })

  // The overview is the seeded selection, and nothing has been generated yet.
  await expect(page.locator('.note-recap-empty')).toBeVisible({ timeout: 5000 })
  const generate = page.locator('.note-generate')
  await expect(generate).toBeVisible()
  await generate.click()

  const recap = page.locator('.note-recap')
  await expect(recap).toBeVisible({ timeout: 5000 })
  await expect(page.locator('.note-recap-label')).toContainText(/recap/i)
  await expect(recap).toContainText(RECAP)

  // Reopen the file: the stored summary comes back from the sidecar.
  await page.reload()
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
  await page.locator('.view-tab').filter({ hasText: 'References' }).click()

  await expect(page.locator('.note-recap-text')).toContainText(RECAP)
})
