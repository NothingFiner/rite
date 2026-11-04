import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'

// The thesaurus popover (SPEC.md S-022 … S-030).
//
// The rules under test are the user's, not a designer's: clicking a synonym only
// MARKS it, and the document changes on OK and on nothing else. Cancel, Escape
// and a click outside are always a no-op.
//
// Two senses of "light" so sense grouping is visible in the fixture: an
// adjective with a synonym and an antonym, and a noun with neither.

import ThesaurusPopover from './ThesaurusPopover.vue'

const SENSES = [
  {
    partOfSpeech: 'adjective',
    senseNumber: 1,
    gloss: 'of comparatively little physical weight or density',
    synonyms: ['glad', 'cheerful'],
    antonyms: ['sad'],
  },
  {
    partOfSpeech: 'noun',
    senseNumber: 2,
    gloss: 'the quality of being luminous',
    synonyms: ['visible light'],
    antonyms: [],
  },
]

let wrapper = null

function mountPopover(props = {}) {
  wrapper = mount(ThesaurusPopover, {
    attachTo: document.body,
    props: {
      visible: true,
      word: 'Happy,',
      senses: SENSES,
      loading: false,
      error: '',
      x: 120,
      y: 80,
      ...props,
    },
  })
  return wrapper
}

function synonymButtons() {
  return wrapper.findAll('button.thesaurus-synonym')
}

function findByText(selector, text) {
  return wrapper.findAll(selector).find((button) => button.text() === text)
}

beforeEach(() => {
  wrapper = null
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('the thesaurus popover', () => {
  it('S-022: shows the word and one group per sense at the click point', () => {
    mountPopover()

    expect(wrapper.find('.thesaurus-word').text()).toBe('Happy,')

    const groups = wrapper.findAll('.thesaurus-sense')
    expect(groups).toHaveLength(2)
    expect(groups[0].find('.thesaurus-pos').text()).toContain('adjective')
    expect(groups[0].find('.thesaurus-gloss').text()).toContain('little physical weight')
    expect(groups[1].find('.thesaurus-pos').text()).toContain('noun')
    expect(groups[1].find('.thesaurus-gloss').text()).toContain('luminous')

    const root = wrapper.find('.thesaurus-popover')
    expect(root.element.style.position).toBe('fixed')
    expect(root.element.style.left).toBe('120px')
    expect(root.element.style.top).toBe('80px')
  })

  it('S-023: lists synonyms per sense and antonyms only where there are any', () => {
    mountPopover()

    const groups = wrapper.findAll('.thesaurus-sense')
    const firstSynonyms = groups[0].findAll('button.thesaurus-synonym')
    expect(firstSynonyms.map((button) => button.text())).toEqual(['glad', 'cheerful'])
    expect(groups[1].findAll('button.thesaurus-synonym').map((b) => b.text())).toEqual([
      'visible light',
    ])

    const firstAntonyms = groups[0].find('.thesaurus-antonyms')
    expect(firstAntonyms.exists()).toBe(true)
    expect(firstAntonyms.text()).toContain('Antonyms')
    expect(firstAntonyms.text()).toContain('sad')

    expect(
      groups[1].find('.thesaurus-antonyms').exists(),
      'a sense with no antonyms shows no antonyms line'
    ).toBe(false)
  })

  it('S-024: OK stays disabled until a synonym is marked', async () => {
    mountPopover()

    const ok = wrapper.find('button.thesaurus-ok')
    expect(ok.attributes('disabled')).toBeDefined()

    await synonymButtons()[0].trigger('click')

    expect(wrapper.find('button.thesaurus-ok').attributes('disabled')).toBeUndefined()
  })

  it('S-025: marking a second synonym moves the mark instead of adding one', async () => {
    mountPopover()

    await synonymButtons()[0].trigger('click')
    await synonymButtons()[1].trigger('click')

    const marked = synonymButtons().filter(
      (button) => button.attributes('aria-pressed') === 'true'
    )
    expect(marked).toHaveLength(1)
    expect(marked[0].text()).toBe('cheerful')
  })

  it('S-026: OK emits the marked synonym shaped like the original word', async () => {
    mountPopover()

    await findByText('button.thesaurus-synonym', 'glad').trigger('click')
    await wrapper.find('button.thesaurus-ok').trigger('click')

    const applied = wrapper.emitted('apply')
    expect(applied).toHaveLength(1)
    expect(applied[0]).toEqual(['Glad,'])
  })

  it('S-027: cancel, Escape and a click outside close without applying', async () => {
    mountPopover()

    await findByText('button.thesaurus-synonym', 'glad').trigger('click')
    await wrapper.find('button.thesaurus-cancel').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('cancel')).toHaveLength(2)

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(wrapper.emitted('cancel')).toHaveLength(3)

    expect(wrapper.emitted('apply')).toBeUndefined()
  })

  it('S-028: with no senses it says so and offers no OK', () => {
    mountPopover({ senses: [] })

    expect(wrapper.find('.thesaurus-empty').text()).toBe('No synonyms found')
    expect(wrapper.find('button.thesaurus-ok').exists()).toBe(false)
  })

  it('S-029: a failed lookup shows the error line and keeps the popover open', () => {
    mountPopover({ error: 'thesaurus lookup failed', senses: [] })

    expect(wrapper.find('.thesaurus-error').text()).toContain('thesaurus lookup failed')
    expect(wrapper.find('.thesaurus-popover').exists()).toBe(true)
  })

  it('S-036: two rules separate the word and the actions from the scrolling list', () => {
    mountPopover()

    const root = wrapper.find('.thesaurus-popover')
    const separators = root.findAll('hr.thesaurus-separator')
    expect(separators).toHaveLength(2)

    const order = Array.from(root.element.children).map((child) =>
      child.classList.contains('thesaurus-word')
        ? 'word'
        : child.tagName === 'HR'
          ? 'rule'
          : child.classList.contains('thesaurus-senses')
            ? 'senses'
            : child.classList.contains('thesaurus-actions')
              ? 'actions'
              : 'other'
    )
    // word, rule, senses, rule, actions — the rules hold the scroll area in.
    expect(order.filter((item) => item === 'other')).toEqual([])
    expect(order).toEqual(['word', 'rule', 'senses', 'rule', 'actions'])
  })

  it('S-030: a lookup in flight shows loading and no sense groups', () => {
    mountPopover({ loading: true, senses: [] })

    expect(wrapper.find('.thesaurus-loading').exists()).toBe(true)
    expect(wrapper.findAll('.thesaurus-sense')).toHaveLength(0)
  })
})
