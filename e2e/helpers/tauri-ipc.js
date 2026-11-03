// Shared Tauri v1 IPC mocking for Playwright.
//
// The harness runs plain Vite with no Tauri runtime, so every spec that needs a
// backend mocks `window.__TAURI_IPC__`. The envelope (callback ids, argument
// spreading, the Dialog and Event modules) lives once in
// ./tauri-ipc.mock.js; this module is the Node-side half that injects it.
//
// Do not hand-roll `window.__TAURI_IPC__` in a spec: `e2e/conventions.spec.js`
// fails the suite if any spec references it. Register a route instead.

import { fileURLToPath } from 'node:url'

const MOCK_SCRIPT = fileURLToPath(new URL('./tauri-ipc.mock.js', import.meta.url))

/**
 * Install the shared IPC mock before the app loads.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ doc?: object, docFails?: boolean, dialogPaths?: string[] }} [options]
 *   Defaults the mock answers: the seeded document returned by `get_document`,
 *   whether `get_document` rejects instead, and the paths the native save
 *   dialog returns in order (one per dialog).
 * @returns {Promise<void>}
 */
export async function installTauriIpc(page, options = {}) {
  await page.addInitScript({ path: MOCK_SCRIPT })
  await page.addInitScript((opts) => window.__tauriMock.configure(opts), options)
}

/**
 * Wait until the app has subscribed to its `menu` window event.
 *
 * The listener is installed from a Vue `onMounted` hook, so it lands a tick
 * after the first paint. Emitting before that silently does nothing.
 */
export async function waitForMenuListener(page) {
  await page.waitForFunction(() => window.__tauriMock.hasMenuListener(), null, { timeout: 3000 })
}

/** Dispatch a `menu` event carrying `itemId`, as the Rust menu does. */
export async function emitMenu(page, itemId) {
  await waitForMenuListener(page)
  const delivered = await page.evaluate((id) => window.__tauriMock.emitMenu(id), itemId)
  if (!delivered) throw new Error(`no menu listener registered for "${itemId}"`)
}

/** Every IPC request the page has made, in order: `{ cmd, module, args }`. */
export function ipcCalls(page) {
  return page.evaluate(() => window.__tauriMock.invoked)
}

/** True when any request so far matches `cmd` (and `predicate`, run in Node). */
export async function invoked(page, cmd, predicate = () => true) {
  const calls = await ipcCalls(page)
  return calls.some((call) => call.cmd === cmd && predicate(call.args, call))
}
