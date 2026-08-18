import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Ruler from './Ruler.vue'

describe('Ruler', () => {
  it('renders ruler track', () => {
    const wrapper = mount(Ruler)
    expect(wrapper.find('.ruler').exists()).toBe(true)
    expect(wrapper.find('.ruler-track').exists()).toBe(true)
  })

  it('generates ticks based on pageWidth', () => {
    const wrapper = mount(Ruler, { props: { pageWidth: 192 } })
    const ticks = wrapper.findAll('.tick')
    expect(ticks.length).toBeGreaterThan(0)
  })

  it('positions left-indent marker at default 0 indent', () => {
    const wrapper = mount(Ruler, { props: { pageWidth: 720, leftIndent: 0 } })
    const leftMarker = wrapper.find('.marker.left-indent')
    expect(leftMarker.exists()).toBe(true)
    expect(leftMarker.attributes('style')).toContain('left: 96px')
  })

  it('positions right-indent marker at default 0 indent', () => {
    const wrapper = mount(Ruler, { props: { pageWidth: 720, rightIndent: 0 } })
    const rightMarker = wrapper.find('.marker.right-indent')
    expect(rightMarker.exists()).toBe(true)
    expect(rightMarker.attributes('style')).toContain('left: 624px')
  })

  it('positions first-line marker relative to left indent', () => {
    const wrapper = mount(Ruler, {
      props: { pageWidth: 720, leftIndent: 0.5, firstLineIndent: 0.3 },
    })
    const firstLineMarker = wrapper.find('.marker.first-line')
    expect(firstLineMarker.exists()).toBe(true)
    // leftPos = 96 + 0.5*96 = 144; firstLinePos = 144 + 0.3*96 = 172.8
    expect(firstLineMarker.attributes('style')).toContain('left: 172.8px')
  })

  it('emits setLeft on track click', async () => {
    const wrapper = mount(Ruler, { props: { pageWidth: 720 } })
    const ruler = wrapper.find('.ruler')
    const rect = ruler.element.getBoundingClientRect()
    await ruler.trigger('click', { clientX: rect.left + 200 })
    expect(wrapper.emitted('setLeft')).toBeTruthy()
  })

  it('does not emit setLeft when clicking a marker', async () => {
    const wrapper = mount(Ruler, { props: { pageWidth: 720 } })
    const marker = wrapper.find('.marker')
    await marker.trigger('click')
    expect(wrapper.emitted('setLeft')).toBeFalsy()
  })

  it('renders all three markers', () => {
    const wrapper = mount(Ruler)
    expect(wrapper.find('.marker.left-indent').exists()).toBe(true)
    expect(wrapper.find('.marker.right-indent').exists()).toBe(true)
    expect(wrapper.find('.marker.first-line').exists()).toBe(true)
  })
})
