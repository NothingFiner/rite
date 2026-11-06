import { test, expect } from '@playwright/test'
import { installTauriIpc } from './helpers/tauri-ipc.js'

// Hidden-section e2e (roadmap 5.10). Drives the full toggle chain in a real
// browser: drawer eye badge → emit toggleHidden → store setSectionHidden
// (flush-first) → invoke('set_section_hidden') → Rust doc assigned back →
// editor reconciler swaps the title for the dimmed marker. Then proves the
// DOM→model readback round-trips the flag (type after toggling → the marker
// survives), the manuscript renders the hidden section's body with NO heading
// (the empty .ms-para marker display:none'd by the page CSS), and toggling
// back restores the heading.
//
// The harness runs pure Vite with no Tauri runtime, so the commands are served
// by the shared IPC mock (./helpers/tauri-ipc.js) with routes mirroring the real
// Rust contracts:
//   - sync_document: journals/installs the shipped doc → () — the mock keeps
//     its copy current so a later command's returned doc doesn't wipe typed
//     text (the real backend holds the synced doc the same way).
//   - set_section_hidden: { id, hidden } → the document with the section's
//     hidden flag set, mirroring commands.rs (unknown id → error, like the
//     Rust command's find_section_mut).

function makeParagraph(id, content) {
  return {
    id,
    elements: [{ textRun: { content, textStyle: {} } }],
    leftIndent: null,
    rightIndent: null,
    firstLineIndent: null,
  }
}

function makeSection(id, title, sectionType, paragraphs) {
  return { id, title, sectionType, hidden: false, paragraphs }
}

const initialDoc = {
  title: 'Hidden Test',
  author: 'A',
  authorContact: '',
  hasTOC: false,
  sections: [
    makeSection('s1', 'Epigram', 'section', [makeParagraph('p1', 'Only connect the prose and the passion.')]),
    makeSection('s2', 'The Arrival', 'chapter', [makeParagraph('p2', 'The door opened.')]),
  ],
}

async function installIpcMock(page) {
  await installTauriIpc(page)
  await page.addInitScript((doc) => {
    let liveDoc = doc
    window.__tauriMock
      .route('get_document', () => liveDoc)
      .route('sync_document', (args) => {
        liveDoc = args.data
        return null
      })
      .route('set_section_hidden', (args) => {
        const target = liveDoc.sections.find((s) => s.id === args.id)
        if (!target) return window.__tauriMock.fail('ChangeSectionHidden: section not found')
        liveDoc = {
          ...liveDoc,
          sections: liveDoc.sections.map((s) =>
            s.id === args.id ? { ...s, hidden: Boolean(args.hidden) } : s,
          ),
        }
        return liveDoc
      })
  }, initialDoc)
}

test('hidden section: toggle, type, manuscript render, untoggle', async ({ page }) => {
  await installIpcMock(page)
  page.on('console', msg => { if (msg.type() === 'error') console.log('[browser error]', msg.text()) })
  await page.goto('/')
  await page.waitForSelector('.editor-sheet', { timeout: 5000 })

  // (1) Toggle the epigram hidden via the drawer's eye badge. Before the
  // toggle the editor shows a normal title; after, the SAME div carries the
  // section-hidden marker class + data attr and still holds the title text.
  await page.click('button[title="Sections"]')
  await page.waitForSelector('.drawer.left.open .nav-section')
  await page.waitForTimeout(350)
  await expect(page.locator('.editor-sheet .section-title.section-hidden')).toHaveCount(0)
  await page.locator('.drawer.left.open .nav-section .nav-hidden-toggle').first().click()

  const marker = page.locator('.editor-sheet .section-title.section-hidden')
  await expect(marker).toHaveCount(1)
  await expect(marker).toHaveAttribute('data-section-hidden', 'true')
  await expect(marker).toContainText('Epigram')
  // The drawer row dims but stays listed (the only way back to the section).
  await expect(page.locator('.drawer.left.open .nav-section.section-hidden')).toHaveCount(1)

  // (2) Type in the hidden section's paragraph immediately after toggling —
  // the DOM→model readback must carry data-section-hidden back into the
  // emitted section or the marker would silently vanish on the next render.
  await page.locator('.editor-sheet .paragraph').first().click()
  await page.keyboard.type(' — and both the best')
  await expect(page.locator('.editor-sheet .paragraph').first())
    .toContainText('Only connect the prose and the passion. — and both the best')
  await expect(marker).toHaveCount(1)
  await expect(marker).toHaveAttribute('data-section-hidden', 'true')

  // (3) Manuscript view: the epigram's BODY renders on its own page, the
  // heading does not — the empty .ms-para marker exists in the DOM (the
  // pagination measurer needs its positional slot) but is display:none'd,
  // and no rendered text says "Epigram".
  await page.click('.view-tab:has-text("Manuscript")')
  await page.waitForSelector('.manuscript-page', { timeout: 5000 })
  const emptyMarker = page.locator('.manuscript-page .ms-para.section-hidden')
  await expect(emptyMarker).toHaveCount(1)
  await expect(emptyMarker).toBeHidden()
  await expect(page.locator('.manuscript-viewport')).not.toContainText('Epigram')
  await expect(page.locator('.manuscript-viewport')).toContainText('Only connect the prose and the passion. — and both the best')
  // The visible chapter heading is untouched by the hidden section.
  await expect(page.locator('.manuscript-viewport')).toContainText('Chapter 1: The Arrival')

  // (4) Toggle back in the editor: the marker class and attr are gone and the
  // title renders as an ordinary heading again.
  await page.click('.view-tab:has-text("Editor")')
  await page.waitForSelector('.editor-sheet .section-title', { timeout: 5000 })
  await page.locator('.drawer.left.open .nav-section .nav-hidden-toggle').first().click()
  await expect(page.locator('.editor-sheet .section-title.section-hidden')).toHaveCount(0)
  await expect(page.locator('.editor-sheet .section-title[data-section-id="s1"]')).toContainText('Epigram')
  await expect(page.locator('.drawer.left.open .nav-section.section-hidden')).toHaveCount(0)
})