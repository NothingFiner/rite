import { test, expect } from '@playwright/test'

// Save / Save As end to end (SPEC.md S-022, S-024), in real Chromium.
//
// MIGRATED: this file used to click the status bar's Save and Save As buttons.
// The native-menu feature removes those buttons, and Playwright cannot click a
// native menu, so each test dispatches the same `menu` window event Rust emits.
// Every assertion is unchanged — the save path still runs for real and the
// store's filename still has to reach the bar the writer is looking at.
//
// IPC mocking follows e2e/epub-export.spec.js. Three wrinkles here:
//
//   1. The native save dialog is not `cmd: 'saveDialog'` at the top level.
//      `save()` goes through `invokeTauriCommand`, so `__TAURI_IPC__` sees
//      `cmd: 'tauri'` with the dialog module and request as sibling keys:
//        { cmd: 'tauri', callback, error, __tauriModule: 'Dialog',
//          message: { cmd: 'saveDialog', options } }
//   2. The dialog must answer DIFFERENT paths on the first and the second call
//      (Save, then Save As), so the mock holds a queue and shifts one path per
//      dialog. Each test gets a fresh page, so each test gets a fresh queue.
//   3. `listen('menu', …)` arrives as `__tauriModule: 'Event'` with
//      `message.cmd: 'listen'` and the transformed callback id. The mock stores
//      it and exposes `window.__emitMenu(id)`.

function installIpcMock(page, dialogPaths) {
  return page.addInitScript((paths) => {
    const style = { bold: false, italic: false, underline: false, fontSize: null }
    const doc = {
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
                    textStyle: style,
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

    const queue = paths.slice()
    window.__INVOKED__ = []
    window.__TAURI_IPC__ = (req) => {
      const ok = (r) => setTimeout(() => window['_' + req.callback](r), 0)
      // The envelope keys are protocol plumbing; everything else is the command's
      // own args (Tauri v1 spreads them at the top level).
      const { cmd, callback: _cb, error: _err, ...payload } = req
      window.__INVOKED__.push({ cmd, payload })
      try {
        if (
          req.cmd === 'tauri' &&
          req.__tauriModule === 'Dialog' &&
          req.message?.cmd === 'saveDialog'
        ) {
          return ok(queue.length ? queue.shift() : null)
        }
        if (req.cmd === 'tauri' && req.__tauriModule === 'Event' && req.message?.cmd === 'listen') {
          if (req.message.event === 'menu') {
            window.__emitMenu = (itemId) =>
              window['_' + req.message.handler]({ event: 'menu', id: 1, payload: itemId })
          }
          return ok(1)
        }
        if (req.cmd === 'get_document') return ok(doc)
        if (req.cmd === 'list_roles') return ok([])
        return ok(null)
      } catch (e) {
        setTimeout(() => window['_' + req.error]({ message: String(e) }), 0)
      }
    }
  }, dialogPaths)
}

async function open(page, dialogPaths) {
  await installIpcMock(page, dialogPaths)
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
  await expect
    .poll(() => page.evaluate(() => typeof window.__emitMenu), { timeout: 3000 })
    .toBe('function')
}

async function savedTo(page, path) {
  await expect
    .poll(
      () => page.evaluate((p) => window.__INVOKED__.some((c) => c.cmd === 'save_document' && c.payload?.path === p), path),
      { timeout: 3000 },
    )
    .toBe(true)
}

test.describe('save and save as', () => {
  test('S-022: a menu event with id save should save the document with no button clicked', async ({ page }) => {
    await open(page, ['/tmp/novel.rite'])

    await page.evaluate(() => window.__emitMenu('save'))
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

    await page.evaluate(() => window.__emitMenu('save'))
    await savedTo(page, '/tmp/novel.rite')

    await page.evaluate(() => window.__emitMenu('save_as'))
    await savedTo(page, '/tmp/renamed.rite')

    const bar = page.locator('.statusbar')
    await expect(bar).toContainText('renamed.rite')
    // The old filename is gone from the bar...
    await expect(bar).not.toContainText('novel.rite')
    // ...and the title did not follow the new filename.
    await expect(bar).toContainText('Chapter One')
  })
})
