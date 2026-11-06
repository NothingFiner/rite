import { test, expect } from '@playwright/test'
import { installTauriIpc } from './helpers/tauri-ipc.js'

// Search highlighting end to end, in real Chromium: useSearchPanel →
// editorRef.applySearchHighlights → DOM.
//
// The IPC envelope is the shared mock from ./helpers/tauri-ipc.js.
// `search_document` returns real SearchMatch objects computed from the live DOM
// text (char offsets against the paragraph's text node, matching how the Rust
// backend measures joined run contents for ASCII) — a jsdom test cannot measure
// a real text node the same way. `get_document` REJECTS so the store falls back
// to its default doc (same as the no-Tauri harness). This isolates the
// highlight + next/prev path from the Rust/sync path, which only runs inside
// real `npx tauri dev`.
async function installIpcMock(page) {
  await installTauriIpc(page, { docFails: true })
  await page.addInitScript(() => {
    window.__tauriMock.route('search_document', (args) => {
      const needle = String(args.query || '').toLowerCase()
      const out = []
      if (needle) {
        for (const p of document.querySelectorAll('.editor-sheet .paragraph')) {
          const text = p.textContent || ''
          let i = 0
          while ((i = text.toLowerCase().indexOf(needle, i)) !== -1) {
            out.push({
              sectionId: p.dataset.sectionId,
              paragraphId: p.dataset.paraId,
              startOffset: i,
              endOffset: i + args.query.length,
              text: text.slice(i, i + args.query.length),
            })
            i += args.query.length
          }
        }
      }
      return out
    })
  })
}

test('search highlights + next/prev with mocked IPC', async ({ page }) => {
  await installIpcMock(page)
  page.on('console', msg => { if (msg.type() === 'error') console.log('[browser error]', msg.text()) })
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })

  const firstParagraph = page.locator('.editor-sheet .paragraph').first()
  await firstParagraph.click()
  await page.keyboard.type('alpha bravo charlie bravo charlie')

  // Prove the typing readback reached the STORE (not just the contenteditable):
  // useWordCount reads store.doc.sections. 5 words → the localized syncSection
  // emit (forwarded by DocumentRenderer) OR the full syncSections fallback ran.
  await expect(page.locator('.word-count')).toContainText('5 words', { timeout: 4000 })

  await page.keyboard.press('Meta+f')
  const input = page.locator('.search-panel input[placeholder="Find..."]')
  await input.fill('bravo')

  // Initial search: 2 matches, currentIndex 0 → readout "1/2".
  await expect(page.locator('.search-panel .match-count')).toContainText('1/2')
  await expect(page.locator('.editor-sheet .search-highlight')).toHaveCount(1)
  await expect(page.locator('.editor-sheet .search-current')).toHaveCount(1)

  // Next → currentIndex 1 → "2/2", current moves to the 2nd match.
  await page.click('button[title="Next"]')
  await expect(page.locator('.search-panel .match-count')).toContainText('2/2')
  await expect(page.locator('.editor-sheet .search-current')).toHaveCount(1)

  // Next again → wraps to 0 → "1/2".
  await page.click('button[title="Next"]')
  await expect(page.locator('.search-panel .match-count')).toContainText('1/2')

  // Prev → back to 1 → "2/2".
  await page.click('button[title="Previous"]')
  await expect(page.locator('.search-panel .match-count')).toContainText('2/2')
})
