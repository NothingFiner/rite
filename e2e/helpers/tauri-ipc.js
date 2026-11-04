// Shared Tauri v2 IPC mocking for Playwright.
//
// The harness runs plain Vite with no Tauri runtime, so every spec that needs a
// backend mocks `window.__TAURI_INTERNALS__.invoke` (the v2 envelope — v2 is a
// promise API, so the v1 callback protocol is gone). The envelope lives once in
// ./tauri-ipc.mock.js; this module is the Node-side half that injects it.
//
// Do not hand-roll the envelope in a spec: `e2e/conventions.spec.js` fails the
// suite if any spec references it. Register a route instead.

import { fileURLToPath } from 'node:url'

const MOCK_SCRIPT = fileURLToPath(new URL('./tauri-ipc.mock.js', import.meta.url))

/**
 * Install the shared IPC mock before the app loads.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ doc?: object, docFails?: boolean, dialogPaths?: string[],
 *           openPaths?: string[], messageAnswer?: string }} [options]
 *   Defaults the mock answers: the seeded document returned by `get_document`,
 *   whether `get_document` rejects instead, the paths the save dialog returns in
 *   order (one per dialog), the paths the open dialog returns, and the label a
 *   `message` dialog resolves to (`'Yes'` makes `ask()` true).
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

/** Every IPC request the page has made, in order: `{ cmd, args }`. */
export function ipcCalls(page) {
  return page.evaluate(() => window.__tauriMock.invoked)
}

/**
 * The envelope the page is actually speaking, without a spec naming the global.
 *
 * v2's `invoke` is a promise-returning `__TAURI_INTERNALS__.invoke`, and
 * `listen()` goes through `transformCallback` to mint a handler id. A page where
 * either is missing is a page whose IPC mock is not installed or is still the v1
 * one.
 */
export function envelope(page) {
  return page.evaluate(() => {
    const internals = window.__TAURI_INTERNALS__
    return {
      hasInvoke: typeof internals?.invoke === 'function',
      hasTransformCallback: typeof internals?.transformCallback === 'function',
    }
  })
}

/** True when any request so far matches `cmd` (and `predicate`, run in Node). */
export async function invoked(page, cmd, predicate = () => true) {
  const calls = await ipcCalls(page)
  return calls.some((call) => call.cmd === cmd && predicate(call.args, call))
}
