import { test, expect } from '@playwright/test'
import {
  emitMenu,
  envelope,
  installTauriIpc,
  ipcCalls,
} from './helpers/tauri-ipc.js'

// Tauri v2 migration, end to end (SPEC.md S-019, S-021, S-022).
//
// These do not test the migration's config (unit) or its Rust (cargo); they test
// the two things only a real browser can answer: that the app speaks the v2
// promise envelope at all, and that the migrated imports still reach it, so a
// menu-driven save and an open → edit → save round trip behave exactly as they
// did on v1.
//
// Red before the migration, for the right reason: on v1 the app calls the
// callback envelope, so `envelope()` reports no v2 invoke and the mock records no
// commands.

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

async function open(page, options = {}) {
  await installTauriIpc(page, { doc: seededDoc, ...options })
  await page.goto('/')

  // These two polls are assertions, not waits: if the app is still on the v1
  // envelope, nothing reaches the mock and this fails as an assertion instead of
  // a bare selector timeout that hides *why*.
  await expect
    .poll(
      async () => (await ipcCalls(page)).some((call) => call.cmd === 'get_document'),
      { timeout: 5000 },
    )
    .toBe(true)
  await expect
    .poll(() => page.evaluate(() => window.__tauriMock.hasMenuListener()), { timeout: 5000 })
    .toBe(true)

  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
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

test.describe('tauri v2 envelope', () => {
  test('S-019: the app runs against the v2 promise envelope and its startup commands reach the mock', async ({
    page,
  }) => {
    await open(page)

    const shape = await envelope(page)
    expect(shape.hasInvoke, 'the page has no v2 invoke — the IPC mock did not install, or ' +
      'the app is still on the v1 envelope').toBe(true)
    expect(shape.hasTransformCallback, 'listen() needs transformCallback to mint a handler id').toBe(
      true,
    )

    // The proof that the app itself (not just the mock) speaks v2: its startup
    // `get_document` arrives at the mock through the promise envelope.
    const calls = await ipcCalls(page)
    expect(calls.map((call) => call.cmd)).toContain('get_document')
  })

  test('S-021: a save_as menu event uses the v2 dialog plugin and keeps the title', async ({
    page,
  }) => {
    await open(page, { dialogPaths: ['/tmp/novel.rite', '/tmp/renamed.rite'] })

    await emitMenu(page, 'save')
    await savedTo(page, '/tmp/novel.rite')

    await emitMenu(page, 'save_as')
    await savedTo(page, '/tmp/renamed.rite')

    // The dialog went through `plugin:dialog|save` — i.e. the migrated import
    // reached the plugin, not a leftover v1 dialog module.
    const calls = await ipcCalls(page)
    expect(calls.some((call) => call.cmd === 'plugin:dialog|save')).toBe(true)

    const bar = page.locator('.statusbar')
    await expect(bar).toContainText('renamed.rite')
    await expect(bar).toContainText('Chapter One')
  })

  test('S-022: an open, edit and save round trip surfaces no IPC error', async ({ page }) => {
    const consoleErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(String(error)))

    await open(page, { dialogPaths: ['/tmp/round-trip.rite'] })

    // Edit: click into the paragraph and type, so the document is modified and
    // the save is a real write rather than a no-op.
    const paragraph = page.locator('.editor-sheet .paragraph').first()
    await paragraph.click()
    await page.keyboard.type(' edited')
    await expect(paragraph).toContainText('edited')

    await emitMenu(page, 'save')
    await savedTo(page, '/tmp/round-trip.rite')

    // Nothing rejected: no error toast, and no console error about invoking.
    await expect(page.locator('.toast-error')).toHaveCount(0)
    const ipcErrors = consoleErrors.filter((text) =>
      /invoke|IPC|not allowed|permission|__TAURI/i.test(text),
    )
    expect(ipcErrors, `the migrated invoke path reported: ${ipcErrors.join(' | ')}`).toEqual([])
  })
})
