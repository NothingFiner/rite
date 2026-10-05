import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import NavigationDrawer from './NavigationDrawer.vue'

// Drag-reorder spec (roadmap 5.5). jsdom has no real drag-and-drop: no
// DataTransfer, and getBoundingClientRect returns all zeros — which makes
// dropHalf deterministically pick 'after' for every synthetic event. So
// these tests drive the handlers through vue-test-utils' `trigger` and
// assert on emitted events and class toggles; the pure geometry math is
// covered separately in useOutlineDrag.test.js.

function makeItem(id, displayTitle = id) {
  return { id, title: displayTitle, sectionType: 'section', chapterIndex: null, displayTitle, page: 1 }
}

function makeDrawer(items = ['a', 'b', 'c'].map((id) => makeItem(id))) {
  return mount(NavigationDrawer, { props: { open: true, tocItems: items } })
}

describe('NavigationDrawer drag-reorder', () => {
  it('emits moveSection with the dragged id and the after-target', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    await rows[0].trigger('dragstart') // drag "a"
    await rows[1].trigger('dragover')  // hover "b"
    await rows[1].trigger('drop')       // drop: jsdom rect is zero → 'after'

    expect(wrapper.emitted('moveSection')).toEqual([['a', 'b']])
  })

  it('does not emit for a no-op drop back onto the current position', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    // Drag "c" (last) and drop it after "b" — its current position.
    await rows[2].trigger('dragstart')
    await rows[1].trigger('dragover')
    await rows[1].trigger('drop')

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
    await rows[1].trigger('dragover')
    // Zero rect → 'after' → the line renders below the hovered row.
    expect(rows[1].classes()).toContain('drop-below')

    await rows[1].trigger('drop')
    expect(rows[1].classes()).not.toContain('drop-below')
  })

  it('never treats the dragged row itself as a drop target', async () => {
    const wrapper = makeDrawer()
    const rows = wrapper.findAll('.nav-section')

    await rows[0].trigger('dragstart')
    await rows[0].trigger('dragover')
    expect(rows[0].classes()).not.toContain('drop-below')

    // Dropping on the source row is a no-op, not an emit.
    await rows[0].trigger('drop')
    expect(wrapper.emitted('moveSection')).toBeUndefined()
  })

  it('makes a row being renamed undraggable and not a valid drop target', async () => {
    const wrapper = mount(NavigationDrawer, {
      props: { open: true, activeId: 'a', tocItems: ['a', 'b', 'c'].map((id) => makeItem(id)) },
    })
    const rows = wrapper.findAll('.nav-section')

    // The edit button only renders on the ACTIVE row.
    expect(rows[0].find('.nav-edit').exists()).toBe(true)
    await rows[0].find('.nav-edit').trigger('click')
    await wrapper.vm.$nextTick()

    // Drilling directly into the updated row list (re-find after re-render).
    const rowsAfter = wrapper.findAll('.nav-section')
    expect(rowsAfter[0].attributes('draggable')).toBe('false')
    expect(rowsAfter[1].attributes('draggable')).toBe('true')

    // Dragging "b" over the renaming row marks no drop target on it.
    await rowsAfter[1].trigger('dragstart')
    await rowsAfter[0].trigger('dragover')
    expect(rowsAfter[0].classes()).not.toContain('drop-below')
    expect(rowsAfter[0].classes()).not.toContain('drop-above')

    // And a drop there neither emits nor throws.
    await rowsAfter[0].trigger('drop')
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
    rows[1].element.dispatchEvent(dragover)
    // dragover's dropEffect must AGREE with dragstart's effectAllowed.
    expect(dataTransfer.dropEffect).toBe('move')

    await rows[0].trigger('dragend')
    expect(document.querySelector('.nav-drag-ghost')).toBeNull()
  })
})