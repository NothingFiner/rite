import { test, expect } from '@playwright/test'

// Save / Save As end to end (roadmap: document title independence; SPEC.md
// S-016, S-017), in real Chromium.
//
// The unit layer (src/composables/useFileIO.test.js, src/components/StatusBar.spec.js)
// covers the composable and the component in isolation. What only a browser can
// show is that the two are actually WIRED: that a real click on the status bar
// runs the real save path and that the store's new filename reaches the bar the
// writer is looking at.
//
// IPC mocking follows e2e/epub-export.spec.js. Two wrinkles here:
//
//   1. The native save dialog is not `cmd: 'saveDialog'` at the top level.
//      `save()` goes through `invokeTauriCommand`, so `__TAURI_IPC__` sees
//      `cmd: 'tauri'` with the dialog module and request as sibling keys:
//        { cmd: 'tauri', callback, error, __tauriModule: 'Dialog',
//          message: { cmd: 'saveDialog', options } }
//   2. The dialog must answer DIFFERENT paths on the first and the second call
//      (Save, then Save As), so the mock holds a queue and shifts one path per
//      dialog. Each test gets a fresh page, so each test gets a fresh queue.

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
}

/// The status bar's exact-text button. `has-text` would match "Save As" too.
const button = (page, label) => page.locator(`.statusbar button:text-is("${label}")`)

async function savedTo(page, path) {
  await expect
    .poll(
      () => page.evaluate((p) => window.__INVOKED__.some((c) => c.cmd === 'save_document' && c.payload?.path === p), path),
      { timeout: 3000 },
    )
    .toBe(true)
}

test.describe('save and save as', () => {
  test('S-016: saving a new document shows its title and the chosen filename', async ({ page }) => {
    await open(page, ['/tmp/novel.rite'])

    await button(page, 'Save').click()
    await savedTo(page, '/tmp/novel.rite')

    const bar = page.locator('.statusbar')
    // The title comes from the document, the filename from the path the writer
    // chose. Both are visible, and they are not the same string.
    await expect(bar).toContainText('Chapter One')
    await expect(bar).toContainText('novel.rite')
  })

  test('S-017: Save As to a new name changes the filename and leaves the title alone', async ({ page }) => {
    // Save first, so the document has a path and Save As has a filename to
    // start from. Then Save As to a different name.
    await open(page, ['/tmp/novel.rite', '/tmp/renamed.rite'])

    await button(page, 'Save').click()
    await savedTo(page, '/tmp/novel.rite')

    await button(page, 'Save As').click()
    await savedTo(page, '/tmp/renamed.rite')

    const bar = page.locator('.statusbar')
    await expect(bar).toContainText('renamed.rite')
    // The old filename is gone from the bar...
    await expect(bar).not.toContainText('novel.rite')
    // ...and the title did not follow the new filename.
    await expect(bar).toContainText('Chapter One')
  })
})
