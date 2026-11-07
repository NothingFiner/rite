import { test, expect } from '@playwright/test'
import { installTauriIpc, ipcCalls } from './helpers/tauri-ipc.js'

// The Notes scope end to end (SPEC.md 5.17a, B-001 and B-002).
//
// jsdom cannot answer these. S-010 and S-011 need the drawer, the scope select
// and the real request the app ships to Rust. S-015 needs the Sections drawer,
// a deletion and a page reload. The unit layer pins the context string, and
// this layer pins that the drawer and the deletion path reach it.

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
    section('s2', 'Ashes', 'section', [paragraph('p-s2a', 'Everything ends in ashes.')]),
  ],
}

/// Install the IPC mock, seed the notes record, and persist `update_notes`
/// where `retrieve_notes` reads it back. Without the localStorage round trip a
/// reload would come up with empty notes and S-015's "keep it" half would be
/// vacuous.
///
/// The seed is written only when the store is empty. An init script runs on
/// every navigation, so an unconditional write would rewind the record on the
/// reload it is supposed to survive.
async function installNotes(page, notes, doc = seededDoc) {
  await installTauriIpc(page, { doc })
  await page.addInitScript((seed) => {
    const empty = { overview: '', sections: {}, orphaned: '' }
    if (!localStorage.getItem('e2e-notes')) {
      localStorage.setItem('e2e-notes', JSON.stringify(seed))
    }
    window.__tauriMock
      .route('update_notes', (args) => {
        localStorage.setItem('e2e-notes', JSON.stringify(args.notes))
        return null
      })
      .route('retrieve_notes', () => {
        const raw = localStorage.getItem('e2e-notes')
        return raw ? JSON.parse(raw) : empty
      })
  }, notes)
}

async function openApp(page) {
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
}

// Since 5.20 the notes live in the References view, not behind a top-level
// Notes tab. Assert every step, so a missing view reads as a failed assertion
// rather than a click timeout.
const referencesTab = (page) => page.locator('.view-tab').filter({ hasText: 'References' })
const referencesNotesTab = (page) => page.locator('.references-tab[data-tab="notes"]')

async function openNotes(page) {
  const tab = referencesTab(page)
  await expect(tab).toBeVisible({ timeout: 5000 })
  await tab.click()
  await expect(page.locator('.references-view')).toBeVisible({ timeout: 5000 })

  const notes = referencesNotesTab(page)
  await expect(notes).toBeVisible({ timeout: 5000 })
  await notes.click()
  await expect(page.locator('.notes-view')).toBeVisible({ timeout: 5000 })
}

/// Open the assistant drawer unless it is already open. The toggle's title
/// follows its state, so the opener exists only while the drawer is shut.
/// S-011 sends twice, and must not toggle it closed on the second send.
async function openAssistant(page) {
  const opener = page.locator('button[title="Open Assistant"]')
  if ((await opener.count()) > 0) {
    await opener.click()
  }
  await expect(page.locator('.llm-scope-select')).toBeVisible({ timeout: 5000 })
}

/// Every `llm_chat_stream` request the page has sent, oldest first.
async function sentRequests(page) {
  return (await ipcCalls(page))
    .filter((call) => call.cmd === 'llm_chat_stream')
    .map((call) => call.args.request.messages)
}

/// Send one message under `scope` and return the messages the app shipped for
/// it. `sentCount` is the number of requests that must exist first, so a second
/// send waits for its own call rather than reading the previous one.
async function sendWithScope(page, scope, text, sentCount = 1) {
  await openAssistant(page)
  await page.locator('.llm-scope-select').selectOption(scope)
  await page.locator('.llm-input').fill(text)
  await page.locator('.llm-send-btn').click()
  await expect
    .poll(async () => (await sentRequests(page)).length, { timeout: 5000 })
    .toBeGreaterThanOrEqual(sentCount)
  const requests = await sentRequests(page)
  return requests[sentCount - 1]
}

/// The single context message in a request: the user message the app pushes
/// before the writer's own question.
function contextMessage(messages) {
  return messages.find((message) => message.role === 'user')
}

test("S-010: ships the notes to the assistant when Notes is chosen, and no manuscript prose", async ({
  page,
}) => {
  await installNotes(page, {
    overview: 'The letter drives the plot.',
    sections: { s1: 'The door is a lie.' },
    orphaned: '',
  })
  await openApp(page)

  const messages = await sendWithScope(page, 'notes', 'is the outline coherent?')
  const context = contextMessage(messages).content

  expect(context).toContain("author's notes")
  expect(context).toContain('The letter drives the plot.')
  expect(context).toContain('The door is a lie.')
  // Prose is exactly what this scope must not send.
  expect(context).not.toContain('The first chapter opens on the door.')
  expect(context).not.toContain('Everything ends in ashes.')
})

test('S-011: sends the manuscript again after the scope changes back to Whole document', async ({
  page,
}) => {
  await installNotes(page, { overview: 'The letter drives the plot.', sections: {}, orphaned: '' })
  await openApp(page)

  const notesMessages = await sendWithScope(page, 'notes', 'is the outline coherent?')
  expect(contextMessage(notesMessages).content).toContain('The letter drives the plot.')

  const documentMessages = await sendWithScope(page, 'document', 'how long is it?', 2)
  const context = contextMessage(documentMessages).content

  expect(context).toContain('full manuscript')
  expect(context).toContain('The first chapter opens on the door.')
  // No note text is left over from the previous send.
  expect(context).not.toContain('The letter drives the plot.')
})

test("S-015: shows a deleted section's note under Orphaned notes and keeps it after reopening", async ({
  page,
}) => {
  await installNotes(page, { overview: '', sections: { s1: 'The door is a lie.' }, orphaned: '' })
  // `delete_section` answers with the document minus the section, the way Rust
  // does. The notes are the store's business, not Rust's. The document is
  // persisted beside the notes as well, because the reopened file has to hold
  // the deletion too. A reload that hands the section back would resurrect its
  // id and the orphaned draft would stop being orphaned.
  await page.addInitScript((doc) => {
    if (!localStorage.getItem('e2e-doc')) {
      localStorage.setItem('e2e-doc', JSON.stringify(doc))
    }
    const current = () => JSON.parse(localStorage.getItem('e2e-doc'))
    window.__tauriMock
      .route('get_document', () => current())
      .route('delete_section', (args) => {
        const next = {
          ...current(),
          sections: current().sections.filter((entry) => entry.id !== args.id),
        }
        localStorage.setItem('e2e-doc', JSON.stringify(next))
        return next
      })
  }, seededDoc)
  await openApp(page)

  await page.locator('.activity-icon[title="Sections"]').click()
  const row = page.locator('li.nav-section[data-nav-id="s1"]')
  await expect(row).toBeVisible({ timeout: 5000 })
  // Rename/delete only render on the active row.
  await row.locator('.nav-row-control').click()
  await row.locator('.nav-delete').click()
  await expect
    .poll(
      async () => (await ipcCalls(page)).filter((call) => call.cmd === 'delete_section').length,
      { timeout: 5000 },
    )
    .toBeGreaterThan(0)

  await openNotes(page)
  const orphaned = page.locator('.notes-entry[data-entry-id="orphaned"]')
  await expect(orphaned).toBeVisible({ timeout: 5000 })
  await orphaned.click()

  // Headed by the deleted section's title, and the text moved rather than
  // copied: the section row is gone from the list.
  await expect(page.locator('.note-rendered')).toContainText('The Door')
  await expect(page.locator('.note-rendered')).toContainText('The door is a lie.')
  await expect(page.locator('.notes-entry[data-entry-id="s1"]')).toHaveCount(0)

  // Persisted through the save path: a reload reads the file's notes back.
  await page.reload()
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
  await openNotes(page)
  await page.locator('.notes-entry[data-entry-id="orphaned"]').click()
  await expect(page.locator('.note-rendered')).toContainText('The door is a lie.')
})
