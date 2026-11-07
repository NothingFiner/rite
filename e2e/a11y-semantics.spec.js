import { test, expect } from '@playwright/test'
import { installTauriIpc } from './helpers/tauri-ipc.js'

// Editor and view-tab semantics (SPEC.md 5.7a, S-001, S-002 and S-007), in real
// Chromium.
//
// The unit layer (src/components/Toolbar.spec.js and ActivityBar.spec.js) covers
// the tablist's tab stops and the icon names in isolation. What only a real page
// can show is the accessibility tree the webview builds from those attributes,
// and that an arrow key actually swaps the view on screen.
//
// Tauri IPC is the shared mock from ./helpers/tauri-ipc.js, seeded with a short
// document so the editor sheet is rendered at load.

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
  title: 'Semantics',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    {
      id: 's-1',
      title: 'Chapter One',
      sectionType: 'chapter',
      hidden: false,
      paragraphs: [paragraph('s-1-p1', 'The kettle had not boiled yet.')],
    },
  ],
}

const tabs = (page) => page.locator('.view-tabs .view-tab')
const selectedTab = (page) => page.locator('.view-tabs .view-tab[aria-selected="true"]')

async function openApp(page) {
  await installTauriIpc(page, { doc: DOC })
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
}

test('S-001: the editor sheet is a multiline textbox', async ({ page }) => {
  await openApp(page)

  const sheet = page.locator('.editor-sheet')
  await expect(sheet).toHaveAttribute('role', 'textbox')
  await expect(sheet).toHaveAttribute('aria-multiline', 'true')
  await expect(sheet).toHaveAttribute('contenteditable', 'true')
})

test('S-002: the editor sheet is named Manuscript', async ({ page }) => {
  await openApp(page)

  const textbox = page.getByRole('textbox', { name: 'Manuscript' })
  await expect(textbox).toBeVisible()
  await expect(textbox).toHaveClass(/editor-sheet/)
})

test('S-007: Tab reaches the tablist once and the arrows switch the view', async ({ page }) => {
  await openApp(page)

  // One tab stop means the tablist is entered once. The unit layer pins which
  // tab carries it, so here it only has to be the selected one.
  await expect(page.locator('.view-tabs .view-tab[tabindex="0"]')).toHaveCount(1)
  await expect(selectedTab(page)).toHaveText('Editor')

  await selectedTab(page).focus()
  await page.keyboard.press('ArrowRight')

  await expect(selectedTab(page)).toHaveText('Manuscript')
  await expect(tabs(page).nth(1)).toBeFocused()
  await expect(page.locator('.editor-wrapper.mode-manuscript')).toBeVisible()

  // Tab from the selected tab leaves the tablist instead of stopping on the next
  // tab, which is what one tab stop means in a real page.
  await page.keyboard.press('Tab')
  await expect(tabs(page).nth(1)).not.toBeFocused()

  await tabs(page).nth(1).focus()
  await page.keyboard.press('End')

  await expect(selectedTab(page)).toHaveText('History')
  await expect(tabs(page).nth(2)).toBeFocused()
})
