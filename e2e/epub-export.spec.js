import { test, expect } from '@playwright/test'

// EPUB export reachability (roadmap: EPUB export; SPEC.md S-024), end to end in
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
// IPC mocking follows e2e/focus-mode.spec.js, with one wrinkle: the native save
// dialog does NOT arrive as `cmd: 'saveDialog'` at the top level. dialog.save()
// goes through `invokeTauriCommand`, so `__TAURI_IPC__` sees `cmd: 'tauri'` with
// the dialog module and request spread as SIBLING keys of the request:
//
//   { cmd: 'tauri', callback, error, __tauriModule: 'Dialog',
//     message: { cmd: 'saveDialog', options } }
//
// `invoke(cmd, args)` in @tauri-apps/api 1.6.0 does
// `window.__TAURI_IPC__({ cmd, callback, error, ...args })` (tauri.js:45), so
// command arguments are spread at the TOP LEVEL — there is no `payload` key.
// Mirroring that here (destructure the envelope, keep the rest as the payload)
// is what makes `export_epub`'s own args observable below.

function installIpcMock(page, savedPath) {
  return page.addInitScript((path) => {
    const style = { bold: false, italic: false, underline: false, fontSize: null }
    const doc = {
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

    window.__INVOKED__ = []
    window.__TAURI_IPC__ = (req) => {
      const ok = (r) => setTimeout(() => window['_' + req.callback](r), 0)
      // The envelope keys are protocol plumbing; everything else is the command's
      // own args (Tauri v1 spreads them at the top level — see the header).
      const { cmd, callback: _cb, error: _err, ...payload } = req
      window.__INVOKED__.push({ cmd, payload })
      try {
        // The native save dialog: `invoke('tauri', { __tauriModule: 'Dialog', message })`.
        if (req.cmd === 'tauri' && req.__tauriModule === 'Dialog' && req.message?.cmd === 'saveDialog') {
          return ok(path)
        }
        // The app listens for the menu event through the Event module.
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
  }, savedPath)
}

test.describe('epub export', () => {
  test('S-023: a menu event exports the document as .epub', async ({ page }) => {
    await installIpcMock(page, '/tmp/novel.epub')
    await page.goto('/')
    await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })

    await expect
      .poll(() => page.evaluate(() => typeof window.__emitMenu), { timeout: 3000 })
      .toBe('function')

    await page.evaluate(() => window.__emitMenu('export_epub'))

    await expect
      .poll(
        () => page.evaluate(() => window.__INVOKED__.some((c) => c.cmd === 'export_epub')),
        { timeout: 3000 },
      )
      .toBe(true)

    const call = await page.evaluate(() => window.__INVOKED__.find((c) => c.cmd === 'export_epub'))
    expect(call.payload).toEqual({ path: '/tmp/novel.epub' })
  })
})
