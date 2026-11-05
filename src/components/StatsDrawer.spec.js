import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatsDrawer from './StatsDrawer.vue'

function mountWith(props) {
  return mount(StatsDrawer, { props })
}

const fillPercent = (wrapper) => {
  const fill = wrapper.find('.stats-bar-fill')
  expect(fill.exists()).toBe(true)
  return Number.parseFloat(fill.attributes('style').match(/width:\s*([\d.]+)%/)[1])
}

describe('StatsDrawer', () => {
  it('S-012: should cap the bar fill at 100% when progress exceeds the target', () => {
    const wrapper = mountWith({ written: 1500, target: 1000 })
    expect(fillPercent(wrapper)).toBe(100)
  })

  it('S-012: should fill the bar proportionally when progress is under the target', () => {
    const wrapper = mountWith({ written: 250, target: 1000 })
    expect(fillPercent(wrapper)).toBe(25)
  })

  it('S-013: should label the graph "N written of M"', () => {
    const wrapper = mountWith({ written: 250, target: 1000 })
    const graph = wrapper.find('[role="img"]')
    expect(graph.exists()).toBe(true)
    expect(graph.attributes('aria-label')).toBe('250 written of 1000')
  })

  it('S-013: should keep the real number in the label when progress exceeds the target', () => {
    // The fill caps; the number does not. A writer who wrote 1500 of 1000 should
    // read 1500, not a number clipped to the bar.
    const wrapper = mountWith({ written: 1500, target: 1000 })
    const graph = wrapper.find('[role="img"]')
    expect(graph.exists()).toBe(true)
    expect(graph.attributes('aria-label')).toBe('1500 written of 1000')
  })

  it('S-014: should hide the graph and prompt for a target when none is set', () => {
    const wrapper = mountWith({ written: 250, target: null })
    expect(wrapper.find('[role="img"]').exists()).toBe(false)
    expect(wrapper.text()).toMatch(/set a (daily )?(word )?target/i)
  })

  it('S-014: should offer a field to enter the target when none is set', () => {
    const wrapper = mountWith({ written: 0, target: null })
    expect(wrapper.find('input').exists()).toBe(true)
  })
})
