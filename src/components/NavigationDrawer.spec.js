import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import NavigationDrawer from './NavigationDrawer.vue'

// The drag handlers live at the DOCUMENT level (see the component's block
// comment), so the component must be attached to the real document — VTU v2
// mounts DETACHED by default and bubbled drag events would die at the wrapper
// root. Auto-unmount after each test also exercises onBeforeUnmount's
// listener cleanup between tests.
enableAutoUnmount(afterEach)

// Drag-reorder spec (roadmap 5.5). jsdom has no real drag-and-drop: no
// DataTransfer, and getBoundingClientRect returns all zeros — so this spec
// PATCHES deterministic row rects (30px rows, i*30 tops) and drives the
// document-level drag handlers through dispatched events. The pure geometry
// helpers are covered separately in useOutlineDrag.test.js.
//
// The WKWebView bug this spec pins (manual round 2): WebKit misroutes drag
// events inside the transformed, scrolling drawer — the event's TARGET row
// can be a different row entirely from the one under the pointer. The
// component therefore computes the target from POINTER COORDINATES vs the
// row rects, and several tests dispatch on a deliberately WRONG row to
// prove geometry wins.

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

// Deterministic layout: row i spans y [i*30, i*30+30], x [0, 260]. The ul's
// own zero rect keeps the clientX containment check open at clientX 0.
function patchRowRects(wrapper) {
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

describe('NavigationDrawer drag-reorder', () => {
  it('emits moveSection with the dragged id and the after-target', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    await rows[0].trigger('dragstart')            // drag "a"
    await rows[1].trigger('dragover', { clientY: 45 }) // pointer in "b"'s lower half
    await rows[1].trigger('drop', { clientY: 45 })

    expect(wrapper.emitted('moveSection')).toEqual([['a', 'b']])
  })

  it('does not emit for a no-op drop back onto the current position', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    // Drag "c" (last) and drop it after "b" — its current position.
    await rows[2].trigger('dragstart')
    await rows[1].trigger('dragover', { clientY: 45 })
    await rows[1].trigger('drop', { clientY: 45 })

    expect(wrapper.emitted('moveSection')).toBeUndefined()
  })

  it('marks the dragged row while its drag is in flight and clears on dragend', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    await rows[0].trigger('dragstart')
    expect(rows[0].classes()).toContain('dragging')

    await rows[0].trigger('dragend')
    expect(rows[0].classes()).not.toContain('dragging')
  })

  it('shows the insertion line on the hovered row and clears it after the drop', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    await rows[0].trigger('dragstart')
    await rows[1].trigger('dragover', { clientY: 45 })
    // Lower half → the line renders below the hovered row.
    expect(rows[1].classes()).toContain('drop-below')

    await rows[1].trigger('drop', { clientY: 45 })
    expect(rows[1].classes()).not.toContain('drop-below')
  })

  it('computes the drop target from geometry, not the event target (WebKit misrouting)', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    // Drag "a", then deliver a dragover ON ROW 0 with coordinates inside
    // row 2 — the misroute WKWebView actually produced (hover chapter 3,
    // event delivered to a row a scroll-offset away). The line must follow
    // the POINTER, never the event's target.
    await rows[0].trigger('dragstart')
    await rows[0].trigger('dragover', { clientY: 75 })
    expect(rows[2].classes()).toContain('drop-below')
    expect(rows[0].classes()).not.toContain('drop-below')
    expect(rows[0].classes()).not.toContain('drop-above')

    // Same for the drop: delivered on the wrong element, the move still
    // lands where the pointer is (after "c").
    await rows[0].trigger('drop', { clientY: 75 })
    expect(wrapper.emitted('moveSection')).toEqual([['a', 'c']])
  })

  it('paints no line and emits nothing while the pointer is on the dragged row', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    await rows[0].trigger('dragstart')
    await rows[0].trigger('dragover', { clientY: 5 })
    expect(rows[0].classes()).not.toContain('drop-below')
    expect(rows[0].classes()).not.toContain('drop-above')

    // Dropping on the source row is a no-op, not an emit.
    await rows[0].trigger('drop', { clientY: 5 })
    expect(wrapper.emitted('moveSection')).toBeUndefined()
  })

  it('paints no line while the pointer is outside the list (over the editor)', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    await rows[0].trigger('dragstart')
    // clientX right of the list's right edge (260) — the document handler
    // fires for the whole page, so the line must stay off.
    await rows[1].trigger('dragover', { clientX: 400, clientY: 45 })
    expect(rows[1].classes()).not.toContain('drop-below')
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
    expect(rowsAfter[0].attributes('draggable')).toBe('false')
    expect(rowsAfter[1].attributes('draggable')).toBe('true')

    // Dragging "b" with the pointer over the renaming row marks no target.
    await rowsAfter[1].trigger('dragstart')
    await rowsAfter[0].trigger('dragover', { clientY: 5 })
    expect(rowsAfter[0].classes()).not.toContain('drop-below')
    expect(rowsAfter[0].classes()).not.toContain('drop-above')

    // And a drop there neither emits nor throws.
    await rowsAfter[0].trigger('drop', { clientY: 5 })
    expect(wrapper.emitted('moveSection')).toBeUndefined()
  })

  it('puts a drag payload, move effects, and a clean ghost on the dataTransfer', async () => {
    // WebKit cancels an element drag whose dragstart sets NO data (the
    // real-WKWebView bug: the drag fell back to a text-selection drag and
    // drop never fired). jsdom has no DataTransfer/DragEvent, so simulate
    // one on a plain Event — properties are assignable pre-dispatch.
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')
    const dataTransfer = {
      setData: vi.fn(),
      setDragImage: vi.fn(),
      effectAllowed: '',
      dropEffect: '',
    }

    const dragstart = new Event('dragstart', { bubbles: true })
    dragstart.dataTransfer = dataTransfer
    rows[0].element.dispatchEvent(dragstart)

    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'a')
    expect(dataTransfer.effectAllowed).toBe('move')
    expect(dataTransfer.setDragImage).toHaveBeenCalled()
    // The ghost replaces the native row snapshot (WKWebView snapshots the
    // page text behind the backdrop-filter drawer) and lives until dragend.
    expect(document.querySelector('.nav-drag-ghost')).not.toBeNull()

    const dragover = new Event('dragover', { bubbles: true, cancelable: true })
    dragover.dataTransfer = dataTransfer
    dragover.clientX = 0
    dragover.clientY = 45
    rows[1].element.dispatchEvent(dragover)
    // dragover's dropEffect must AGREE with dragstart's effectAllowed.
    expect(dataTransfer.dropEffect).toBe('move')

    await rows[0].trigger('dragend')
    expect(document.querySelector('.nav-drag-ghost')).toBeNull()
  })
})