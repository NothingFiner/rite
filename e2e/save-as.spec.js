import { test, expect } from '@playwright/test'
import { emitMenu, installTauriIpc, ipcCalls, waitForMenuListener } from './helpers/tauri-ipc.js'

// Save / Save As end to end (SPEC.md S-022, S-024), in real Chromium.
//
// MIGRATED: this file used to click the status bar's Save and Save As buttons.
// The native-menu feature removes those buttons, and Playwright cannot click a
// native menu, so each test dispatches the same `menu` window event Rust emits.
// Every assertion is unchanged — the save path still runs for real and the
// store's filename still has to reach the bar the writer is looking at.
//
// IPC is the shared mock (./helpers/tauri-ipc.js). Two things it already does
// for this spec:
//
//   1. The native save dialog arrives as a `tauri`/`Dialog` module call, not as
//      a top-level `saveDialog` command. `dialogPaths` is a QUEUE: Save then
//      Save As must get DIFFERENT paths, and each test gets a fresh queue.
//   2. `listen('menu', …)` is captured, so `emitMenu` can deliver the event.

const seededDoc = {
  title: 'Chapter One',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    {
      id: 's-0',
      title: 'Chapter One',
      sectionType: 'chapter',
      hidden: false,
      paragraphs: [
        {
          id: 'p-0',
          elements: [
            {
              textRun: {
                content: 'A short paragraph long enough to click on.',
                textStyle: { bold: false, italic: false, underline: false, fontSize: null },
              },
            },
          ],
          leftIndent: null,
          rightIndent: null,
          firstLineIndent: null,
        },
      ],
    },
  ],
}

function installIpcMock(page, dialogPaths) {
  return installTauriIpc(page, { doc: seededDoc, dialogPaths })
}

async function open(page, dialogPaths) {
  await installIpcMock(page, dialogPaths)
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
  await waitForMenuListener(page)
}

async function savedTo(page, path) {
  await expect
    .poll(
      async () => {
        const calls = await ipcCalls(page)
        return calls.some((call) => call.cmd === 'save_document' && call.args?.path === path)
      },
      { timeout: 3000 },
    )
    .toBe(true)
}

test.describe('save and save as', () => {
  test('S-022: a menu event with id save should save the document with no button clicked', async ({ page }) => {
    await open(page, ['/tmp/novel.rite'])

    await emitMenu(page, 'save')
    await savedTo(page, '/tmp/novel.rite')

    const bar = page.locator('.statusbar')
    // The title comes from the document, the filename from the path the writer
    // chose. Both are visible, and they are not the same string.
    await expect(bar).toContainText('Chapter One')
    await expect(bar).toContainText('novel.rite')
  })

  test('S-024: a menu event with id save_as should write to the chosen path and keep the title', async ({ page }) => {
    // Save first, so the document has a path and Save As has a filename to
    // start from. Then Save As to a different name.
    await open(page, ['/tmp/novel.rite', '/tmp/renamed.rite'])

    await emitMenu(page, 'save')
    await savedTo(page, '/tmp/novel.rite')

    await emitMenu(page, 'save_as')
    await savedTo(page, '/tmp/renamed.rite')

    const bar = page.locator('.statusbar')
    await expect(bar).toContainText('renamed.rite')
    // The old filename is gone from the bar...
    await expect(bar).not.toContainText('novel.rite')
    // ...and the title did not follow the new filename.
    await expect(bar).toContainText('Chapter One')
  })
})
