import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LlmPanel from './LlmPanel.vue'

// The assistant's Feedback Target list (SPEC.md 5.17, S-008). The panel is a
// dumb surface: these are the minimum props it needs to render the select.

const chat = {
  input: '',
  messages: [],
  scope: 'section',
  effectiveScope: 'section',
  selectedRoleName: 'Critic',
  retrievalError: '',
  send: () => {},
  clear: () => {},
  setRole: () => {},
  buildContextMessages: (input) => [{ role: 'user', content: input || '' }],
}

const settings = { settings: { model: 'llama3', contextLength: 8192 } }

const manager = {
  tabs: [{ id: 't1', label: 'Assistant' }],
  activeId: 't1',
  selectSession: () => {},
  closeSession: () => {},
  createSession: () => {},
  stopActive: () => {},
}

function scopeOptions() {
  const wrapper = mount(LlmPanel, {
    props: {
      chat,
      settings,
      manager,
      roles: [{ name: 'Critic', description: 'Points at what is not working.' }],
      busy: false,
    },
  })
  return wrapper.findAll('.llm-scope-select option')
}

describe('LlmPanel Feedback Target', () => {
  it('S-008: offers a Notes scope beside Summaries', () => {
    const values = scopeOptions().map((option) => option.attributes('value'))

    expect(values).toContain('notes')
    expect(values.indexOf('notes')).toBe(values.indexOf('summaries') + 1)
  })

  it('S-008: labels the Notes scope for the writer', () => {
    const notes = scopeOptions().find((option) => option.attributes('value') === 'notes')

    expect(notes).toBeDefined()
    expect(notes.text()).toMatch(/notes/i)
  })
})
