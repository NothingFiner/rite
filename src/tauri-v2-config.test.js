// Tauri v2 migration — config, dependency and capability sentences
// (SPEC.md S-001 … S-006, S-012 … S-014).
//
// These read files rather than importing modules on purpose: the migration
// moves an entire package major, so nothing in `src/` can be imported until the
// source imports are renamed. A config assertion does not care.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const readText = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const readJson = (rel) => JSON.parse(readText(rel))

function tauriConf() {
  return readJson('src-tauri/tauri.conf.json')
}

function capabilities() {
  const dir = join(ROOT, 'src-tauri/capabilities')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')))
}

function grantedPermissions() {
  const all = []
  for (const capability of capabilities()) {
    for (const permission of capability.permissions || []) {
      all.push(typeof permission === 'string' ? permission : JSON.stringify(permission))
    }
  }
  return all
}

describe('S-001..S-006: v2 config and dependencies', () => {
  it('S-001: the build config points at the dev server and the dist directory', () => {
    const build = tauriConf().build
    expect(build.devUrl).toBe('http://localhost:1420')
    expect(build.frontendDist).toBe('../dist')
    expect(build.beforeDevCommand).toBe('npm run dev')
    expect(build.beforeBuildCommand).toBe('npm run build')
    // v1 spelling must be gone, not shadowed.
    expect(build.devPath).toBeUndefined()
    expect(build.distDir).toBeUndefined()
  })

  it('S-002: the product name and bundle identifier are unchanged', () => {
    const conf = tauriConf()
    expect(conf.productName).toBe('rite')
    expect(conf.bundle.identifier).toBe('com.rite.app')
  })

  it('S-003: the main window keeps its geometry and titlebar chrome', () => {
    const conf = tauriConf()
    const windows = conf.app?.windows
    expect(Array.isArray(windows)).toBe(true)
    expect(windows).toHaveLength(1)
    const win = windows[0]
    expect(win.width).toBe(960)
    expect(win.height).toBe(720)
    expect(win.resizable).toBe(true)
    expect(win.decorations).toBe(true)
    expect(win.transparent).toBe(false)
    expect(win.titleBarStyle).toBe('Overlay')
    expect(win.hiddenTitle).toBe(true)
    expect(win.center).toBe(true)
  })

  it('S-004: macOS private API is still enabled, so spellchecking still works', () => {
    const conf = tauriConf()
    expect(conf.app?.macOSPrivateApi).toBe(true)
    expect(conf.tauri?.macOSPrivateApi).toBeUndefined()
  })

  it('S-005: the frontend is on the v2 packages and no v1 tauri entry remains', () => {
    const pkg = readJson('package.json')
    const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
    const tauriPackages = Object.keys(all).filter((name) => name.startsWith('@tauri-apps/'))

    expect(tauriPackages.length).toBeGreaterThan(0)
    expect(all['@tauri-apps/api']).toMatch(/^\^?2\./)
    expect(all['@tauri-apps/cli']).toMatch(/^\^?2\./)
    expect(all['@tauri-apps/plugin-dialog']).toMatch(/^\^?2\./)

    for (const name of tauriPackages) {
      expect(all[name], `${name} is still pinned to v1`).not.toMatch(/[\^~]?1\./)
    }
  })

  it('S-006: the Rust crate is on tauri 2 and tauri-build 2', () => {
    const cargo = readText('src-tauri/Cargo.toml')
    const depLines = cargo
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^(tauri|tauri-build)\s*=/.test(line))

    expect(depLines.length).toBeGreaterThanOrEqual(3) // tauri, tauri (test), tauri-build
    for (const line of depLines) {
      expect(line, `"${line}" still declares a v1 tauri version`).not.toMatch(/version\s*=\s*"1\./)
    }
    expect(depLines.some((line) => /^tauri\s*=\s*\{\s*version\s*=\s*"2\./.test(line))).toBe(true)
    expect(depLines.some((line) => /^tauri-build\s*=\s*\{\s*version\s*=\s*"2\./.test(line))).toBe(
      true,
    )
    // The `test` feature is what lets integration tests build a mock app.
    expect(cargo).toMatch(/features\s*=\s*\[[^\]]*"test"/)
  })
})

describe('S-012..S-014: capabilities replace the allowlist', () => {
  it('S-012: a capability file exists and applies to the main window', () => {
    const caps = capabilities()
    expect(caps.length, 'no capability file under src-tauri/capabilities').toBeGreaterThan(0)

    const forMain = caps.filter(
      (cap) => Array.isArray(cap.windows) && cap.windows.includes('main'),
    )
    expect(forMain.length, 'no capability applies to the "main" window').toBeGreaterThan(0)
    expect(existsSync(join(ROOT, 'src-tauri/tauri.conf.json'))).toBe(true)
    // v1 allowlist must be gone, not left beside the capabilities.
    expect(tauriConf().tauri?.allowlist).toBeUndefined()
  })

  it('S-013: dialogs and window dragging are granted', () => {
    const granted = grantedPermissions()
    const hasDialog =
      granted.includes('dialog:default') ||
      ['dialog:allow-open', 'dialog:allow-save', 'dialog:allow-ask', 'dialog:allow-message'].every(
        (permission) => granted.includes(permission),
      )
    expect(hasDialog, `granted permissions were ${granted.join(', ')}`).toBe(true)
    expect(granted).toContain('core:window:allow-start-dragging')
  })

  it('S-014: nothing beyond dialogs and dragging is granted', () => {
    const granted = grantedPermissions()
    expect(
      granted.length,
      'no permissions were granted at all — an empty set would pass every check below',
    ).toBeGreaterThan(0)
    const forbidden = /(^|:)(fs|shell|http|process|clipboard|global-shortcut)(:|$)/
    const offenders = granted.filter((permission) => forbidden.test(permission))
    expect(offenders, `these permissions widen the surface: ${offenders.join(', ')}`).toEqual([])

    const wildcards = granted.filter((permission) => permission.includes('**') || permission === '*')
    expect(wildcards, `wildcard scopes are not allowed: ${wildcards.join(', ')}`).toEqual([])
  })
})
