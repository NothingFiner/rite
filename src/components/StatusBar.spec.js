import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusBar from './StatusBar.vue'

describe('StatusBar', () => {
  it('renders with default props', () => {
    const wrapper = mount(StatusBar)
    expect(wrapper.find('.statusbar').exists()).toBe(true)
  })

  // SPEC.md 5.13 S-003. Color moved to the Text Options drawer, so the bar has
  // no swatch, no tooltip and no theme props to hand it.
  it('S-003: renders no color swatch and no color picker', () => {
    const wrapper = mount(StatusBar)
    expect(wrapper.find('.theme-swatch').exists()).toBe(false)
    expect(wrapper.find('.theme-picker').exists()).toBe(false)
    expect(wrapper.find('.theme-tooltip').exists()).toBe(false)
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
