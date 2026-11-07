import { test, expect } from '@playwright/test'
import { emitMenu, installTauriIpc } from './helpers/tauri-ipc.js'

// Keyboard navigation across the app chrome (SPEC.md S-004 … S-019, roadmap 5.7).
//
// These sentences are about real key presses and where focus lands, which jsdom
// cannot see: the unit specs next door cover roles, names and current-item
// marking. Both are needed — a control can be perfectly labelled and still be
// unreachable, or reachable and unlabelled.
//
// The three-section document exists so the section list has more than one row to
// move between: an arrow-key test on a single row would pass vacuously.

function section(id, title, body) {
  return {
    id,
    title,
    sectionType: 'chapter',
    hidden: false,
    paragraphs: [
      {
        id: `${id}-p`,
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
      },
    ],
  }
}

const DOC = {
  title: 'Keyboard',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    section('s-1', 'Chapter One', 'Alpha body text.'),
    section('s-2', 'Chapter Two', 'Bravo body text.'),
    section('s-3', 'Chapter Three', 'Charlie body text.'),
  ],
}

const FIRST = 's-1'
const LAST = 's-3'

const HISTORY_ENTRIES = [
  { timestamp: '2026-11-02T18-40-00-000', kind: 'delta', label: 'Autosave' },
  { timestamp: '2026-11-03T21-05-00-000', kind: 'delta', label: 'Autosave' },
]

async function openApp(page, options = {}) {
  await installTauriIpc(page, { doc: DOC, ...options })
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
}

async function openSectionsDrawer(page) {
  const button = page.locator('.activity-icon[title="Sections"]')
  await expect(button).toBeVisible({ timeout: 5000 })
  await button.click()
  await expect(page.locator('.drawer.left.open')).toBeVisible({ timeout: 5000 })
}

/** The section id of the focused row, or null when focus is not on a row. */
function focusedNavId(page) {
  return page.evaluate(() => {
    const active = document.activeElement
    const row = active && active.closest ? active.closest('[data-nav-id]') : null
    return row ? row.getAttribute('data-nav-id') : null
  })
}

/** The section id currently marked as selected, or null. */
function currentNavId(page) {
  return page.evaluate(() => {
    const row = document.querySelector('[data-nav-id][aria-current="true"]')
    return row ? row.getAttribute('data-nav-id') : null
  })
}

/** Arrow to a row that is not the selected one, so Enter has something to change. */
async function focusRowOtherThanCurrent(page) {
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('ArrowDown')
    const focused = await focusedNavId(page)
    if (focused && focused !== (await currentNavId(page))) return focused
  }
  return focusedNavId(page)
}

// --- section rows ------------------------------------------------------------

test('S-004: Enter on a focused section row selects that section', async ({ page }) => {
  await openApp(page)
  await openSectionsDrawer(page)

  const target = await focusRowOtherThanCurrent(page)
  expect(target, 'no section row took keyboard focus').not.toBeNull()
  expect(await currentNavId(page)).not.toBe(target)

  await page.keyboard.press('Enter')

  await expect
    .poll(() => currentNavId(page), { timeout: 3000 })
    .toBe(target)
})

test('S-005: Space on a focused section row selects it and does not scroll the page', async ({ page }) => {
  await openApp(page)
  await openSectionsDrawer(page)

  const target = await focusRowOtherThanCurrent(page)
  expect(target, 'no section row took keyboard focus').not.toBeNull()

  const before = await page.evaluate(() => ({
    page: document.scrollingElement ? document.scrollingElement.scrollTop : 0,
    layer: document.querySelector('.scroll-layer')?.scrollTop ?? 0,
  }))

  await page.keyboard.press('Space')

  await expect
    .poll(() => currentNavId(page), { timeout: 3000 })
    .toBe(target)

  const after = await page.evaluate(() => ({
    page: document.scrollingElement ? document.scrollingElement.scrollTop : 0,
    layer: document.querySelector('.scroll-layer')?.scrollTop ?? 0,
  }))
  expect(after).toEqual(before)
})

test('S-006: arrows move focus between rows without selecting, and stop at the ends', async ({ page }) => {
  await openApp(page)
  await openSectionsDrawer(page)

  const selectedBefore = await currentNavId(page)
  const first = await focusedNavId(page)
  expect(first, 'the drawer did not take focus').not.toBeNull()

  await page.keyboard.press('ArrowDown')
  const second = await focusedNavId(page)
  expect(second, 'ArrowDown did not move focus').not.toBe(first)
  // Moving focus must not select: only Enter/Space do.
  expect(await currentNavId(page)).toBe(selectedBefore)

  // Bottom stop: extra presses cannot walk focus out of the list.
  for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowDown')
  expect(await focusedNavId(page)).toBe(LAST)

  // Top stop.
  for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowUp')
  expect(await focusedNavId(page)).toBe(FIRST)
})

// --- history entries ---------------------------------------------------------

test('S-009: Enter on a focused history entry loads that version into the preview', async ({ page }) => {
  await installTauriIpc(page, { doc: DOC, openPaths: ['/tmp/novel.rite'] })
  await page.addInitScript(({ entries, doc }) => {
    window.__tauriMock.route('open_document', () => doc)
    window.__tauriMock.route('list_history', () => entries)
    window.__tauriMock.route('reconstruct_version', () => doc)
  }, { entries: HISTORY_ENTRIES, doc: DOC })

  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })

  // The version list needs a document that has a sidecar location, or it shows
  // its "save the document first" prompt instead of rows. Opening one gives the
  // store a lastPath.
  await emitMenu(page, 'open')
  await expect(page.locator('.status-file')).toContainText('novel.rite', { timeout: 5000 })

  await page.click('button.view-tab:has-text("History")')
  await expect(page.locator('.history-view')).toBeVisible({ timeout: 5000 })
  // Entering the History view opens the version list itself (Scheme A); the
  // in-header toggle would close it.
  await expect(page.locator('.drawer.left.open')).toBeVisible({ timeout: 5000 })

  const rows = page.locator('.history-row')
  await expect(rows).toHaveCount(HISTORY_ENTRIES.length, { timeout: 5000 })

  const entry = rows.first()
  await entry.focus()
  await page.keyboard.press('Enter')

  await expect(page.locator('.history-preview')).toContainText('Alpha body text.', {
    timeout: 5000,
  })
})

// --- focus movement ----------------------------------------------------------

test('S-016: opening the sections drawer focuses its active row', async ({ page }) => {
  await openApp(page)
  await openSectionsDrawer(page)

  const focused = await focusedNavId(page)
  expect(focused, 'opening the drawer did not move focus into it').not.toBeNull()

  const current = await currentNavId(page)
  // With no section marked current, the first row is the landing point.
  expect(focused).toBe(current ?? FIRST)
})

test('S-017: Escape that closes a drawer returns focus to the button that opened it', async ({ page }) => {
  await openApp(page)
  await openSectionsDrawer(page)

  // The keyboard user must be inside the drawer for "return" to mean anything;
  // without this the test would pass on a click that simply never moved focus.
  expect(
    await page.evaluate(() => !!document.activeElement?.closest?.('.drawer')),
    'opening the drawer did not move focus into it'
  ).toBe(true)

  await page.keyboard.press('Escape')
  await expect(page.locator('.drawer.left.open')).toHaveCount(0)

  await expect(page.locator('.activity-icon[title="Sections"]')).toBeFocused()
})

test('S-018: Tab from the last control in an open drawer moves out; the drawer does not trap focus', async ({ page }) => {
  await openApp(page)
  await openSectionsDrawer(page)

  // The keyboard user is inside the drawer to begin with…
  expect(
    await page.evaluate(() => !!document.activeElement?.closest?.('.drawer')),
    'opening the drawer did not move focus into it'
  ).toBe(true)

  // …and Tab from the drawer's last control must leave it.
  await page.evaluate(() => {
    const drawer = document.querySelector('.drawer.left.open')
    const controls = drawer.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    controls[controls.length - 1].focus()
  })
  await page.keyboard.press('Tab')

  expect(
    await page.evaluate(() => !!document.activeElement?.closest?.('.drawer')),
    'focus was trapped inside the drawer'
  ).toBe(false)
})

test('S-019: a control reached with the keyboard shows a visible focus indicator', async ({ page }) => {
  await openApp(page)
  await page.locator('.activity-icon[title="Text Options"]').click()
  await expect(page.locator('.drawer.left.open')).toBeVisible({ timeout: 5000 })

  // Walk in with real Tab presses: the last zoom button, then the font select.
  // A select is a control the browser focuses itself, so the indicator below is
  // measured on a focused control and not on an unfocusable div.
  await page.locator('.text-options .zoom-btn').last().focus()
  await page.keyboard.press('Tab')

  const indicator = await page.evaluate(() => {
    const active = document.activeElement
    if (!active || active === document.body) return { focused: false }
    const probe = document.createElement('div')
    probe.style.borderColor = getComputedStyle(document.querySelector('.app-container'))
      .getPropertyValue('--accent')
    document.body.appendChild(probe)
    const accent = getComputedStyle(probe).borderColor
    probe.remove()
    return {
      focused: active.classList.contains('font-select'),
      border: getComputedStyle(active).borderColor,
      accent,
    }
  })
  expect(indicator.focused, 'the font select did not take keyboard focus').toBe(true)
  expect(indicator.border, 'the focused control has no visible border change').toBe(indicator.accent)
})
