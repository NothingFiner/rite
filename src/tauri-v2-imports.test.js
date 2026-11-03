// Tauri v2 migration — the frontend module surface (SPEC.md S-007 … S-011) and
// the Rust v1-menu-type removal (S-015).
//
// These scan files rather than import them: during the migration the source tree
// cannot be imported at all (the v1 subpaths are gone from the v2 package), so an
// import-based test would be an import error, not an assertion.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const RUST_SRC = join(ROOT, 'src-tauri/src')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/// Source modules only: no tests, no fixtures.
function sourceFiles() {
  return walk(SRC)
    .filter((file) => /\.(js|vue)$/.test(file))
    .filter((file) => !/\.(test|spec)\.js$/.test(file))
}

/// Every `import { a, b as c } from 'specifier'` in a file, plus bare
/// `import 'specifier'` side-effect imports. Returns `{ names, specifier }`.
function importsOf(file) {
  const text = readFileSync(file, 'utf8')
  const found = []
  const named = /import\s+([\s\S]*?)\s+from\s+'([^']+)'/g
  let match
  while ((match = named.exec(text)) !== null) {
    const clause = match[1]
    const braces = clause.match(/\{([\s\S]*)\}/)
    const names = braces
      ? braces[1]
          .split(',')
          .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
          .filter(Boolean)
      : [clause.trim()]
    found.push({ names, specifier: match[2] })
  }
  const sideEffect = /import\s+'([^']+)'/g
  while ((match = sideEffect.exec(text)) !== null) {
    found.push({ names: [], specifier: match[1] })
  }
  return found
}

function specifiers() {
  return sourceFiles().flatMap((file) =>
    importsOf(file).map((entry) => ({
      ...entry,
      file: relative(ROOT, file),
    })),
  )
}

function rustFiles() {
  return readdirSync(RUST_SRC)
    .filter((name) => name.endsWith('.rs'))
    .map((name) => join(RUST_SRC, name))
}

describe('S-007: command invocation goes through @tauri-apps/api/core', () => {
  it('S-007: no source module imports from the removed @tauri-apps/api/tauri', () => {
    const offenders = specifiers().filter((entry) => entry.specifier === '@tauri-apps/api/tauri')
    expect(
      offenders.map((entry) => entry.file),
      'invoke must come from @tauri-apps/api/core',
    ).toEqual([])
  })

  it('S-007: every module that imports invoke imports it from core', () => {
    const importers = specifiers().filter((entry) => entry.names.includes('invoke'))
    expect(importers.length).toBeGreaterThan(0)
    const wrong = importers.filter((entry) => entry.specifier !== '@tauri-apps/api/core')
    expect(
      wrong.map((entry) => `${entry.file} <- ${entry.specifier}`),
      'these modules import invoke from the wrong module',
    ).toEqual([])
  })
})

describe('S-008: dialogs come from the dialog plugin', () => {
  it('S-008: no source module imports from the removed @tauri-apps/api/dialog', () => {
    const offenders = specifiers().filter((entry) => entry.specifier === '@tauri-apps/api/dialog')
    expect(
      offenders.map((entry) => entry.file),
      'dialogs must come from @tauri-apps/plugin-dialog',
    ).toEqual([])
  })

  it('S-008: save/open/ask/message are imported from the dialog plugin', () => {
    const dialogNames = ['save', 'open', 'ask', 'message', 'confirm']
    const importers = specifiers().filter(
      (entry) =>
        entry.specifier.startsWith('@tauri-apps/') &&
        entry.names.some((name) => dialogNames.includes(name)),
    )
    expect(importers.length).toBeGreaterThan(0)
    const wrong = importers.filter((entry) => entry.specifier !== '@tauri-apps/plugin-dialog')
    expect(
      wrong.map((entry) => `${entry.file} <- ${entry.specifier}`),
      'these modules import dialog functions from the wrong module',
    ).toEqual([])
  })
})

describe('S-009 / S-010: the frontend no longer reads files itself', () => {
  it('S-009: no source module imports from the removed @tauri-apps/api/fs', () => {
    const offenders = specifiers().filter((entry) => entry.specifier === '@tauri-apps/api/fs')
    expect(
      offenders.map((entry) => entry.file),
      'file bytes must be fetched through a Rust command',
    ).toEqual([])
  })

  it('S-010: docx/odt import bytes come from a Rust command', () => {
    const text = readFileSync(join(SRC, 'composables/useFileIO.js'), 'utf8')
    expect(text).not.toContain('readBinaryFile')
    expect(text).toContain('read_import_bytes')
  })
})

describe('S-011: events keep their module and their name', () => {
  it('S-011: listen still comes from @tauri-apps/api/event', () => {
    const listeners = specifiers().filter((entry) => entry.names.includes('listen'))
    expect(listeners.length).toBeGreaterThan(0)
    const wrong = listeners.filter((entry) => entry.specifier !== '@tauri-apps/api/event')
    expect(
      wrong.map((entry) => `${entry.file} <- ${entry.specifier}`),
      'listen did not move in v2',
    ).toEqual([])
  })

  it('S-011: the menu event name is still "menu"', () => {
    const menu = readFileSync(join(RUST_SRC, 'menu.rs'), 'utf8')
    expect(menu).toMatch(/pub const MENU_EVENT_NAME: &str = "menu";/)
  })
})

describe('S-015: no v1 menu type survives in the Rust source', () => {
  it('S-015: the v1-only menu API is gone', () => {
    const v1Only = ['CustomMenuItem', 'MenuEntry', 'Submenu::new', 'Menu::with_items']
    const offenders = []
    for (const file of rustFiles()) {
      const text = readFileSync(file, 'utf8')
      for (const token of v1Only) {
        if (text.includes(token)) offenders.push(`${relative(ROOT, file)}: ${token}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
