import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusBar from './StatusBar.vue'

describe('StatusBar', () => {
  const defaultThemes = [
    { bg: '#D8D3D6', text: '#515359' },
    { bg: '#EDD1B0', text: '#664B47' },
  ]

  it('renders with default props', () => {
    const wrapper = mount(StatusBar)
    expect(wrapper.find('.statusbar').exists()).toBe(true)
  })

  it('renders current theme swatch', () => {
    const wrapper = mount(StatusBar, {
      props: { theme: 0, themes: defaultThemes },
    })
    const swatch = wrapper.find('.theme-swatch.current')
    expect(swatch.exists()).toBe(true)
    expect(swatch.attributes('style')).toContain('background: rgb(216, 211, 214)')
  })

  it('does not crash with out-of-bounds theme index', () => {
    const wrapper = mount(StatusBar, {
      props: { theme: 99, themes: defaultThemes },
    })
    expect(wrapper.find('.statusbar').exists()).toBe(true)
    const swatch = wrapper.find('.theme-swatch.current')
    expect(swatch.exists()).toBe(true)
  })

  it('does not crash with empty themes array', () => {
    const wrapper = mount(StatusBar, {
      props: { theme: 0, themes: [] },
    })
    expect(wrapper.find('.statusbar').exists()).toBe(true)
  })

  it('shows theme picker when showThemePicker is true', () => {
    const wrapper = mount(StatusBar, {
      props: { theme: 0, themes: defaultThemes, showThemePicker: true },
    })
    expect(wrapper.find('.theme-tooltip').exists()).toBe(true)
    expect(wrapper.findAll('.theme-swatch').length).toBe(defaultThemes.length + 1) // +1 for current
  })

  it('emits selectTheme on swatch click', async () => {
    const wrapper = mount(StatusBar, {
      props: { theme: 0, themes: defaultThemes, showThemePicker: true },
    })
    // Index 1 is the first theme swatch inside the tooltip (v-for i=0)
    await wrapper.findAll('.theme-swatch')[1].trigger('click')
    expect(wrapper.emitted('selectTheme')).toBeTruthy()
    expect(wrapper.emitted('selectTheme')[0]).toEqual([0])
  })
  // SPEC.md S-012..S-015 - what the left-hand side of the status bar shows.
  //
  // The document title and the filename are two different facts now that the
  // title is independent of the file it lives in, so both are shown. The
  // component owns this rendering: it is handed a title and a basename and
  // decides what to print, including the `Untitled` fallback for a document
  // with no title yet.
  describe('title and filename (SPEC S-012..S-015)', () => {
    const left = (wrapper) => wrapper.find('.status-left').text()

    it('S-012: shows the document title', () => {
      const wrapper = mount(StatusBar, { props: { title: 'Chapter One' } })

      expect(left(wrapper)).toContain('Chapter One')
    })

    it('S-013: shows the basename of the current file, with its extension', () => {
      const wrapper = mount(StatusBar, {
        props: { title: 'Chapter One', fileName: 'novel.rite' },
      })

      expect(left(wrapper)).toContain('novel.rite')
    })

    it('S-014: shows no filename when the document has no path', () => {
      const wrapper = mount(StatusBar, { props: { title: 'Chapter One', fileName: '' } })

      expect(left(wrapper)).toContain('Chapter One')
      // No leftover placeholder: an unsaved document has no filename to show,
      // and the full path is never shown either.
      expect(left(wrapper)).not.toMatch(/\.rite\b/)
      expect(left(wrapper)).not.toMatch(/\//)
    })

    it('S-015: shows Untitled when the document has no title', () => {
      const wrapper = mount(StatusBar, { props: { title: '' } })

      expect(left(wrapper)).toContain('Untitled')
    })
  })
})
