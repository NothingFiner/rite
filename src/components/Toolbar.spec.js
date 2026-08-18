import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Toolbar from './Toolbar.vue'

describe('Toolbar', () => {
  it('renders toolbar', () => {
    const wrapper = mount(Toolbar)
    expect(wrapper.find('.toolbar').exists()).toBe(true)
    expect(wrapper.find('.brand-text').text()).toBe('rite')
  })

  it('editor button is active in editor mode', () => {
    const wrapper = mount(Toolbar, { props: { mode: 'editor' } })
    const buttons = wrapper.findAll('.tool-btn')
    expect(buttons[0].classes()).toContain('active')
    expect(buttons[1].classes()).not.toContain('active')
  })

  it('manuscript button is active in manuscript mode', () => {
    const wrapper = mount(Toolbar, { props: { mode: 'manuscript' } })
    const buttons = wrapper.findAll('.tool-btn')
    expect(buttons[0].classes()).not.toContain('active')
    expect(buttons[1].classes()).toContain('active')
  })

  it('emits setMode on editor button click', async () => {
    const wrapper = mount(Toolbar)
    await wrapper.findAll('.tool-btn')[0].trigger('click')
    expect(wrapper.emitted('setMode')).toBeTruthy()
    expect(wrapper.emitted('setMode')[0]).toEqual(['editor'])
  })

  it('emits setMode on manuscript button click', async () => {
    const wrapper = mount(Toolbar)
    await wrapper.findAll('.tool-btn')[1].trigger('click')
    expect(wrapper.emitted('setMode')).toBeTruthy()
    expect(wrapper.emitted('setMode')[0]).toEqual(['manuscript'])
  })

  it('emits toggleRight on drawer toggle click', async () => {
    const wrapper = mount(Toolbar, { props: { rightOpen: false } })
    await wrapper.find('.drawer-toggle').trigger('click')
    expect(wrapper.emitted('toggleRight')).toBeTruthy()
  })

  it('shows drawer toggle as active when rightOpen is true', () => {
    const wrapper = mount(Toolbar, { props: { rightOpen: true } })
    expect(wrapper.find('.drawer-toggle').classes()).toContain('active')
  })

  it('defaults mode to editor', () => {
    const wrapper = mount(Toolbar)
    const buttons = wrapper.findAll('.tool-btn')
    expect(buttons[0].classes()).toContain('active')
  })

  it('defaults rightOpen to false', () => {
    const wrapper = mount(Toolbar)
    expect(wrapper.find('.drawer-toggle').classes()).not.toContain('active')
  })
})
