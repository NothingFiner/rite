import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ActivityBar from './ActivityBar.vue'

// The `.activity-icon` class is shared by two button groups: the drawer-item
// buttons (in `.activity-icons`) and the B/I/U format buttons (in
// `.activity-format`). One parameterized helper scopes the same class to a
// container, so the selector lives in one place — change the class once, not
// per group.
function activityIconButtons(wrapper, containerSelector) {
  return wrapper.findAll(`${containerSelector} .activity-icon`)
}

function drawerItems(wrapper) {
  return activityIconButtons(wrapper, '.activity-icons')
}

function formatButtons(wrapper) {
  return activityIconButtons(wrapper, '.activity-format')
}

describe('ActivityBar', () => {
  it('renders the activity bar', () => {
    const wrapper = mount(ActivityBar)
    expect(wrapper.find('.activity-bar').exists()).toBe(true)
  })

  it('S-001: should show a Stats item in the left navigation drawer', () => {
    const wrapper = mount(ActivityBar, { props: { viewMode: 'editor' } })
    const titles = drawerItems(wrapper).map((b) => b.attributes('title'))
    expect(titles).toContain('Stats')
  })

  it('S-001: should emit select with the stats id when the Stats item is clicked', async () => {
    const wrapper = mount(ActivityBar, { props: { viewMode: 'editor' } })
    const stats = drawerItems(wrapper).find((b) => b.attributes('title') === 'Stats')
    expect(stats).toBeTruthy()
    await stats.trigger('click')
    expect(wrapper.emitted('select').at(-1)).toEqual(['stats'])
  })

  it('shows every drawer button in the editor', () => {
    const wrapper = mount(ActivityBar, { props: { viewMode: 'editor' } })
    const titles = drawerItems(wrapper).map((b) => b.attributes('title'))
    expect(titles).toEqual(['Sections', 'General Options', 'Text Options', 'Stats'])
  })

  it('shows the B/I/U format buttons only in the editor', () => {
    const editor = mount(ActivityBar, { props: { viewMode: 'editor' } })
    expect(formatButtons(editor)).toHaveLength(3)

    const manuscript = mount(ActivityBar, { props: { viewMode: 'manuscript' } })
    expect(formatButtons(manuscript)).toHaveLength(0)

    const history = mount(ActivityBar, { props: { viewMode: 'history' } })
    expect(formatButtons(history)).toHaveLength(0)
  })

  it('hides Text Options in the manuscript view, keeping Stats', () => {
    const wrapper = mount(ActivityBar, { props: { viewMode: 'manuscript' } })
    const titles = drawerItems(wrapper).map((b) => b.attributes('title'))
    expect(titles).toEqual(['Sections', 'General Options', 'Stats'])
  })

  it('shows only General Options in the history view', () => {
    const wrapper = mount(ActivityBar, { props: { viewMode: 'history' } })
    const titles = drawerItems(wrapper).map((b) => b.attributes('title'))
    expect(titles).toEqual(['General Options'])
  })

  it('marks the active drawer button only when its drawer is open', () => {
    const open = mount(ActivityBar, {
      props: { viewMode: 'editor', activeId: 'chapters', drawerOpen: true },
    })
    const items = drawerItems(open)
    expect(items[0].classes()).toContain('active') // Sections
    expect(items[1].classes()).not.toContain('active')

    // Same activeId but drawer closed → no active highlight.
    const closed = mount(ActivityBar, {
      props: { viewMode: 'editor', activeId: 'chapters', drawerOpen: false },
    })
    expect(drawerItems(closed)[0].classes()).not.toContain('active')
  })

  it('does not mark a hidden button active (Text Options activeId in manuscript)', () => {
    // Text Options is filtered out of manuscript, so even with activeId set to
    // it there is no button to mark — and no stale active state leaks.
    const wrapper = mount(ActivityBar, {
      props: { viewMode: 'manuscript', activeId: 'text-options', drawerOpen: true },
    })
    expect(drawerItems(wrapper).every((b) => !b.classes().includes('active'))).toBe(true)
  })

  it('emits select with the item id on drawer button click', async () => {
    const wrapper = mount(ActivityBar, { props: { viewMode: 'editor' } })
    await drawerItems(wrapper)[1].trigger('click') // General Options
    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')[0]).toEqual(['general-options'])
  })

  it('defaults to the editor view (every drawer button)', () => {
    const wrapper = mount(ActivityBar)
    expect(drawerItems(wrapper)).toHaveLength(4)
  })
})
// --- names and states (SPEC.md 5.7a, S-008 … S-011) --------------------------
//
// A glyph is not a name, and a `title` tooltip is not one either. Both button
// groups therefore carry an `aria-label` beside the tooltip. The format buttons
// stay at `tabindex="-1"`, because a keyboard writer reaches them with Cmd+B,
// Cmd+I and Cmd+U with the caret in the editor.

const formatNames = (wrapper) =>
  formatButtons(wrapper).map((button) => button.attributes('aria-label'))

function pressed(wrapper, name) {
  return formatButtons(wrapper).find((b) => b.attributes('aria-label') === name)?.attributes(
    'aria-pressed',
  )
}

function expanded(wrapper, name) {
  return drawerItems(wrapper).find((b) => b.attributes('aria-label') === name)?.attributes(
    'aria-expanded',
  )
}

describe('ActivityBar semantics', () => {
  it('S-008: names each format button Bold, Italic or Underline', () => {
    const wrapper = mount(ActivityBar, { props: { viewMode: 'editor' } })
    expect(formatNames(wrapper)).toEqual(['Bold', 'Italic', 'Underline'])
  })

  it('S-009: reports each format button pressed state from the live format', () => {
    const wrapper = mount(ActivityBar, {
      props: { viewMode: 'editor', formats: { bold: true, italic: false, underline: true } },
    })

    expect(pressed(wrapper, 'Bold')).toBe('true')
    expect(pressed(wrapper, 'Italic')).toBe('false')
    expect(pressed(wrapper, 'Underline')).toBe('true')
  })

  it('S-010: names each activity icon with its drawer label', () => {
    const wrapper = mount(ActivityBar, { props: { viewMode: 'editor' } })
    const names = drawerItems(wrapper).map((button) => button.attributes('aria-label'))

    expect(names).toEqual(['Sections', 'General Options', 'Text Options', 'Stats'])
  })

  it('S-011: reports which activity icon drawer is open', () => {
    const open = mount(ActivityBar, {
      props: { viewMode: 'editor', activeId: 'stats', drawerOpen: true },
    })
    expect(expanded(open, 'Stats')).toBe('true')
    expect(expanded(open, 'Sections')).toBe('false')

    const closed = mount(ActivityBar, {
      props: { viewMode: 'editor', activeId: 'stats', drawerOpen: false },
    })
    for (const name of ['Sections', 'General Options', 'Text Options', 'Stats']) {
      expect(expanded(closed, name)).toBe('false')
    }
  })
})
