import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusBar from './StatusBar.vue'
import { THEMES } from '../constants/themes.js'

// Keyboard operability of the theme picker (SPEC.md S-010 … S-012, roadmap 5.7).
// DOM contracts only; opening, applying and Escape live in
// e2e/keyboard-navigation.spec.js.

const isControl = (el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button'

function accessibleName(el) {
  if (!el) return ''
  const label = el.getAttribute('aria-label')
  if (label && label.trim()) return label.trim()
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
  if (text) return text
  return (el.getAttribute('title') || '').trim()
}

const mountBar = (props = {}) =>
  mount(StatusBar, {
    props: { theme: 0, themes: THEMES, showThemePicker: false, wordCount: 12, ...props },
  })

describe('StatusBar theme picker — keyboard navigation', () => {
  it('S-010: should expose the theme trigger as a named control that reports whether the picker is open', () => {
    const closed = mountBar({ showThemePicker: false })
    const closedTrigger = closed.find('.theme-swatch.current')
    expect(closedTrigger.exists()).toBe(true)
    expect(isControl(closedTrigger.element), 'the trigger is not a button').toBe(true)
    expect(accessibleName(closedTrigger.element).length, 'the trigger has no name').toBeGreaterThan(0)
    expect(closedTrigger.attributes('aria-expanded')).toBe('false')

    const open = mountBar({ showThemePicker: true })
    const openTrigger = open.find('.theme-swatch.current')
    expect(isControl(openTrigger.element), 'the trigger is not a button').toBe(true)
    expect(accessibleName(openTrigger.element).length, 'the trigger has no name').toBeGreaterThan(0)
    expect(openTrigger.attributes('aria-expanded')).toBe('true')
  })

  it('S-011: should name every theme and every swatch by its own unique name', () => {
    // The data has to carry the names: THEMES is the single source of truth.
    for (const [i, theme] of THEMES.entries()) {
      expect(typeof theme.name, `theme ${i} has no name`).toBe('string')
      expect(theme.name.trim().length, `theme ${i} has an empty name`).toBeGreaterThan(0)
    }
    const names = THEMES.map((theme) => theme.name.trim())
    expect(new Set(names).size, 'theme names are not unique').toBe(names.length)

    const wrapper = mountBar({ showThemePicker: true })
    const swatches = wrapper.findAll('.theme-tooltip .theme-swatch')
    expect(swatches).toHaveLength(THEMES.length)

    for (const [i, swatch] of swatches.entries()) {
      expect(isControl(swatch.element), `swatch ${i} is not a button`).toBe(true)
      expect(accessibleName(swatch.element)).toBe(THEMES[i].name.trim())
    }
  })

  it('S-012: should mark only the swatch of the current theme as the current item', () => {
    const current = 2
    const wrapper = mountBar({ theme: current, showThemePicker: true })
    const swatches = wrapper.findAll('.theme-tooltip .theme-swatch')
    expect(swatches).toHaveLength(THEMES.length)

    for (const [i, swatch] of swatches.entries()) {
      const marked = swatch.attributes('aria-current')
      if (i === current) {
        expect(marked, 'the current theme swatch is not marked current').toBe('true')
      } else {
        expect(marked, `swatch ${i} must not be marked current`).not.toBe('true')
      }
    }
  })
})
