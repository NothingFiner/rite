import { describe, it, expect, afterEach } from 'vitest'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import NavigationDrawer from './NavigationDrawer.vue'

// Keyboard operability of the section list (SPEC.md S-001 … S-003, roadmap 5.7).
//
// These are DOM contracts, not interaction tests: jsdom has no focus or layout,
// so "can the keyboard reach it" is expressed as "is it a control, is it named,
// and is it in the tab order". Real key presses and focus movement are covered
// by e2e/keyboard-navigation.spec.js.
//
// The row-level assertions go through `rowControl` rather than assuming the
// control IS the `[data-nav-id]` element: an `li` wrapping a `button` is just as
// valid as a `button` carrying the attribute, and S-003 requires the row's
// action buttons to be siblings of that control either way.

enableAutoUnmount(afterEach)

function makeItem(id, displayTitle = id) {
  return {
    id,
    title: displayTitle,
    sectionType: 'section',
    chapterIndex: null,
    displayTitle,
    page: 1,
    hidden: false,
  }
}

const ITEMS = [
  makeItem('alpha', 'Chapter One'),
  makeItem('bravo', 'Chapter Two'),
  makeItem('charlie', 'Chapter Three'),
]

function mountDrawer(activeId = 'bravo') {
  return mount(NavigationDrawer, {
    props: { open: true, activeId, tocItems: ITEMS },
  })
}

const isControl = (el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button'

// The row's own action buttons. They are controls too, so the resolver below must
// not mistake one of them for the row control — that would make S-001 "pass" on a
// row whose only control is its delete button.
const ROW_ACTIONS = ['.nav-edit', '.nav-delete', '.nav-type-toggle', '.nav-hidden-toggle']

// The control a keyboard user lands on for a row: the row element itself when it
// is a control, otherwise the first control inside it that is not a row action.
function rowControl(row) {
  if (!row) return null
  if (isControl(row.element)) return row.element
  const candidates = Array.from(row.element.querySelectorAll('button, [role="button"]'))
  return candidates.find((el) => !ROW_ACTIONS.some((sel) => el.matches(sel))) ?? null
}

// Accessible name in the order the spec permits: aria-label, then content, then
// title. Rows must use aria-label — their text carries a page number and the
// action glyphs (SPEC.md "Decisions" 8).
function accessibleName(el) {
  if (!el) return ''
  const label = el.getAttribute('aria-label')
  if (label && label.trim()) return label.trim()
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
  if (text) return text
  return (el.getAttribute('title') || '').trim()
}

describe('NavigationDrawer — keyboard navigation', () => {
  it('S-001: should expose every section row as a focusable control named by its display title', () => {
    const wrapper = mountDrawer()

    for (const item of ITEMS) {
      const row = wrapper.find(`[data-nav-id="${item.id}"]`)
      expect(row.exists(), `no row rendered for ${item.id}`).toBe(true)

      const control = rowControl(row)
      expect(control, `row ${item.id} exposes no control`).toBeTruthy()
      expect(isControl(control), `row ${item.id} is not a button or role=button`).toBe(true)
      expect(accessibleName(control)).toBe(item.displayTitle)
    }

    // Roving tabindex: exactly one row carries the list's single tab stop.
    const inTabOrder = ITEMS.map((item) => rowControl(wrapper.find(`[data-nav-id="${item.id}"]`)))
      .filter((control) => control && control.tabIndex === 0)
    expect(inTabOrder).toHaveLength(1)
  })

  it('S-002: should mark only the active section as the current item', () => {
    const wrapper = mountDrawer('bravo')

    for (const item of ITEMS) {
      const control = rowControl(wrapper.find(`[data-nav-id="${item.id}"]`))
      expect(control, `row ${item.id} exposes no control`).toBeTruthy()
      const current = control.getAttribute('aria-current')
      if (item.id === 'bravo') {
        expect(current, 'the active row is not marked current').toBe('true')
      } else {
        expect(current, `${item.id} must not be marked current`).not.toBe('true')
      }
    }
  })

  it('S-003: should keep the row actions out of the row control so they do not also select the section', () => {
    const wrapper = mountDrawer('bravo')
    const row = wrapper.find('[data-nav-id="bravo"]')
    const control = rowControl(row)
    expect(control, 'row bravo exposes no control').toBeTruthy()

    const actions = ['.nav-edit', '.nav-delete', '.nav-type-toggle', '.nav-hidden-toggle']
    for (const selector of actions) {
      const action = row.find(selector)
      expect(action.exists(), `missing row action ${selector}`).toBe(true)
      expect(
        control.contains(action.element),
        `${selector} is nested inside the row control (invalid nested interactive)`
      ).toBe(false)
    }

    // And the delegation still holds: an action fires its own event, never select.
    row.find('.nav-delete').trigger('click')
    expect(wrapper.emitted('deleteItem')).toBeTruthy()
    expect(wrapper.emitted('select')).toBeFalsy()
  })
})
