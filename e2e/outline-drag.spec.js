import { test, expect } from '@playwright/test'

// Drag-reorder e2e (roadmap 5.5). jsdom can't exercise the drag handlers'
// dataTransfer contract (no DataTransfer), so this drives the REAL
// Chromium drag-event machinery end-to-end: dragstart → dragover → drop →
// invoke('move_section') → store reassign → drawer re-renders. The harness
// runs pure Vite with no Tauri runtime, so `move_section` is served by an
// IPC mock that mirrors the real command's contract: given
// { id, toAfterId } it returns the document with the section moved
// (after `toAfterId`, null = front) — exactly what the Rust command does.
// The WKWebView-specific quirk this guards against (a dragstart that sets
// no data gets cancelled) is covered by the unit spec's mock-dataTransfer
// test; Chromium's real DataTransfer proves the payload calls actually work.

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
  hasEpigram: false,
  epigramText: '',
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
  await page.click('button[title="Sections"]')
  await page.waitForSelector('.drawer.left.open .nav-section')
  const rows = page.locator('.drawer.left.open .nav-section')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('One')
  await expect(rows.nth(1)).toContainText('Two')

  // Drag "One" (row 0) onto the LOWER half of "Two" (row 1) → One after Two.
  // Pointer coordinates come from the rows' REAL bounding boxes: the
  // component targets by geometry (clientX within the list, clientY vs each
  // row's rect), so a 75%-depth point in row 1 makes dropHalf deterministically
  // pick 'after'. And per the WKWebView misroute this guards against, the
  // dragover/drop are deliberately dispatched on ROW 0's element with row 1's
  // coordinates — the target must follow the POINTER, not the event's target.
  // Synthetic drag events (real DataTransfer in Chromium).
  const row0box = await rows.nth(0).boundingBox()
  const row1box = await rows.nth(1).boundingBox()
  const pointer = {
    clientX: row1box.x + row1box.width / 2,
    clientY: row1box.y + row1box.height * 0.75,
  }
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  const dispatchDrag = (index, type, at) =>
    rows.nth(index).evaluate((el, { type, at, dataTransfer }) => {
      el.dispatchEvent(new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: at.clientX,
        clientY: at.clientY,
        dataTransfer,
      }))
    }, { type, at, dataTransfer })

  await dispatchDrag(0, 'dragstart', { clientX: row0box.x + 10, clientY: row0box.y + 5 })
  await dispatchDrag(0, 'dragover', pointer)
  // The insertion line renders below the GEOMETRY-targeted row while dragging.
  await expect(rows.nth(1)).toHaveClass(/drop-below/)
  await dispatchDrag(0, 'drop', pointer)

  // The store invoked move_section (mocked) and assigned the returned doc:
  // the drawer re-renders as Two, One, Three.
  await expect(rows.nth(0)).toContainText('Two')
  await expect(rows.nth(1)).toContainText('One')
  await expect(rows.nth(2)).toContainText('Three')

  // And the drag state cleared (no lingering insertion line / dimmed row).
  await expect(rows.nth(0)).not.toHaveClass(/dragging/)
  await expect(rows.nth(1)).not.toHaveClass(/drop-below/)
})