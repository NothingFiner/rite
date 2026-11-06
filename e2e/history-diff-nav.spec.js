import { test, expect } from '@playwright/test'
import { emitMenu, installTauriIpc } from './helpers/tauri-ipc.js'

// The history diff's change navigation, end to end (SPEC.md 5.12, S-013 … S-015,
// S-017).
//
// `src/components/DiffView.navigation.spec.js` covers the marking, the counter
// and the ends guards through the component's public data attributes. Those
// sentences run in jsdom, which has no layout, and that file mocks
// `scrollIntoView` to observe it. The sentences here need the real thing: a
// laid-out page, a scrolling ancestor, and key events delivered to `document`.
//
// `diff_against_current` is mocked, so the specs build `SectionDiff` by hand in
// the shape `src-tauri/src/diff.rs` serialises. A block and a paragraph diff
// each carry `type` as their tag. A modified paragraph carries its word spans
// as `{ kind, text }`.

function paragraph(id, text) {
  return {
    id,
    elements: [
      {
        textRun: {
          content: text,
          textStyle: { bold: false, italic: false, underline: false, fontSize: null },
        },
      },
    ],
    leftIndent: null,
    rightIndent: null,
    firstLineIndent: null,
  }
}

const unchangedPara = (id, text) => ({ type: 'unchanged', paragraph: paragraph(id, text) })

const changedPara = (id, before, after) => ({
  type: 'modified',
  old: paragraph(id, before),
  new: paragraph(id, after),
  wordDiff: [
    { kind: 'equal', text: 'The ' },
    { kind: 'removed', text: before },
    { kind: 'added', text: after },
  ],
})

const DOC = {
  title: 'Navigation',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    {
      id: 's-1',
      title: 'Chapter One',
      sectionType: 'chapter',
      hidden: false,
      paragraphs: [paragraph('p-1', 'Alpha body text.')],
    },
  ],
}

const HISTORY_ENTRIES = [{ timestamp: '2026-11-03T21-05-00-000', kind: 'delta', label: 'Autosave' }]

/// Three paragraph edits, so the diff holds the three stops S-013 expects.
function threeChanges() {
  return [
    {
      type: 'modified',
      sectionId: 's-1',
      oldTitle: 'Chapter One',
      newTitle: 'Chapter One',
      oldType: 'chapter',
      newType: 'chapter',
      paragraphDiffs: [
        changedPara('p-1', 'first', 'FIRST'),
        changedPara('p-2', 'second', 'SECOND'),
        changedPara('p-3', 'third', 'THIRD'),
      ],
    },
  ]
}

/// Forty unchanged paragraphs push the second stop below the fold, which S-014
/// needs in order to show that Next scrolls at all.
function twoChangesFarApart() {
  const rows = []
  for (let i = 0; i < 40; i += 1) rows.push(unchangedPara(`lead-${i}`, `Lead paragraph ${i}.`))
  rows.push(changedPara('mid-1', 'deep', 'DEEP'))
  for (let i = 0; i < 40; i += 1) rows.push(unchangedPara(`trail-${i}`, `Trail paragraph ${i}.`))
  rows.push(changedPara('mid-2', 'later', 'LATER'))
  return [
    {
      type: 'modified',
      sectionId: 's-1',
      oldTitle: 'Chapter One',
      newTitle: 'Chapter One',
      oldType: 'chapter',
      newType: 'chapter',
      paragraphDiffs: rows,
    },
  ]
}

/// Opens one version's diff. The version list needs a sidecar path, so the test
/// opens a document before it enters the History view.
async function openVersionDiff(page, diffBlocks) {
  await installTauriIpc(page, { doc: DOC, openPaths: ['/tmp/novel.rite'] })
  await page.addInitScript(
    ({ entries, diff, doc }) => {
      window.__tauriMock.route('open_document', () => doc)
      window.__tauriMock.route('list_history', () => entries)
      window.__tauriMock.route('reconstruct_version', () => doc)
      window.__tauriMock.route('diff_against_current', () => diff)
    },
    { entries: HISTORY_ENTRIES, diff: diffBlocks, doc: DOC }
  )

  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })

  await emitMenu(page, 'open')
  await expect(page.locator('.status-file')).toContainText('novel.rite', { timeout: 5000 })

  await page.click('button.view-tab:has-text("History")')
  await expect(page.locator('.history-view')).toBeVisible({ timeout: 5000 })

  const row = page.locator('.history-row').first()
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()

  const diffButton = page.locator('.history-action.secondary')
  await expect(diffButton).toHaveText('Diff vs current', { timeout: 5000 })
  await diffButton.click()

  await expect(page.locator('.diff-view')).toBeVisible({ timeout: 5000 })
}

const position = (page) => page.locator('.diff-nav-position')

test('S-013: opening a version diff with three changed paragraphs shows "Change 1 of 3"', async ({ page }) => {
  await openVersionDiff(page, threeChanges())

  await expect(position(page)).toHaveText('Change 1 of 3')
  await expect(page.locator('[data-change-index="0"]')).toHaveAttribute('data-current-change', 'true')
})

test('S-014: Next marks the second changed paragraph current and brings it into view', async ({ page }) => {
  await openVersionDiff(page, twoChangesFarApart())

  await expect(position(page)).toHaveText('Change 1 of 2')

  const second = page.locator('[data-change-index="1"]')
  // The second stop sits far below the fold. If it were already on screen, the
  // assertion after Next would pass without any scrolling.
  await expect(second).not.toBeInViewport()

  await page.locator('.diff-nav-next').click()

  await expect(second).toHaveAttribute('data-current-change', 'true')
  await expect(second).toBeInViewport()
  await expect(page.locator('[data-change-index="0"]')).not.toHaveAttribute('data-current-change', 'true')
})

test('S-015: Previous is disabled on the first change and pressing it changes nothing', async ({ page }) => {
  await openVersionDiff(page, threeChanges())

  const previous = page.locator('.diff-nav-prev')
  await expect(previous).toBeDisabled()
  await expect(position(page)).toHaveText('Change 1 of 3')

  // Playwright waits for a disabled button to become enabled, so force the
  // click. The assertion then covers the state that follows the activation.
  await previous.click({ force: true })

  await expect(position(page)).toHaveText('Change 1 of 3')
  await expect(page.locator('[data-change-index="0"]')).toHaveAttribute('data-current-change', 'true')
})

test('S-017: Alt+ArrowDown on a version diff moves the current change forward', async ({ page }) => {
  await openVersionDiff(page, threeChanges())

  await expect(position(page)).toHaveText('Change 1 of 3')

  await page.keyboard.press('Alt+ArrowDown')

  await expect(position(page)).toHaveText('Change 2 of 3')
  await expect(page.locator('[data-change-index="1"]')).toHaveAttribute('data-current-change', 'true')
})
