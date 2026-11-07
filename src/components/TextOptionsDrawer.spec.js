import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import TextOptionsDrawer from './TextOptionsDrawer.vue'
import { THEMES } from '../constants/themes.js'
import { useTheme } from '../composables/useTheme.js'

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


// --- color controls (SPEC.md 5.13, S-001 … S-006, S-013, S-014) -------------
//
// The rows are drawn from `themes.js`. The test computes the palette the same
// way the component must. It is every distinct color in the theme table, in
// first-appearance order: theme order, then bg, text and accent. A named palette
// position lets a test point at one swatch without depending on markup order.

const PALETTE = []
{
  const seen = new Set()
  for (const theme of THEMES) {
    for (const [field, hex] of [['background', theme.bg], ['text', theme.text], ['accent', theme.accent]]) {
      if (seen.has(hex)) continue
      seen.add(hex)
      PALETTE.push({ hex, theme: theme.name, field })
    }
  }
}

const rows = (wrapper) => wrapper.findAll('.swatch-row')
const row = (wrapper, name) => wrapper.find(`.swatch-row[data-row="${name}"]`)
const swatches = (wrapper, name) => row(wrapper, name).findAll('.color-swatch')
const presets = (wrapper) => wrapper.findAll('.theme-preset')

const realTheme = () => reactive(useTheme(ref('editor')))

function colorProps(overrides = {}) {
  return {
    ...makeProps(),
    theme: {
      ...makeProps().theme,
      themes: THEMES,
      editorBg: THEMES[0].bg,
      editorText: THEMES[0].text,
      editorAccent: THEMES[0].accent,
      matchedPreset: 0,
      selectTheme: vi.fn(),
      selectBackground: vi.fn(),
      selectText: vi.fn(),
      selectAccent: vi.fn(),
    },
    ...overrides,
  }
}

describe('TextOptionsDrawer color controls', () => {
  it('S-001: renders Background, Text and Accent rows, one swatch per distinct color', () => {
    const wrapper = mount(TextOptionsDrawer, { props: colorProps() })

    expect(rows(wrapper).map((r) => r.attributes('data-row'))).toEqual([
      'background',
      'text',
      'accent',
    ])
    for (const name of ['background', 'text', 'accent']) {
      expect(swatches(wrapper, name)).toHaveLength(PALETTE.length)
    }
    // The palette order is the order the colors appear in the theme table.
    expect(swatches(wrapper, 'background')[2].attributes('data-color')).toBe(PALETTE[2].hex)
    expect(swatches(wrapper, 'text')[0].attributes('data-color')).toBe(PALETTE[0].hex)
  })

  it('S-002: renders one preset button per theme, labelled with its name', () => {
    const wrapper = mount(TextOptionsDrawer, { props: colorProps() })

    expect(presets(wrapper).map((b) => b.text())).toEqual(THEMES.map((t) => t.name))
  })

  it('S-004: applies a swatch color on the click, with no confirm control', async () => {
    const wrapper = mount(TextOptionsDrawer, { props: colorProps() })

    expect(swatches(wrapper, 'background').length).toBeGreaterThan(2)

    // Position 0 holds the current background. Positions 1 and 2 hold the text
    // and accent colors, so the guard disables both. Position 3 is the first
    // swatch the guard leaves selectable.
    const target = swatches(wrapper, 'background')[3]
    expect(target.attributes('disabled')).toBeUndefined()
    await target.trigger('click')

    expect(wrapper.props('theme').selectBackground).toHaveBeenCalledWith(PALETTE[3].hex)

    const confirm = wrapper
      .findAll('button')
      .filter((b) => /^(ok|apply|cancel|save)$/i.test(b.text().trim()))
    expect(confirm).toHaveLength(0)
  })

  it('S-005: applies a preset background, text and accent together on one click', async () => {
    const theme = realTheme()
    const wrapper = mount(TextOptionsDrawer, { props: { ...makeProps(), theme } })

    expect(presets(wrapper).length).toBeGreaterThan(2)
    const forest = presets(wrapper).find((b) => b.text() === 'Forest')
    await forest.trigger('click')

    expect(theme.editorBg).toBe(THEMES[2].bg)
    expect(theme.editorText).toBe(THEMES[2].text)
    expect(theme.editorAccent).toBe(THEMES[2].accent)
  })

  it('S-006: marks the matching preset, and no preset for a mixed combination', async () => {
    const theme = realTheme()
    const wrapper = mount(TextOptionsDrawer, { props: { ...makeProps(), theme } })

    const active = () => presets(wrapper).filter((b) => b.classes().includes('active'))
    expect(active()).toHaveLength(1)
    expect(active()[0].text()).toBe('Mist')

    theme.selectBackground(THEMES[4].bg)
    theme.selectText(THEMES[1].text)
    await wrapper.vm.$nextTick()

    expect(active()).toHaveLength(0)
  })

  it('S-013: disables a color already chosen in another row', async () => {
    const props = colorProps()
    const wrapper = mount(TextOptionsDrawer, { props })
    const chosen = THEMES[0].bg

    const inTextRow = row(wrapper, 'text').find(`[data-color="${chosen}"]`)
    const inAccentRow = row(wrapper, 'accent').find(`[data-color="${chosen}"]`)
    expect(inTextRow.exists()).toBe(true)
    expect(inTextRow.attributes('disabled')).toBeDefined()
    expect(inAccentRow.attributes('disabled')).toBeDefined()

    await inTextRow.trigger('click')
    expect(props.theme.selectText).not.toHaveBeenCalled()

    // A color free in the other rows stays selectable.
    const free = PALETTE.find((entry) => ![THEMES[0].bg, THEMES[0].text, THEMES[0].accent].includes(entry.hex))
    const freeSwatch = row(wrapper, 'text').find(`[data-color="${free.hex}"]`)
    expect(freeSwatch.attributes('disabled')).toBeUndefined()
  })

  it('S-014: names each swatch by row, source theme and role, and marks the chosen one in each row', () => {
    const wrapper = mount(TextOptionsDrawer, { props: colorProps() })

    expect(swatches(wrapper, 'background')).toHaveLength(PALETTE.length)
    expect(swatches(wrapper, 'text')).toHaveLength(PALETTE.length)
    expect(swatches(wrapper, 'background')[0].attributes('aria-label')).toBe(
      `Background ${PALETTE[0].theme} ${PALETTE[0].field}`,
    )
    expect(swatches(wrapper, 'text')[0].attributes('aria-label')).toBe(
      `Text ${PALETTE[0].theme} ${PALETTE[0].field}`,
    )

    // Three colors come from each theme, so the role has to be in the name for
    // every swatch in a row to have its own.
    const labels = swatches(wrapper, 'background').map((s) => s.attributes('aria-label'))
    expect(new Set(labels).size).toBe(labels.length)

    for (const [name, chosen] of [
      ['background', THEMES[0].bg],
      ['text', THEMES[0].text],
      ['accent', THEMES[0].accent],
    ]) {
      const marked = swatches(wrapper, name).filter(
        (s) => s.attributes('aria-current') === 'true',
      )
      expect(marked).toHaveLength(1)
      expect(marked[0].attributes('data-color')).toBe(chosen)
    }
  })
})
