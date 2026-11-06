import { describe, it, expect } from 'vitest'
import { DRAWER_MODES_ALLOWED_IN_VIEW, isDrawerModeAllowedIn } from './drawerVisibility.js'

describe('DRAWER_MODES_ALLOWED_IN_VIEW', () => {
  it('exposes the three views', () => {
    expect(Object.keys(DRAWER_MODES_ALLOWED_IN_VIEW).sort()).toEqual(['editor', 'history', 'manuscript'])
  })
})

describe('isDrawerModeAllowedIn', () => {
  it('allows all three modes in the editor', () => {
    expect(isDrawerModeAllowedIn('chapters', 'editor')).toBe(true)
    expect(isDrawerModeAllowedIn('general-options', 'editor')).toBe(true)
    expect(isDrawerModeAllowedIn('text-options', 'editor')).toBe(true)
  })

  it('allows Sections + General Options in the manuscript, drops Text Options', () => {
    expect(isDrawerModeAllowedIn('chapters', 'manuscript')).toBe(true)
    expect(isDrawerModeAllowedIn('general-options', 'manuscript')).toBe(true)
    expect(isDrawerModeAllowedIn('text-options', 'manuscript')).toBe(false)
  })

  it('allows only General Options in the history view', () => {
    expect(isDrawerModeAllowedIn('general-options', 'history')).toBe(true)
    expect(isDrawerModeAllowedIn('chapters', 'history')).toBe(false)
    expect(isDrawerModeAllowedIn('text-options', 'history')).toBe(false)
  })

  it('never allows the history mode — it has no ActivityBar button', () => {
    // The version list is toggled from the History view's in-header Versions
    // button, not an ActivityBar icon, so 'history' is intentionally absent
    // from every view's allowed list.
    expect(isDrawerModeAllowedIn('history', 'editor')).toBe(false)
    expect(isDrawerModeAllowedIn('history', 'manuscript')).toBe(false)
    expect(isDrawerModeAllowedIn('history', 'history')).toBe(false)
  })

  it('returns false for an unknown mode', () => {
    expect(isDrawerModeAllowedIn('no-such-mode', 'editor')).toBe(false)
  })

  it('returns false for an unknown view', () => {
    expect(isDrawerModeAllowedIn('chapters', 'no-such-view')).toBe(false)
    expect(isDrawerModeAllowedIn('general-options', 'no-such-view')).toBe(false)
  })
})