import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SearchPanel from './SearchPanel.vue'

describe('SearchPanel', () => {
  function factory(props = {}, emits = {}) {
    return mount(SearchPanel, {
      props: { visible: true, ...props },
      attachTo: document.body,
    })
  }

  it('renders when visible', () => {
    const wrapper = factory()
    expect(wrapper.find('.search-panel').exists()).toBe(true)
    expect(wrapper.find('input[placeholder="Find..."]').exists()).toBe(true)
  })

  it('does not render when not visible', () => {
    const wrapper = factory({ visible: false })
    expect(wrapper.find('.search-panel').exists()).toBe(false)
  })

  it('emits update:query on input', async () => {
    const wrapper = factory()
    const input = wrapper.find('input[placeholder="Find..."]')
    await input.setValue('hello')
    expect(wrapper.emitted('update:query')).toBeTruthy()
    expect(wrapper.emitted('update:query')[0]).toEqual(['hello'])
  })

  it('emits findNext on Enter', async () => {
    const wrapper = factory()
    const input = wrapper.find('input[placeholder="Find..."]')
    await input.trigger('keydown.enter')
    expect(wrapper.emitted('findNext')).toBeTruthy()
  })

  it('emits findPrev on Shift+Enter', async () => {
    const wrapper = factory()
    const input = wrapper.find('input[placeholder="Find..."]')
    await input.trigger('keydown.shift.enter')
    expect(wrapper.emitted('findPrev')).toBeTruthy()
  })

  it('shows match count', () => {
    const wrapper = factory({ query: 'test', matchCount: 5, currentIndex: 2 })
    expect(wrapper.find('.match-count').text()).toBe('3/5')
  })

  it('shows 0/0 when no matches', () => {
    const wrapper = factory({ query: 'test', matchCount: 0, currentIndex: -1 })
    expect(wrapper.find('.match-count').text()).toBe('0/0')
  })

  it('shows empty match count when no query', () => {
    const wrapper = factory({ query: '', matchCount: 0 })
    expect(wrapper.find('.match-count').text()).toBe('')
  })

  it('emits findNext on down arrow button', async () => {
    const wrapper = factory()
    await wrapper.find('button[title="Next"]').trigger('click')
    expect(wrapper.emitted('findNext')).toBeTruthy()
  })

  it('emits findPrev on up arrow button', async () => {
    const wrapper = factory()
    await wrapper.find('button[title="Previous"]').trigger('click')
    expect(wrapper.emitted('findPrev')).toBeTruthy()
  })

  it('toggles replace row', async () => {
    const wrapper = factory()
    expect(wrapper.find('.replace-row').exists()).toBe(false)
    await wrapper.find('button[title="Toggle Replace"]').trigger('click')
    expect(wrapper.emitted('update:showReplace')).toBeTruthy()
    expect(wrapper.emitted('update:showReplace')[0]).toEqual([true])
  })

  it('shows replace row when showReplace is true', () => {
    const wrapper = factory({ showReplace: true })
    expect(wrapper.find('.replace-row').exists()).toBe(true)
    expect(wrapper.find('input[placeholder="Replace..."]').exists()).toBe(true)
  })

  it('emits replace on Replace button click', async () => {
    const wrapper = factory({ showReplace: true })
    const buttons = wrapper.findAll('button')
    const replaceBtn = buttons.find(b => b.text() === 'Replace')
    await replaceBtn.trigger('click')
    expect(wrapper.emitted('replace')).toBeTruthy()
  })

  it('emits replaceAll on Replace All button click', async () => {
    const wrapper = factory({ showReplace: true })
    const buttons = wrapper.findAll('button')
    const replaceAllBtn = buttons.find(b => b.text() === 'Replace All')
    await replaceAllBtn.trigger('click')
    expect(wrapper.emitted('replaceAll')).toBeTruthy()
  })

  it('emits close on close button click', async () => {
    const wrapper = factory()
    await wrapper.find('button[title="Close"]').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
