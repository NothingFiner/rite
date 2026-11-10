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

// Guard: no deep watch on the document.
//
// A `{ deep: true }` watch on `doc.sections` walks every paragraph, element and
// style object on every trigger. That cost grows with the manuscript, and typing
// pays it per keystroke. Watch a scalar, or a getter that reads one property per
// section. `calculateBreaks` already diffs per-section signatures to find what
// changed.
//
// The scan masks comments and literals, then walks each `watch(` call to its
// closing paren. A `deep: true` whose call watches `sections` or `modelValue` is
// an offender.

const SRC_DIR = join(E2E_DIR, '..', 'src')

function sourceFiles(dir = SRC_DIR, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(js|vue)$/.test(entry) && !/\.(test|spec)\.js$/.test(entry)) out.push(full)
  }
  return out
}

// A comment or a string literal is not code, so its text must never look like a
// `watch(` call or a `deep: true` option. This replaces that text with spaces of
// the same length, which keeps every offset and line number intact.
function maskNonCode(source) {
  const masked = source.split('')
  let lastCode = ''
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') masked[i++] = ' '
      continue
    }
    if (ch === '/' && next === '*') {
      masked[i++] = ' '
      masked[i++] = ' '
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] !== '\n') masked[i] = ' '
        i += 1
      }
      if (i < source.length) {
        masked[i++] = ' '
        masked[i++] = ' '
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      masked[i++] = ' '
      while (i < source.length) {
        if (source[i] === '\\') {
          masked[i++] = ' '
          if (i < source.length && source[i] !== '\n') masked[i++] = ' '
          continue
        }
        if (source[i] === quote) {
          masked[i++] = ' '
          break
        }
        if (source[i] !== '\n') masked[i] = ' '
        i += 1
      }
      lastCode = quote
      continue
    }
    // A slash after a value is division. After an operator or an opener, a slash
    // starts a regular expression whose parentheses are text.
    if (ch === '/' && (lastCode === '' || '=(:,[!&|?{};+-*%<>~^'.includes(lastCode))) {
      masked[i++] = ' '
      let inClass = false
      while (i < source.length) {
        const c = source[i]
        if (c === '\\') {
          masked[i++] = ' '
          if (i < source.length && source[i] !== '\n') masked[i++] = ' '
          continue
        }
        if (c === '[') inClass = true
        else if (c === ']') inClass = false
        else if (c === '/' && !inClass) {
          masked[i++] = ' '
          break
        } else if (c === '\n') {
          break
        }
        masked[i] = ' '
        i += 1
      }
      lastCode = '/'
      continue
    }
    if (!/\s/.test(ch)) lastCode = ch
    i += 1
  }
  return masked.join('')
}

// Split a call's argument list at the commas that sit at its own nesting depth.
// A callback body and an options object each nest one level, so neither splits.
function callArguments(callText) {
  const body = callText.slice('watch('.length, -1)
  const args = []
  let depth = 0
  let from = 0
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if ('([{'.includes(ch)) depth += 1
    else if (')]}'.includes(ch)) depth -= 1
    else if (ch === ',' && depth === 0) {
      args.push(body.slice(from, i))
      from = i + 1
    }
  }
  args.push(body.slice(from))
  return args
}

// Every `watch(` call in the source, found on the masked text so only real calls
// count. Each entry carries the call's text and its offset in the file.
function watchCalls(source) {
  const masked = maskNonCode(source)
  const calls = []
  const token = 'watch('
  for (let start = masked.indexOf(token); start !== -1; start = masked.indexOf(token, start + 1)) {
    // `mywatch(` is a different function.
    if (start > 0 && /[A-Za-z0-9_$]/.test(masked[start - 1])) continue
    let depth = 0
    let end = -1
    for (let i = start + 'watch'.length; i < masked.length; i += 1) {
      if (masked[i] === '(') depth += 1
      else if (masked[i] === ')') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end !== -1) calls.push({ start, text: masked.slice(start, end + 1) })
  }
  return calls
}

test('S-H4: nothing deep-watches the document', () => {
  const offenders = []
  for (const file of sourceFiles()) {
    const source = readFileSync(file, 'utf8')
    for (const { start, text } of watchCalls(source)) {
      // Vue's first argument is the watched source. The options object follows.
      const args = callArguments(text)
      if (!/sections|modelValue/.test(args[0] || '')) continue
      const options = args.slice(1).find(arg => /^\s*\{/.test(arg) && /\bdeep\s*:\s*true\b/.test(arg))
      if (!options) continue
      const deepIndex = text.search(/\bdeep\s*:\s*true\b/)
      const line = source.slice(0, start + deepIndex).split('\n').length
      offenders.push(`${relative(SRC_DIR, file)}:${line}`)
    }
  }

  expect(
    offenders,
    'these watchers deep-walk the document on every keystroke; watch a scalar or ' +
      'one property per section instead (see this test\'s comment)',
  ).toEqual([])
})
