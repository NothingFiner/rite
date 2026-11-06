import { test, expect } from '@playwright/test'
import { emitMenu, installTauriIpc, ipcCalls } from './helpers/tauri-ipc.js'

// EPUB export reachability (roadmap: EPUB export; SPEC.md S-023), end to end in
// real Chromium.
//
// The Rust exporter itself is covered by src-tauri/tests/epub_export.rs — jsdom
// and a mocked IPC layer cannot see the bytes. What only a real browser can show
// is that the menu event walks the whole chain: save dialog -> invoke('export_epub')
// with the chosen path.
//
// MIGRATED (SPEC.md S-023): this test used to click the status bar's Export
// button, which the native-menu feature removes. Playwright cannot click a native
// menu, so it dispatches the same `menu` window event Rust emits. The assertions
// are unchanged.
//
// IPC is the shared mock (./helpers/tauri-ipc.js), which already answers the
// native save dialog (a `tauri`/Dialog module call, NOT a top-level `saveDialog`
// command) and captures the Event-module `listen` so `emitMenu` can reach the
// app. `dialogPaths` holds the path the dialog returns.

const seededDoc = {
  title: 'Untitled',
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

function installIpcMock(page, savedPath) {
  return installTauriIpc(page, { doc: seededDoc, dialogPaths: [savedPath] })
}

test.describe('epub export', () => {
  test('S-023: a menu event exports the document as .epub', async ({ page }) => {
    await installIpcMock(page, '/tmp/novel.epub')
    await page.goto('/')
    await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })

    await emitMenu(page, 'export_epub')

    await expect
      .poll(
        async () => (await ipcCalls(page)).some((call) => call.cmd === 'export_epub'),
        { timeout: 3000 },
      )
      .toBe(true)

    const calls = await ipcCalls(page)
    const call = calls.find((c) => c.cmd === 'export_epub')
    expect(call.args).toEqual({ path: '/tmp/novel.epub' })
  })
})
