import { test, expect } from '@playwright/test'
import { installTauriIpc } from './helpers/tauri-ipc.js'
import { paragraph, referenceEntry, section } from './helpers/fixtures.js'
import { contrastRatio, TEXT_CONTRAST_FLOOR } from '../src/composables/paperPalette.js'

// The control layer in a real browser (SPEC.md revision 9, S-129 … S-131).
//
// The unit layer can only see which class a component publishes. These three
// ask the questions jsdom cannot answer: how tall and how joined a control is,
// and what colour it actually resolves to. The colour question matters here
// because the reference panel lives on the writer's paper, not the chrome.

const seededDoc = {
  title: 'Control Novel',
  author: 'Author Name',
  authorContact: '',
  hasTOC: false,
  sections: [
    section('c1', 'Chapter One', 'chapter', [
      paragraph('p-c1', 'Izildar Qualen kept the record of the Ashfall.'),
      paragraph('p-c2', 'The square was empty by the second bell.'),
    ]),
  ],
}

const references = {
  entries: [
    referenceEntry('e-qualen', 'character', 'Izildar Qualen', {
      definition: 'The keeper of the Ashfall record.',
    }),
  ],
}

async function openApp(page) {
  await installTauriIpc(page, { doc: seededDoc })
  await page.addInitScript((seed) => {
    window.__tauriMock.route('retrieve_references', () => seed)
  }, references)
  await page.goto('/')
  await page.waitForSelector('.editor-sheet .paragraph', { timeout: 5000 })
}

test('S-129: opens the two add options at the circle’s height, joined to it', async ({ page }) => {
  await openApp(page)

  await page.click('button[title="Sections"]')
  await expect(page.locator('.drawer.left.open .add-btn')).toBeVisible({ timeout: 5000 })
  await page.click('.drawer.left.open .add-btn')
  await expect(page.locator('.drawer.left.open .add-confirm').first()).toBeVisible()

  // The circle scales and the options slide, so the settled box is polled.
  const geometry = () =>
    page.evaluate(() => {
      const read = (node) => {
        const { height, left, right } = node.getBoundingClientRect()
        return { height, left, right }
      }
      return {
        circle: read(document.querySelector('.drawer.left.open .add-btn')),
        options: [...document.querySelectorAll('.drawer.left.open .add-confirm')].map(read),
      }
    })

  await page.mouse.move(0, 0)

  const joined = () =>
    geometry().then(
      (boxes) =>
        boxes.options.length === 2
        && boxes.options[0].left <= boxes.circle.right + 1
        && Math.abs(boxes.options[1].left - boxes.options[0].right) <= 1,
    )
  await expect.poll(joined, { timeout: 3000 }).toBe(true)

  const boxes = await geometry()
  for (const option of boxes.options) {
    expect(Math.abs(option.height - boxes.circle.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(option.height - 32)).toBeLessThanOrEqual(1)
  }
})

/// A custom property keeps the text it was declared with, so an accent
/// authored as a hex is compared as the rgb() the browser paints.
function toRgb(value) {
  const text = value.trim()
  if (!text.startsWith('#')) return text
  const digits = text.length === 4
    ? [...text.slice(1)].map((digit) => digit + digit).join('')
    : text.slice(1)
  return `rgb(${parseInt(digits.slice(0, 2), 16)}, ${parseInt(digits.slice(2, 4), 16)}, ${parseInt(digits.slice(4, 6), 16)})`
}

test('S-130: paints only the chosen segment in the accent', async ({ page }) => {
  await openApp(page)

  const segmentPaint = (selector) =>
    page.evaluate((chosen) => {
      const active = document.querySelector(`${chosen}[aria-selected="true"]`)
      const resting = [...document.querySelectorAll(chosen)].find(
        (node) => node.getAttribute('aria-selected') !== 'true',
      )
      const read = (node) => {
        const style = getComputedStyle(node)
        return { color: style.color, background: style.backgroundColor }
      }
      // The accent the surface publishes, so the assertion follows the theme
      // instead of pinning one preset's value.
      const host = active.closest('.references-view') || active.closest('.app-container')
      return {
        active: read(active),
        resting: read(resting),
        accent: getComputedStyle(host).getPropertyValue('--control-text-active').trim(),
      }
    }, selector)

  const toolbar = await segmentPaint('.view-tabs .view-tab')
  expect(toolbar.active.color).toBe(toRgb(toolbar.accent))
  expect(toolbar.active.background).not.toBe(toolbar.resting.background)
  expect(toolbar.resting.color).not.toBe(toolbar.active.color)

  await page.locator('.view-tab').filter({ hasText: 'References' }).click()
  await expect(page.locator('.surface-tabs')).toBeVisible({ timeout: 5000 })

  // The panel is on the paper, so the chosen surface takes the theme's accent
  // (Mist #B5651D), never the chrome's blue.
  const surfaces = await segmentPaint('.surface-tabs .surface-tab')
  expect(surfaces.active.color).toBe('rgb(181, 101, 29)')
  expect(toRgb(surfaces.accent)).toBe('rgb(181, 101, 29)')
  expect(surfaces.active.background).not.toBe(surfaces.resting.background)
})

test('S-131: paints a control on the References page in the theme ink', async ({ page }) => {
  await openApp(page)

  await page.locator('.view-tab').filter({ hasText: 'References' }).click()
  await expect(page.locator('.surface-tabs')).toBeVisible({ timeout: 5000 })

  const painted = await page.evaluate(() => {
    const control = document.querySelector('.surface-tab[aria-selected="false"]')
    const panel = document.querySelector('.references-view')
    return {
      text: getComputedStyle(control).color,
      border: getComputedStyle(control).borderRightColor,
      paper: getComputedStyle(panel).backgroundColor,
    }
  })

  // The default theme is Mist: paper #D8D3D6 with full ink #515359.
  expect(painted.text).toBe('rgb(81, 83, 89)')
  expect(painted.border.startsWith('rgba(81, 83, 89')).toBe(true)
  expect(contrastRatio(painted.text, painted.paper)).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR)
})

// --- revision 10: the ink a control actually paints -------------------------
//
// Class-level tests passed while every control painted near-white on the
// editor's paper. These read the resolved colour and the surface under it.

/// The colour a control's text is laid on: its own fill composited over every
/// translucent ancestor, over white. A control's own --control-bg is part of
/// the surface its label sits on, so the walk starts at the control itself.
const PAINT_SAMPLER = (selector) => {
  const parse = (value) => {
    const found = /rgba?\(([^)]+)\)/.exec(value)
    if (!found) return null
    const parts = found[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    if (parts.length < 3) return null
    return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 }
  }

  const blend = (over, under, alpha) =>
    over.map((channel, index) => Math.round(channel * alpha + under[index] * (1 - alpha)))

  return [...document.querySelectorAll(selector)].map((node) => {
    const layers = []
    let element = node
    while (element) {
      const colour = parse(getComputedStyle(element).backgroundColor)
      if (colour && colour.a > 0) {
        layers.push(colour)
        if (colour.a === 1) break
      }
      element = element.parentElement
    }
    let surface = [255, 255, 255]
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      surface = blend(layers[index].rgb, surface, layers[index].a)
    }

    const ink = parse(getComputedStyle(node).color)
    const text = ink.a < 1 ? blend(ink.rgb, surface, ink.a) : ink.rgb
    return {
      label: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 30),
      colour: `rgb(${ink.rgb.join(', ')})`,
      surface: `rgb(${surface.join(', ')})`,
      text: `rgb(${text.join(', ')})`,
    }
  })
}

test('S-134: paints the rail and format controls in the writer’s ink', async ({ page }) => {
  await openApp(page)

  const rail = await page.evaluate(PAINT_SAMPLER, '.activity-icons .activity-icon')
  const format = await page.evaluate(PAINT_SAMPLER, '.activity-format .format-btn')
  const chrome = await page.evaluate(() => ({
    border: getComputedStyle(document.querySelector('.format-btn')).borderTopColor,
    secondary: getComputedStyle(document.querySelector('.app-container'))
      .getPropertyValue('--text-secondary')
      .trim(),
  }))

  expect(rail.length).toBeGreaterThanOrEqual(4)
  for (const control of rail) {
    // The default theme is Mist: ink #515359. The chrome's muted ink is
    // rgba(160, 160, 176), which is what revision 9 painted here.
    expect(control.colour, control.label).toBe('rgb(81, 83, 89)')
  }

  expect(format).toHaveLength(3)
  for (const control of format) {
    expect(control.colour, control.label).toBe('rgb(81, 83, 89)')
  }

  // The hairline is the theme's too, not the chrome's white 10%.
  expect(chrome.border).toMatch(/^rgba\(81, 83, 89, 0\.\d+\)$/)

  // Positive control: the app container does publish the muted ink, so the
  // assertions above are not passing because every token went stale.
  expect(chrome.secondary).toBe('#51535999')
})

test('S-135: clears 3:1 between every control and the surface behind it', async ({ page }) => {
  await openApp(page)

  // The chosen state is a separate design question (SPEC.md, open item), so
  // this floor is about the state that regressed: a control at rest.
  const resting = '.activity-icons .activity-icon:not(.active), .activity-format .format-btn, .view-tabs .view-tab:not(.active)'

  const belowFloor = async () => {
    const controls = await page.evaluate(PAINT_SAMPLER, resting)
    return controls
      .map((control) => ({
        control,
        ratio: contrastRatio(control.text, control.surface),
      }))
      .filter((entry) => entry.ratio === null || entry.ratio < 3)
      .map((entry) => `${entry.control.label}: ${entry.control.text} on ${entry.control.surface}`)
  }

  for (const view of ['Editor', 'Manuscript', 'References', 'History']) {
    await page.locator('.view-tab').filter({ hasText: view }).click()

    const controls = await page.evaluate(PAINT_SAMPLER, resting)
    expect(controls.length, view).toBeGreaterThanOrEqual(4)

    // The click starts a 120ms colour transition, so the settled paint is
    // polled rather than sampled mid-fade.
    await expect.poll(belowFloor, { message: view, timeout: 3000 }).toEqual([])
  }
})

test('S-136: the add options emerge from the circle in its own fill', async ({ page }) => {
  await openApp(page)

  await page.click('button[title="Sections"]')
  await expect(page.locator('.drawer.left.open .add-btn')).toBeVisible({ timeout: 5000 })
  await page.click('.drawer.left.open .add-btn')
  await expect(page.locator('.drawer.left.open .add-confirm').first()).toBeVisible()
  await page.mouse.move(0, 0)

  const cluster = () =>
    page.evaluate(() => {
      const read = (node) => {
        const box = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return {
          left: box.left,
          right: box.right,
          height: box.height,
          fill: style.backgroundColor,
          border: style.borderTopColor,
          position: style.position,
          zIndex: style.zIndex,
        }
      }
      return {
        circle: read(document.querySelector('.drawer.left.open .add-btn')),
        options: [...document.querySelectorAll('.drawer.left.open .add-confirm')].map(read),
      }
    })

  // The circle scales under the pointer and the options slide in, so the
  // resting geometry is polled rather than sampled once after the click.
  await expect
    .poll(async () => {
      const boxes = await cluster()
      return boxes.options.length === 2
        && boxes.options[0].left < boxes.circle.right - 8
        // The fill transitions from transparent on mount, so the settled
        // colour is what the join is judged on.
        && boxes.options.every((option) => option.fill === boxes.circle.fill)
    }, { timeout: 3000 })
    .toBe(true)

  const boxes = await cluster()

  // One fill: the options wear the circle's colour, so the join cannot read as
  // a seam or as a panel sitting behind it.
  for (const option of boxes.options) {
    expect(option.fill).toBe(boxes.circle.fill)
    expect(option.border).toBe(boxes.circle.fill)
  }

  // Emerging, not parked: the first option starts under the circle and is
  // covered by it, so its left edge sits inside the circle's own silhouette.
  expect(boxes.options[0].left).toBeLessThan(boxes.circle.left + boxes.circle.height / 2)
  expect(boxes.options[1].left).toBeGreaterThanOrEqual(boxes.options[0].right - 1)
})

test('S-137: keeps a chosen control’s ink when the pointer is over it', async ({ page }) => {
  await openApp(page)

  const colourOf = (selector) =>
    page.evaluate((chosen) => getComputedStyle(document.querySelector(chosen)).color, selector)

  // A chosen control is marked by the accent. The app settles into the editor
  // view after mount, so the chosen paint is polled rather than sampled once.
  const accent = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.app-container'))
      .getPropertyValue('--control-text-active')
      .trim(),
  )
  const activeTab = '.view-tabs .view-tab.active'
  await expect.poll(() => colourOf(activeTab), { timeout: 3000 }).toBe(toRgb(accent))
  const resting = await colourOf(activeTab)

  // A pointer must not turn a chosen control back into plain text, or it reads
  // as unselected under the hand.
  await page.locator(activeTab).hover()
  await expect.poll(() => colourOf(activeTab), { timeout: 3000 }).toBe(resting)

  // The same rule for a chosen rail item.
  await page.locator('button[title="Sections"]').click()
  await expect(page.locator('.drawer.left.open')).toBeVisible({ timeout: 5000 })

  const activeRail = '.activity-icons .activity-icon.active'
  await expect.poll(() => colourOf(activeRail), { timeout: 3000 }).toBe(toRgb(accent))
  const railResting = await colourOf(activeRail)
  await page.locator(activeRail).hover()
  await expect.poll(() => colourOf(activeRail), { timeout: 3000 }).toBe(railResting)
})
