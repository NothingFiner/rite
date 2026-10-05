import { describe, it, expect, afterEach } from 'vitest'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { nextTick } from 'vue'
import NavigationDrawer from './NavigationDrawer.vue'

// Drag-reorder spec (roadmap 5.5). The drag is a CUSTOM pointer-event
// gesture (pointerdown → 4px threshold → pointermove → pointerup), NOT
// native HTML5 DnD — WKWebView's drag sessions misroute events inside the
// transformed, scrolling drawer, so the component trusts only pointer
// coordinates. jsdom has no real geometry: getBoundingClientRect returns
// all zeros, so this spec PATCHES deterministic row rects (30px rows,
// i*30 tops) and drives the document-level handlers through dispatched
// pointer events. The pure geometry helpers are covered separately in
// useOutlineDrag.test.js.
//
// Two mounting facts this spec depends on: VTU v2 mounts DETACHED from the
// document (bubbled events would die at the wrapper root before reaching
// the document-level handlers), so every mount attaches to document.body;
// and auto-unmount exercises onBeforeUnmount's listener cleanup between
// tests.

enableAutoUnmount(afterEach)

function makeItem(id, displayTitle = id) {
  return { id, title: displayTitle, sectionType: 'section', chapterIndex: null, displayTitle, page: 1 }
}

function makeDrawer(props = {}) {
  const wrapper = mount(NavigationDrawer, {
    attachTo: document.body,
    props: { open: true, tocItems: ['a', 'b', 'c'].map((id) => makeItem(id)), ...props },
  })
  patchRowRects(wrapper)
  return wrapper
}

// Deterministic layout: the list spans x [0, 260]; row i spans y [i*30,
// i*30+30]. The ul's rect matters for the clientX containment check —
// jsdom's zero rect would reject every pointer at x > 0 as outside.
function patchRowRects(wrapper) {
  const list = wrapper.find('.nav-tree').element
  list.getBoundingClientRect = () => ({
    top: 0,
    bottom: 120,
    height: 120,
    left: 0,
    right: 260,
    width: 260,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  wrapper.findAll('.nav-section').forEach((row, index) => {
    const top = index * 30
    row.element.getBoundingClientRect = () => ({
      top,
      bottom: top + 30,
      height: 30,
      left: 0,
      right: 260,
      width: 260,
      x: 0,
      y: top,
      toJSON: () => ({}),
    })
  })
}

// A pointerdown/pointermove/pointerup dispatched as a MouseEvent with a
// pointer- event type: listeners key on the event TYPE, and the handlers
// only read clientX/clientY/button, which MouseEvent carries. pointerId is
// left undefined so the optional-chained setPointerCapture call is skipped.
function dispatchPointer(rowWrapper, type, clientX, clientY) {
  rowWrapper.element.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY })
  )
  return nextTick()
}

describe('NavigationDrawer drag-reorder', () => {
  it('drags a row over another row and emits moveSection for the drop', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    // Press "a", move past the threshold into "b"'s lower half, release.
    await dispatchPointer(rows[0], 'pointerdown', 10, 5)
    await dispatchPointer(rows[0], 'pointermove', 10, 45)
    expect(rows[0].classes()).toContain('dragging')
    expect(rows[1].classes()).toContain('drop-below')
    await dispatchPointer(rows[0], 'pointerup', 10, 45)

    expect(wrapper.emitted('moveSection')).toEqual([['a', 'b']])
    // All drag state cleared: no dimmed row, no insertion line, no ghost.
    expect(rows[0].classes()).not.toContain('dragging')
    expect(rows[1].classes()).not.toContain('drop-below')
    expect(document.querySelector('.nav-drag-ghost')).toBeNull()
  })

  it('emits toAfterId null for a drop on the first row\'s upper half (to front)', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    // Drag "b" over "a"'s UPPER half → before "a" → front of the outline.
    await dispatchPointer(rows[1], 'pointerdown', 10, 35)
    await dispatchPointer(rows[1], 'pointermove', 10, 5)
    expect(rows[0].classes()).toContain('drop-above')
    await dispatchPointer(rows[1], 'pointerup', 10, 5)

    expect(wrapper.emitted('moveSection')).toEqual([['b', null]])
  })

  it('does not emit for a no-op drop back onto the current position', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    // Drag "c" (last) and release it after "b" — its current position.
    await dispatchPointer(rows[2], 'pointerdown', 10, 65)
    await dispatchPointer(rows[2], 'pointermove', 10, 45)
    await dispatchPointer(rows[2], 'pointerup', 10, 45)

    expect(wrapper.emitted('moveSection')).toBeUndefined()
  })

  it('treats a press under the movement threshold as a click, not a drag', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    // Press "a", wiggle 2px (under the 4px threshold), release: no drag
    // state ever appears, and the following click still selects the row.
    await dispatchPointer(rows[0], 'pointerdown', 10, 5)
    await dispatchPointer(rows[0], 'pointermove', 12, 7)
    await dispatchPointer(rows[0], 'pointerup', 12, 7)
    expect(rows[0].classes()).not.toContain('dragging')
    expect(wrapper.emitted('moveSection')).toBeUndefined()

    await rows[0].trigger('click')
    expect(wrapper.emitted('select')).toEqual([['a']])
  })

  it('swallows the click that follows a completed drag', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    await dispatchPointer(rows[0], 'pointerdown', 10, 5)
    await dispatchPointer(rows[0], 'pointermove', 10, 45)
    await dispatchPointer(rows[0], 'pointerup', 10, 45)

    // The browser fires a click after pointerup; it must not select/scroll
    // the editor to the dragged section...
    await rows[0].trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()

    // ...but the very next click is an ordinary selection again.
    await rows[0].trigger('click')
    expect(wrapper.emitted('select')).toEqual([['a']])
  })

  it('computes the drop target from geometry, not the event target (WebKit misrouting)', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    // Deliver a pointermove ON ROW 0's element with coordinates inside row
    // 2 — the misroute WKWebView actually produced (hover chapter 3, events
    // delivered a scroll-offset away). The line must follow the POINTER,
    // never the event's target.
    await dispatchPointer(rows[0], 'pointerdown', 10, 5)
    await dispatchPointer(rows[0], 'pointermove', 10, 75)
    expect(rows[2].classes()).toContain('drop-below')
    expect(rows[0].classes()).not.toContain('drop-below')
    expect(rows[0].classes()).not.toContain('drop-above')

    await dispatchPointer(rows[0], 'pointerup', 10, 75)
    expect(wrapper.emitted('moveSection')).toEqual([['a', 'c']])
  })

  it('paints no line and emits nothing while the pointer is on the dragged row', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    // Press and move WITHIN row 0 (past the threshold, still on the row).
    await dispatchPointer(rows[0], 'pointerdown', 10, 5)
    await dispatchPointer(rows[0], 'pointermove', 10, 12)
    expect(rows[0].classes()).not.toContain('drop-below')
    expect(rows[0].classes()).not.toContain('drop-above')

    await dispatchPointer(rows[0], 'pointerup', 10, 12)
    expect(wrapper.emitted('moveSection')).toBeUndefined()
  })

  it('paints no line while the pointer is outside the list (over the editor)', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    await dispatchPointer(rows[0], 'pointerdown', 10, 5)
    // clientX right of the list's right edge (260) — the document handlers
    // fire for the whole page, so the line must stay off.
    await dispatchPointer(rows[0], 'pointermove', 400, 45)
    expect(rows[1].classes()).not.toContain('drop-below')

    await dispatchPointer(rows[0], 'pointerup', 400, 45)
    expect(wrapper.emitted('moveSection')).toBeUndefined()
  })

  it('starts no drag from row controls, other buttons, or non-left clicks', async () => {
    const wrapper = makeDrawer({ activeId: 'a' })
    const rows = wrapper.findAll('.nav-section')

    // A pointerdown on the type-toggle badge (a <button> inside the row):
    // the row's handler must ignore it — its gesture belongs to the button.
    const toggle = rows[0].find('.nav-type-toggle')
    toggle.element.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 200, clientY: 5 })
    )
    await dispatchPointer(rows[0], 'pointermove', 200, 45)
    expect(rows[0].classes()).not.toContain('dragging')
    await dispatchPointer(rows[0], 'pointerup', 200, 45)

    // Right-click (button 2) starts no drag either.
    rows[0].element.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 2, clientX: 10, clientY: 5 })
    )
    await dispatchPointer(rows[0], 'pointermove', 10, 45)
    expect(rows[0].classes()).not.toContain('dragging')

    expect(wrapper.emitted('moveSection')).toBeUndefined()
  })

  it('makes a row being renamed undraggable and not a valid drop target', async () => {
    const wrapper = makeDrawer({ activeId: 'a' })
    const rows = wrapper.findAll('.nav-section')

    // The edit button only renders on the ACTIVE row.
    expect(rows[0].find('.nav-edit').exists()).toBe(true)
    await rows[0].find('.nav-edit').trigger('click')
    await wrapper.vm.$nextTick()

    // Re-find after the re-render (same keyed elements, so patched rects survive).
    const rowsAfter = wrapper.findAll('.nav-section')

    // A press on the renaming row itself starts no drag.
    await dispatchPointer(rowsAfter[0], 'pointerdown', 10, 5)
    await dispatchPointer(rowsAfter[0], 'pointermove', 10, 45)
    expect(rowsAfter[0].classes()).not.toContain('dragging')
    await dispatchPointer(rowsAfter[0], 'pointerup', 10, 45)

    // And dragging ANOTHER row with the pointer over the renaming row
    // paints no line there and emits nothing.
    await dispatchPointer(rowsAfter[1], 'pointerdown', 10, 35)
    await dispatchPointer(rowsAfter[1], 'pointermove', 10, 5)
    expect(rowsAfter[0].classes()).not.toContain('drop-below')
    expect(rowsAfter[0].classes()).not.toContain('drop-above')
    await dispatchPointer(rowsAfter[1], 'pointerup', 10, 5)
    expect(wrapper.emitted('moveSection')).toBeUndefined()
  })

  it('positions the ghost pill beside the pointer and removes it on release', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    await dispatchPointer(rows[0], 'pointerdown', 10, 5)
    await dispatchPointer(rows[0], 'pointermove', 40, 45)
    const ghost = document.querySelector('.nav-drag-ghost')
    expect(ghost).not.toBeNull()
    expect(ghost.textContent).toBe('a')
    expect(ghost.style.left).toBe('52px') // clientX + 12
    expect(ghost.style.top).toBe('57px') // clientY + 12
    // The ghost must never intercept the pointer itself.
    expect(ghost.style.pointerEvents).toBe('none')

    await dispatchPointer(rows[0], 'pointerup', 40, 45)
    expect(document.querySelector('.nav-drag-ghost')).toBeNull()
  })

  it('clears drag state on pointercancel (system gesture stole the pointer)', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    await dispatchPointer(rows[0], 'pointerdown', 10, 5)
    await dispatchPointer(rows[0], 'pointermove', 10, 45)
    rows[0].element.dispatchEvent(
      new MouseEvent('pointercancel', { bubbles: true, clientX: 10, clientY: 45 })
    )
    await nextTick()

    expect(rows[0].classes()).not.toContain('dragging')
    expect(rows[1].classes()).not.toContain('drop-below')
    expect(document.querySelector('.nav-drag-ghost')).toBeNull()
    expect(wrapper.emitted('moveSection')).toBeUndefined()
  })
})