import { test, expect } from '@playwright/test'
import { installTauriIpc } from './helpers/tauri-ipc.js'

// Structure, motion and focus rings (SPEC.md 5.7b), in real Chromium.
//
// The unit layer covers the heading markup (src/composables/useParagraphHTML.test.js)
// and the landmark roles on the three chrome components. What only a real page
// can show is the accessibility tree built from that markup, where one Tab press
// lands, and two computed styles: a motion duration and a focus ring.
//
// Tauri IPC is the shared mock from ./helpers/tauri-ipc.js.

function paragraph(id, body) {
  return {
    id,
    elements: [
      {
        textRun: {
          content: body,
          textStyle: { bold: false, italic: false, underline: false, fontSize: null },
        },
      },
    ],
    leftIndent: null,
    rightIndent: null,
    firstLineIndent: null,
  }
}

const DOC = {
  title: 'Structure',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    {
      id: 's-1',
      title: 'Chapter One',
      sectionType: 'chapter',
      hidden: false,
      paragraphs: [paragraph('s-1-p1', 'The lamp was lit before the rain began.')],
    },
    {
      id: 's-2',
      title: 'Prologue',
      sectionType: 'section',
      hidden: false,
      paragraphs: [paragraph('s-2-p1', 'She read until the house went quiet.')],
    },
  ],
}

async function openApp(page) {
  await installTauriIpc(page, { doc: DOC })
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
}

/** Tab until focus sits on `selector`, so the ring is genuinely keyboard-made. */
async function tabTo(page, selector, max = 60) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab')
    const landed = await page.evaluate(
      (sel) => document.activeElement?.matches?.(sel) ?? false,
      selector,
    )
    if (landed) return true
  }
  return false
}

/** Outline and shadow only, so a control's colors cannot mask a missing ring. */
const ringOf = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const style = getComputedStyle(el)
    return [style.outlineStyle, style.outlineWidth, style.boxShadow].join('|')
  }, selector)

test('S-002: the rendered titles are headings in the editor and in the manuscript', async ({ page }) => {
  await openApp(page)

  const chapter = page.locator('.editor-sheet .section-title.chapter').first()
  const section = page.locator('.editor-sheet .section-title:not(.chapter)').first()

  await expect(chapter).toHaveAttribute('role', 'heading')
  await expect(chapter).toHaveAttribute('aria-level', '1')
  await expect(section).toHaveAttribute('role', 'heading')
  await expect(section).toHaveAttribute('aria-level', '2')

  await page.locator('.view-tab', { hasText: 'Manuscript' }).click()
  await expect(page.locator('.manuscript-viewport')).toBeVisible()

  const chapterPage = page.locator('.ms-para.chapter').first()
  await expect(chapterPage).toHaveAttribute('role', 'heading')
  await expect(chapterPage).toHaveAttribute('aria-level', '1')
})

test('S-003: the skip link is the first tab stop and out of sight until focused', async ({ page }) => {
  await openApp(page)

  const skip = page.locator('.skip-link')
  await expect(skip).toHaveCount(1)

  const before = await skip.boundingBox()
  expect(before === null || before.height < 20).toBe(true)

  await page.keyboard.press('Tab')

  await expect(skip).toBeFocused()
  const after = await skip.boundingBox()
  expect(after.height).toBeGreaterThanOrEqual(20)
})

test('S-004: activating the skip link moves focus into the manuscript', async ({ page }) => {
  await openApp(page)

  await page.keyboard.press('Tab')
  await expect(page.locator('.skip-link')).toBeFocused()

  await page.keyboard.press('Enter')

  await expect(page.locator('.editor-sheet')).toBeFocused()
})

test('S-006: the editing area is the main landmark', async ({ page }) => {
  await openApp(page)

  await expect(page.locator('.scroll-layer')).toHaveAttribute('role', 'main')
  await expect(page.getByRole('main')).toHaveCount(1)
})

test('S-007: reduced motion cuts every transition and animation to no time', async ({ page }) => {
  await openApp(page)
  await page.locator('.activity-icon[title="Text Options"]').click()
  await expect(page.locator('.drawer.left.open')).toBeVisible()

  const durations = () =>
    page.evaluate(() => {
      const seconds = (value) =>
        Math.max(
          ...value.split(',').map((part) => {
            const text = part.trim()
            return text.endsWith('ms') ? parseFloat(text) / 1000 : parseFloat(text)
          }),
        )
      const read = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const style = getComputedStyle(el)
        return { transition: seconds(style.transitionDuration), animation: seconds(style.animationDuration) }
      }
      return {
        drawer: read('.drawer.left.open'),
        toolbar: read('.tool-btn'),
        zoom: read('.zoom-btn'),
      }
    })

  const before = await durations()
  expect(before.drawer.transition, 'the drawer should animate by default').toBeGreaterThan(0)

  await page.emulateMedia({ reducedMotion: 'reduce' })

  const after = await durations()
  for (const [name, probe] of Object.entries(after)) {
    expect(probe.transition, `${name} still transitions`).toBeLessThanOrEqual(0.01)
    expect(probe.animation, `${name} still animates`).toBeLessThanOrEqual(0.01)
  }
})

test('S-008: a control focused with the keyboard shows a focus ring', async ({ page }) => {
  await openApp(page)
  await page.locator('.activity-icon[title="Text Options"]').click()
  await expect(page.locator('.drawer.left.open')).toBeVisible()

  // The third zoom button is never focused, so it is the unmarked comparison.
  const unmarked = await ringOf(page, '.text-options .zoom-btn:nth-child(3)')

  expect(await tabTo(page, '.text-options .zoom-btn')).toBe(true)
  expect(await ringOf(page, '.text-options .zoom-btn:focus')).not.toBe(unmarked)

  expect(await tabTo(page, '.text-options .font-select')).toBe(true)
  expect(await ringOf(page, '.text-options .font-select:focus')).not.toBe(unmarked)
})

test('S-009: a control focused by clicking it shows no focus ring', async ({ page }) => {
  await openApp(page)
  await page.locator('.activity-icon[title="Text Options"]').click()
  await expect(page.locator('.drawer.left.open')).toBeVisible()

  const unmarked = await ringOf(page, '.text-options .zoom-btn:nth-child(3)')

  // The keyboard half first, so a page with no ring anywhere cannot pass this.
  expect(await tabTo(page, '.text-options .zoom-btn')).toBe(true)
  expect(await ringOf(page, '.text-options .zoom-btn:focus')).not.toBe(unmarked)

  // Then the click half: the same kind of control, focused with a mouse.
  await page.locator('.text-options .zoom-btn').first().click()
  expect(await ringOf(page, '.text-options .zoom-btn:focus')).toBe(unmarked)
})
