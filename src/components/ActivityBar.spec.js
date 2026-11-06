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