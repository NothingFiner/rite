import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TextOptionsDrawer from './TextOptionsDrawer.vue'

// TextOptionsDrawer is a thin control surface: it shows the CURRENT margin,
// zoom, font and manuscript format, and calls the matching setter on the
// composable it was handed. It owns no state of its own, so every test here is
// "the writer's click reaches the setter" or "the active value is marked".

function makeProps(overrides = {}) {
  return {
    open: false,
    theme: {
      editorMargin: 'compact',
      editorZoom: 16,
      setMargin: vi.fn(),
      setZoom: vi.fn(),
    },
    format: {
      editorFont: "'Inter', sans-serif",
      fontOptions: [
        { label: 'Inter', family: "'Inter', sans-serif" },
        { label: 'Georgia', family: "'Georgia', serif" },
      ],
      setFont: vi.fn(),
    },
    manuscriptFormat: {
      formatId: 'standard',
      formats: [
        { id: 'standard', name: 'Standard' },
        { id: 'shunn', name: 'Shunn' },
        { id: 'a4', name: 'A4' },
      ],
      selectFormat: vi.fn(),
    },
    ...overrides,
  }
}

describe('TextOptionsDrawer', () => {
  it('stays closed until `open` is true', async () => {
    const wrapper = mount(TextOptionsDrawer, { props: makeProps() })

    expect(wrapper.find('.drawer').classes()).not.toContain('open')

    await wrapper.setProps({ open: true })
    expect(wrapper.find('.drawer').classes()).toContain('open')
  })

  it('marks the current margin and switches it on click', async () => {
    const props = makeProps()
    const wrapper = mount(TextOptionsDrawer, { props })
    const buttons = wrapper.findAll('.zoom-row')[0].findAll('.zoom-btn')

    expect(buttons[0].classes()).toContain('active')
    expect(buttons[1].classes()).not.toContain('active')

    await buttons[1].trigger('click')

    expect(props.theme.setMargin).toHaveBeenCalledWith('manuscript')
  })

  it('marks the current zoom and switches it on click', async () => {
    const props = makeProps()
    const wrapper = mount(TextOptionsDrawer, { props })
    const zoomButtons = wrapper.findAll('.zoom-row')[1].findAll('.zoom-btn')

    expect(zoomButtons.map((b) => b.text())).toEqual(['12pt', '16pt', '20pt'])
    expect(zoomButtons[1].classes()).toContain('active')

    await zoomButtons[2].trigger('click')

    expect(props.theme.setZoom).toHaveBeenCalledWith(20)
  })

  it('lists the available fonts with the current one selected', () => {
    const wrapper = mount(TextOptionsDrawer, { props: makeProps() })
    const select = wrapper.findAll('select')[0]

    expect(select.element.value).toBe("'Inter', sans-serif")
    expect(select.findAll('option').map((o) => o.text())).toEqual(['Inter', 'Georgia'])
  })

  it('applies a newly chosen font', async () => {
    const props = makeProps()
    const wrapper = mount(TextOptionsDrawer, { props })
    const select = wrapper.findAll('select')[0]

    select.element.value = "'Georgia', serif"
    await select.trigger('change')

    expect(props.format.setFont).toHaveBeenCalledWith("'Georgia', serif")
  })

  it('shows the active manuscript format and switches it', async () => {
    const props = makeProps()
    const wrapper = mount(TextOptionsDrawer, { props })
    const select = wrapper.findAll('select')[1]

    expect(select.element.value).toBe('standard')
    expect(select.findAll('option').map((o) => o.text())).toEqual(['Standard', 'Shunn', 'A4'])

    select.element.value = 'shunn'
    await select.trigger('change')

    expect(props.manuscriptFormat.selectFormat).toHaveBeenCalledWith('shunn')
  })

  it('calls nothing merely by being rendered', () => {
    const props = makeProps()
    mount(TextOptionsDrawer, { props })

    expect(props.theme.setMargin).not.toHaveBeenCalled()
    expect(props.theme.setZoom).not.toHaveBeenCalled()
    expect(props.format.setFont).not.toHaveBeenCalled()
    expect(props.manuscriptFormat.selectFormat).not.toHaveBeenCalled()
  })
})
