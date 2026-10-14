import { test, expect } from '@playwright/test'

// Drag-reorder e2e (roadmap 5.5). Drives the REAL pointer-input machinery
// end-to-end with Playwright's mouse API (pointerdown → 4px threshold →
// pointermove → pointerup) → invoke('move_section') → store reassign →
// drawer re-renders. The harness runs pure Vite with no Tauri runtime, so
// `move_section` is served by an IPC mock that mirrors the real command's
// contract: given { id, toAfterId } it returns the document with the
// section moved (after `toAfterId`, null = front) — exactly what the Rust
// command does. The component uses a CUSTOM pointer drag (not native HTML5
// DnD) because WKWebView misroutes drag-session events; unit-spec coverage
// of the gesture lives in NavigationDrawer.spec.js, this proves the whole
// chain in a real browser.

function makeParagraph(id, content) {
  return {
    id,
    elements: [{ textRun: { content, textStyle: {} } }],
    leftIndent: null,
    rightIndent: null,
    firstLineIndent: null,
  }
}

function makeSection(id, title) {
  return {
    id,
    title,
    sectionType: 'section',
    paragraphs: [makeParagraph(id + '-p1', 'Text of ' + title)],
  }
}

const initialDoc = {
  title: 'Drag Test',
  author: 'A',
  authorContact: '',
  hasTOC: false,
  sections: [makeSection('s1', 'One'), makeSection('s2', 'Two'), makeSection('s3', 'Three')],
}

// The mock mirrors the real Rust command's contract: { id, toAfterId } (the
// camelCase wire names Tauri v1 converts to to_after_id server-side) → the
// document with the section moved after toAfterId (null = front).
function installIpcMock(page) {
  return page.addInitScript((doc) => {
    window.__TAURI_IPC__ = (req) => {
      const ok = (r) => setTimeout(() => window['_' + req.callback](r), 0)
      const fail = (e) => setTimeout(() => window['_' + req.error](e), 0)
      try {
        if (req.cmd === 'get_document') return ok(doc)
        if (req.cmd === 'list_roles') return ok([])
        if (req.cmd === 'move_section') {
          // Tauri v1 spreads invoke args onto the IPC request — read both
          // shapes defensively (same pattern as search-highlight.spec.js).
          const arg = (name) =>
            req.args && req.args[name] !== undefined ? req.args[name] : req[name]
          const id = arg('id')
          const toAfterId = arg('toAfterId')
          const moved = doc.sections.find((s) => s.id === id)
          if (!moved) return fail({ message: 'MoveSection: section not found' })
          const rest = doc.sections.filter((s) => s.id !== id)
          const updated =
            toAfterId === null
              ? [moved, ...rest]
              : rest.flatMap((s) => (s.id === toAfterId ? [s, moved] : [s]))
          doc = { ...doc, sections: updated }
          return ok(doc)
        }
        return ok(null)
      } catch (e) {
        fail({ message: String(e) })
      }
    }
  }, initialDoc)
}

test('outline drag-reorder moves a section via move_section', async ({ page }) => {
  await installIpcMock(page)
  page.on('console', msg => { if (msg.type() === 'error') console.log('[browser error]', msg.text()) })
  await page.goto('/')
  await page.waitForSelector('.editor-sheet', { timeout: 5000 })

  // Open the Sections drawer and confirm the three rows in initial order.
  // The drawer SLIDES open (transform transition, 250ms) and real mouse
  // input needs its final geometry — waitForSelector succeeds the moment
  // .open is set, so let the transition finish before measuring boxes.
  await page.click('button[title="Sections"]')
  await page.waitForSelector('.drawer.left.open .nav-section')
  await page.waitForTimeout(350)
  const rows = page.locator('.drawer.left.open .nav-section')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('One')
  await expect(rows.nth(1)).toContainText('Two')

  // Drag "One" (row 0) onto the LOWER half of "Two" (row 1) → One after Two.
  // REAL trusted pointer input through the actual gesture: press on the
  // title area (clear of the row's buttons), move past the 4px threshold,
  // over the target row, release. No synthetic events — this exercises the
  // same pointerdown/pointermove/pointerup chain WKWebView will run, which
  // is the whole point of the custom pointer-drag (native HTML5 DnD was
  // abandoned after two rounds of WKWebView drag-session misrouting).
  const row0 = await rows.nth(0).boundingBox()
  const row1 = await rows.nth(1).boundingBox()
  const press = { x: row0.x + row0.width * 0.2, y: row0.y + row0.height / 2 }
  const drop = { x: row1.x + row1.width * 0.2, y: row1.y + row1.height * 0.75 }
  await page.mouse.move(press.x, press.y)
  await page.mouse.down()
  // Cross the threshold straight up (off the row, onto the heading area),
  // then over the target — the same two-phase shape a human drag has.
  await page.mouse.move(press.x, press.y - 10, { steps: 2 })
  await page.mouse.move(drop.x, drop.y, { steps: 5 })
  // While dragging: source row dimmed, insertion line below the target row,
  // and the ghost pill follows the pointer.
  await expect(rows.nth(0)).toHaveClass(/dragging/)
  await expect(rows.nth(1)).toHaveClass(/drop-below/)
  await expect(page.locator('.nav-drag-ghost')).toBeVisible()
  await page.mouse.up()

  // The store invoked move_section (mocked) and assigned the returned doc:
  // the drawer re-renders as Two, One, Three.
  await expect(rows.nth(0)).toContainText('Two')
  await expect(rows.nth(1)).toContainText('One')
  await expect(rows.nth(2)).toContainText('Three')

  // And the drag state cleared (no lingering insertion line / dimmed row /
  // ghost). The click that follows the pointerup must be swallowed — the
  // dragged section is not selected.
  await expect(rows.nth(0)).not.toHaveClass(/dragging/)
  await expect(rows.nth(1)).not.toHaveClass(/drop-below/)
  await expect(page.locator('.nav-drag-ghost')).toHaveCount(0)
})