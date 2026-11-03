import { test, expect } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Guard: one IPC envelope, one owner.
//
// Every spec used to hand-roll `window.__TAURI_IPC__`, and each copy got a
// different part of the v1 protocol wrong: one looked for `req.payload` when
// Tauri spreads invoke args at the top level, one answered `saveDialog` at the
// top level when it arrives as a `tauri`/Dialog module call, one read `req.args`
// only. Tests still passed, because each mock happened to match the call site it
// was written against — the S-024 objection on the native-menu PR was exactly
// this: the test proved its own mock, not the app.
//
// The envelope now lives in `e2e/helpers/tauri-ipc.mock.js`. This file fails the
// suite when a spec reintroduces a private copy, so the bug cannot come back
// quietly.

const E2E_DIR = dirname(fileURLToPath(import.meta.url))
const SELF = 'conventions.spec.js'
const HELPER_DIR = 'helpers'

function specFiles() {
  return readdirSync(E2E_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.js') && entry.name !== SELF)
    .map((entry) => entry.name)
    .sort()
}

test('S-H1: no spec hand-rolls the Tauri IPC envelope', () => {
  const offenders = specFiles().filter((name) =>
    readFileSync(join(E2E_DIR, name), 'utf8').includes('__TAURI_IPC__'),
  )

  expect(
    offenders,
    'these specs touch window.__TAURI_IPC__ directly; use installTauriIpc() from ' +
      'e2e/helpers/tauri-ipc.js and register routes instead',
  ).toEqual([])
})

test('S-H2: the shared helper still owns the envelope', () => {
  const mock = readFileSync(join(E2E_DIR, HELPER_DIR, 'tauri-ipc.mock.js'), 'utf8')

  // The envelope must be assigned by the helper, or the guard above would be
  // satisfied by an app that simply has no IPC mock at all.
  expect(mock).toContain('window.__TAURI_IPC__ =')
  // …and it must keep the two parts of the protocol that hand-rolled copies got
  // wrong: the callback ids and the top-level argument spread.
  expect(mock).toContain("window['_' + request.callback]")
  expect(mock).toContain("window['_' + request.error]")
  expect(mock).toContain('__tauriModule')
})

test('S-H3: every spec that mocks IPC goes through the helper', async () => {
  // A spec that registers routes but never injects the helper would throw at
  // runtime; this catches the import that was dropped during a refactor.
  const users = specFiles().filter((name) => {
    const source = readFileSync(join(E2E_DIR, name), 'utf8')
    return source.includes('__tauriMock')
  })

  for (const name of users) {
    const source = readFileSync(join(E2E_DIR, name), 'utf8')
    expect(source, `${name} uses window.__tauriMock but never imports the helper`).toMatch(
      /from '\.\/helpers\/tauri-ipc\.js'/,
    )
  }
})
