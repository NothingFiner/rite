import { test, expect } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// Guard: one IPC envelope, one owner.
//
// Every spec used to hand-roll the v1 IPC envelope, and each copy got a
// different part of the protocol wrong: one looked for `req.payload` when Tauri
// spreads invoke args at the top level, one answered `saveDialog` at the top
// level when it arrived as a module call, one read `req.args` only. Tests still
// passed, because each mock happened to match the call site it was written
// against — the S-024 objection was exactly this: the test proved its own mock,
// not the app.
//
// Tauri v2 changed the envelope again (a promise-returning
// `window.__TAURI_INTERNALS__.invoke`). The envelope lives in
// `e2e/helpers/tauri-ipc.mock.js`; this file fails the suite when a spec
// reintroduces a private copy, or when a stale v1 copy survives the migration.

const E2E_DIR = dirname(fileURLToPath(import.meta.url))
const SELF = 'conventions.spec.js'
const HELPER_DIR = 'helpers'

function specFiles() {
  return readdirSync(E2E_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.js') && entry.name !== SELF)
    .map((entry) => entry.name)
    .sort()
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function mockFiles() {
  // Every spec and every helper except this guard (whose own messages name the
  // v1 envelope so that a reader knows what to look for).
  return [...specFiles().map((name) => join(E2E_DIR, name)), ...walk(join(E2E_DIR, HELPER_DIR))]
    .filter((file) => /\.js$/.test(file))
    .sort()
}

test('S-H1: no spec hand-rolls the Tauri IPC envelope', () => {
  const offenders = specFiles().filter((name) =>
    readFileSync(join(E2E_DIR, name), 'utf8').includes('__TAURI_INTERNALS__'),
  )

  expect(
    offenders,
    'these specs touch window.__TAURI_INTERNALS__ directly; use installTauriIpc() from ' +
      'e2e/helpers/tauri-ipc.js and register routes instead',
  ).toEqual([])
})

test('S-020: no spec or helper keeps the v1 IPC envelope', () => {
  const offenders = mockFiles()
    .filter((file) => readFileSync(file, 'utf8').includes('__TAURI_IPC__'))
    .map((file) => relative(E2E_DIR, file))

  expect(
    offenders,
    'these files still reference the v1 global; v2 is window.__TAURI_INTERNALS__.invoke ' +
      'and the envelope belongs to e2e/helpers/tauri-ipc.mock.js',
  ).toEqual([])
})

test('S-020: the mock does not implement the v1 callback protocol', () => {
  const mock = readFileSync(join(E2E_DIR, HELPER_DIR, 'tauri-ipc.mock.js'), 'utf8')

  // The v1 envelope delivered results through `window['_<id>']` callbacks. In v2
  // invoke returns a promise, so any of these markers means a half-migrated mock
  // that would pass some specs and fail others.
  expect(mock).not.toContain("window['_' + request.callback]")
  expect(mock).not.toContain("window['_' + request.error]")
  expect(mock).not.toContain('__tauriModule')
})

test('S-H2: the shared helper still owns the envelope', () => {
  const mock = readFileSync(join(E2E_DIR, HELPER_DIR, 'tauri-ipc.mock.js'), 'utf8')

  // The envelope must be assigned by the helper, or the guard above would be
  // satisfied by an app that simply has no IPC mock at all.
  expect(mock).toContain('window.__TAURI_INTERNALS__ =')
  expect(mock).toContain('invoke: invoke')
  // …and it must keep the part of the v2 protocol that is easy to get wrong:
  // the callback ids `listen()` goes through.
  expect(mock).toContain('transformCallback')
  expect(mock).toContain('plugin:')
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
