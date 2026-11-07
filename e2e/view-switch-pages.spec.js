import { test, expect } from '@playwright/test'
import { installTauriIpc } from './helpers/tauri-ipc.js'

// 5.1 — view-switch page preservation, from the editor's side.
//
// The page to preserve is the page the writer is WORKING on, not always the page
// at the top of the sheet. Two reported drifts pin the difference:
//
//   - the caret sits at the start of page 5 while page 4's last lines still fill
//     the top of the sheet: the manuscript must open on page 5 (it opened on 4);
//   - a Sections jump to a chapter must carry the caret, so the chapter the
//     writer chose is the page the editor reports when the view switches.
//
// Geometry matters here (page breaks are measured, not declared), so this is an
// e2e concern and not a unit one.

const textStyle = { bold: false, italic: false, underline: false, fontSize: null }
const paragraph = (id, text) => ({
  id, elements: [{ textRun: { content: text, textStyle } }],
  leftIndent: null, rightIndent: null, firstLineIndent: null,
})
const chapter = (n) => ({
  id: `c${n}`,
  title: `Chapter ${n}`,
  sectionType: 'chapter',
  hidden: false,
  paragraphs: Array.from({ length: 12 }, (_, i) => paragraph(
    `p-c${n}-${i}`,
    `Chapter ${n} paragraph ${i}. ` + 'The quick brown fox jumps over the lazy dog. '.repeat(6),
  )),
})

const doc = {
  title: 'Long Enough',
  author: 'A Writer',
  authorContact: '',
  hasTOC: false,
  sections: Array.from({ length: 8 }, (_, i) => chapter(i + 1)),
}

async function openLongDoc(page) {
  await installTauriIpc(page, { doc })
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
  // Page breaks are stamped after the first measure, not with the first paint.
  await page.waitForFunction(
    () => document.querySelectorAll('.editor-sheet [data-page-start]').length > 6,
    null,
    { timeout: 5000 },
  )
}

/// The manuscript page sitting at the top of the scroll layer, and its text.
function manuscriptTopPage(page) {
  return page.evaluate(() => {
    const layer = document.querySelector('.scroll-layer')
    const layerTop = layer.getBoundingClientRect().top
    let atTop = null
    for (const p of document.querySelectorAll('.manuscript-viewport .manuscript-page')) {
      if (p.getBoundingClientRect().top <= layerTop + 8) atTop = p
    }
    return atTop && { key: atTop.dataset.pageKey, text: atTop.textContent }
  })
}

async function openManuscript(page) {
  await page.click('button.view-tab:has-text("Manuscript")')
  await expect(page.locator('.manuscript-viewport')).toBeVisible()
  // The switch scrolls on nextTick; let the layout settle before measuring.
  await page.waitForTimeout(600)
}

test('the manuscript opens on the page the caret is on, not the page above it', async ({ page }) => {
  await openLongDoc(page)

  // Scroll page 4 to the top, then click the first line of page 5 without
  // scrolling: the writer's caret is on page 5 while the sheet's top still shows
  // page 4. That is the reported state.
  const target = await page.evaluate(() => {
    const layer = document.querySelector('.scroll-layer')
    const page4 = document.querySelector('.editor-sheet [data-page-start="4"]')
    layer.scrollTop += page4.getBoundingClientRect().top - layer.getBoundingClientRect().top
    const page5 = document.querySelector('.editor-sheet [data-page-start="5"]')
    const box = page5.getBoundingClientRect()
    return { x: Math.round(box.left + 40), y: Math.round(box.top + 46) }
  })
  await page.waitForTimeout(150)
  await page.mouse.click(target.x, target.y)
  await page.waitForTimeout(100)

  await openManuscript(page)

  const top = await manuscriptTopPage(page)
  // Editor page 5 is manuscript `content-4` (front matter is not a content page).
  expect(top, 'no manuscript page at the top of the scroll layer').not.toBeNull()
  expect(top.key).toBe('content-4')
})

test('a Sections jump carries the caret, so the manuscript opens on that section', async ({ page }) => {
  await openLongDoc(page)

  await page.click('button[title="Sections"]')
  await page.waitForSelector('.drawer.left.open .nav-section')
  // The drawer slides open; real pointer input needs its final geometry.
  await page.waitForTimeout(350)
  await page.locator('.drawer.left.open .nav-section').filter({ hasText: 'Chapter 5' }).click()
  await page.waitForTimeout(500)

  await openManuscript(page)

  const top = await manuscriptTopPage(page)
  expect(top, 'no manuscript page at the top of the scroll layer').not.toBeNull()
  expect(top.text).toContain('Chapter 5')
})
