import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import LlmPanel from './LlmPanel.vue'
import { PRESETS } from '../composables/useChat.js'

// The Assistant panel: chat tabs, role selection, the transcript, the composer,
// the feedback-target scope, the slash-command autocomplete and the
// clear-conversation two-step. It is a dumb surface — it calls `chat` and
// `manager` and renders what they expose — so the tests drive those and assert
// the resulting DOM.

function makeChat(overrides = {}) {
  return {
    input: '',
    messages: [],
    scope: 'section',
    effectiveScope: 'section',
    selectedRoleName: '',
    retrievalError: '',
    send: vi.fn(),
    clear: vi.fn(),
    setRole: vi.fn(),
    buildContextMessages: (input) => [{ role: 'user', content: input || '' }],
    ...overrides,
  }
}

function makeManager(overrides = {}) {
  return {
    tabs: [
      { id: 't1', label: 'Assistant' },
      { id: 't2', label: 'Critic' },
    ],
    activeId: 't1',
    selectSession: vi.fn(),
    closeSession: vi.fn(),
    createSession: vi.fn(),
    stopActive: vi.fn(),
    ...overrides,
  }
}

function makeSettings(overrides = {}) {
  return { settings: { model: 'llama3', contextLength: 8192, ...overrides } }
}

const roles = [
  { name: 'Critic', description: 'Points at what is not working.' },
  { name: 'Poet', description: 'Listens for the music.' },
]

function mountPanel(props = {}) {
  return mount(LlmPanel, {
    props: {
      chat: makeChat(),
      settings: makeSettings(),
      manager: makeManager(),
      roles,
      busy: false,
      ...props,
    },
  })
}

describe('LlmPanel', () => {
  describe('chat tabs', () => {
    it('renders one tab per session and marks the active one', () => {
      const wrapper = mountPanel()
      const tabs = wrapper.findAll('.llm-tab:not(.llm-tab-new)')

      expect(tabs.map((t) => t.find('.llm-tab-label').text())).toEqual(['Assistant', 'Critic'])
      expect(tabs[0].classes()).toContain('active')
      expect(tabs[1].classes()).not.toContain('active')
    })

    it('selects a session when its tab is clicked', async () => {
      const manager = makeManager()
      const wrapper = mountPanel({ manager })

      await wrapper.findAll('.llm-tab:not(.llm-tab-new)')[1].trigger('click')

      expect(manager.selectSession).toHaveBeenCalledWith('t2')
    })

    it('offers a close control only when there is more than one tab', () => {
      expect(mountPanel().findAll('.llm-tab-close')).toHaveLength(2)

      const single = mountPanel({ manager: makeManager({ tabs: [{ id: 't1', label: 'Assistant' }] }) })
      expect(single.find('.llm-tab-close').exists()).toBe(false)
    })

    it('closes a tab without also selecting it', async () => {
      const manager = makeManager()
      const wrapper = mountPanel({ manager })

      await wrapper.findAll('.llm-tab-close')[1].trigger('click')

      expect(manager.closeSession).toHaveBeenCalledWith('t2')
      expect(manager.selectSession).not.toHaveBeenCalled()
    })

    it('creates a session from the + tab', async () => {
      const manager = makeManager()
      const wrapper = mountPanel({ manager })

      await wrapper.find('.llm-tab-new').trigger('click')

      expect(manager.createSession).toHaveBeenCalled()
    })
  })

  describe('role selection', () => {
    it('lists the roles with a disabled placeholder', () => {
      const wrapper = mountPanel()
      const options = wrapper.findAll('.llm-role-select option')

      expect(options[0].attributes('disabled')).toBeDefined()
      expect(options.map((o) => o.text())).toEqual(['Select a role…', 'Critic', 'Poet'])
    })

    it('sets the role object rather than the bare name', async () => {
      const chat = makeChat()
      const wrapper = mountPanel({ chat })
      const select = wrapper.find('.llm-role-select')

      select.element.value = 'Poet'
      await select.trigger('change')

      expect(chat.setRole).toHaveBeenCalledWith(roles[1])
    })

    it('shows the selected role’s description', () => {
      const wrapper = mountPanel({ chat: makeChat({ selectedRoleName: 'Critic' }) })

      expect(wrapper.find('.llm-role-desc').text()).toBe('Points at what is not working.')
    })

    it('shows no description when the role is unknown', () => {
      const wrapper = mountPanel({ chat: makeChat({ selectedRoleName: 'Ghost' }) })

      expect(wrapper.find('.llm-role-desc').exists()).toBe(false)
    })
  })

  describe('empty states and placeholders', () => {
    it('points at General Options when no model is configured', async () => {
      const wrapper = mountPanel({ settings: { settings: { model: '', contextLength: 8192 } } })

      expect(wrapper.text()).toContain('Configure the AI assistant in General Options → AI Assistant.')
      expect(wrapper.find('.llm-input').attributes('placeholder')).toBe(
        'Configure a model in General Options…',
      )

      await wrapper.find('.llm-empty-btn').trigger('click')
      expect(wrapper.emitted('openSettings')).toHaveLength(1)
    })

    it('asks for a role when the model is set but no role is chosen', () => {
      const wrapper = mountPanel()

      expect(wrapper.text()).toContain('Pick a role above, then type a question.')
      expect(wrapper.find('.llm-input').attributes('placeholder')).toBe('Select a role first…')
    })

    it('invites a question once model and role are both set', () => {
      const wrapper = mountPanel({ chat: makeChat({ selectedRoleName: 'Critic' }) })

      expect(wrapper.text()).toContain('Ask the assistant about your manuscript, or type / for commands.')
      expect(wrapper.find('.llm-input').attributes('placeholder')).toContain('Shift+Enter for newline')
    })
  })

  describe('transcript', () => {
    it('renders user text as text and assistant markdown as sanitized HTML', () => {
      const wrapper = mountPanel({
        chat: makeChat({
          messages: [
            { role: 'user', content: 'What do you think of **this**?' },
            { role: 'assistant', content: '**Strong** opening.' },
          ],
        }),
      })

      const messages = wrapper.findAll('.llm-message')
      expect(messages[0].text()).toContain('What do you think of **this**?')
      expect(messages[1].find('strong').text()).toBe('Strong')
      expect(messages[1].text()).toContain('opening.')
    })

    it('strips dangerous attributes and elements from assistant output', () => {
      const wrapper = mountPanel({
        chat: makeChat({
          messages: [
            {
              role: 'assistant',
              content: '<img src="x" onerror="alert(1)"><script>alert(2)</script>hi',
            },
          ],
        }),
      })

      // DOMPurify keeps harmless markup, so the assertion is about the
      // dangerous parts: no event handler survives, and no script/iframe does.
      expect(wrapper.find('.llm-message img').attributes('onerror')).toBeUndefined()
      expect(wrapper.find('.llm-message script').exists()).toBe(false)
      expect(wrapper.find('.llm-message').element.innerHTML).not.toContain('alert(1)')
      expect(wrapper.find('.llm-message').text()).toContain('hi')
    })

    it('shows a typing cursor while a reply is still streaming', () => {
      const wrapper = mountPanel({
        chat: makeChat({
          messages: [
            { role: 'assistant', content: '', streaming: true },
            { role: 'assistant', content: 'Done.', streaming: true },
          ],
        }),
      })

      expect(wrapper.findAll('.llm-cursor')).toHaveLength(2)
    })

    it('marks an error bubble', () => {
      const wrapper = mountPanel({
        chat: makeChat({ messages: [{ role: 'assistant', content: 'Boom', error: true }] }),
      })

      expect(wrapper.find('.llm-bubble').classes()).toContain('error')
    })
  })

  describe('composer', () => {
    it('disables Send until there is text', async () => {
      const wrapper = mountPanel()
      const send = wrapper.find('.llm-send-btn')

      expect(send.attributes('disabled')).toBeDefined()

      await wrapper.find('.llm-input').setValue('What is pacing?')
      expect(send.attributes('disabled')).toBeUndefined()
    })

    it('sends on the button and on Enter', async () => {
      const chat = makeChat()
      const wrapper = mountPanel({ chat })
      const input = wrapper.find('.llm-input')

      await input.setValue('One')
      await wrapper.find('.llm-send-btn').trigger('click')
      expect(chat.send).toHaveBeenCalledTimes(1)

      await input.trigger('keydown', { key: 'Enter' })
      expect(chat.send).toHaveBeenCalledTimes(2)
    })

    it('shows Stop and refuses to send while another tab is generating', async () => {
      const chat = makeChat({ input: 'queued' })
      const manager = makeManager()
      const wrapper = mountPanel({ chat, manager, busy: true })
      const input = wrapper.find('.llm-input')

      expect(wrapper.find('.llm-send-btn').text()).toBe('Stop')
      expect(input.attributes('disabled')).toBeDefined()

      await input.trigger('keydown', { key: 'Enter' })
      expect(chat.send).not.toHaveBeenCalled()

      await wrapper.find('.llm-send-btn').trigger('click')
      expect(manager.stopActive).toHaveBeenCalled()
    })
  })

  describe('feedback target', () => {
    it('binds the scope select to the chat scope', async () => {
      const chat = makeChat({ scope: 'document' })
      const wrapper = mountPanel({ chat })
      const select = wrapper.find('.llm-scope-select')

      expect(select.element.value).toBe('document')
      expect(select.findAll('option').map((o) => o.element.value)).toEqual([
        'section',
        'selection',
        'document',
        'structure',
        'summaries',
        'notes',
        'passages',
      ])

      await select.setValue('passages')
      expect(chat.scope).toBe('passages')
    })

    it('says when a live selection is overriding the chosen scope', () => {
      const wrapper = mountPanel({
        chat: makeChat({ scope: 'document', effectiveScope: 'selection' }),
      })

      expect(wrapper.find('.llm-scope-hint').text()).toBe('Using your selection')
    })

    it('shows no override hint when the scope matches', () => {
      const wrapper = mountPanel()

      expect(wrapper.find('.llm-scope-hint').exists()).toBe(false)
    })

    it('shows the context readout against the configured window', () => {
      const wrapper = mountPanel({ chat: makeChat({ input: 'x'.repeat(4000) }) })

      // 4000 chars ≈ 1000 tokens of an 8192-token window.
      expect(wrapper.find('.llm-context-readout').text()).toContain('~1k / 8.2k tokens')
      expect(wrapper.find('.llm-context-readout').classes()).not.toContain('near')
    })

    it('flags the readout as near when the next send would use most of the window', () => {
      const wrapper = mountPanel({ chat: makeChat({ input: 'x'.repeat(28000) }) })

      // 28000 chars ≈ 7000 tokens, over 80% of 8192.
      expect(wrapper.find('.llm-context-readout').classes()).toContain('near')
    })

    it('hides the readout until a model is configured', () => {
      const wrapper = mountPanel({ settings: { settings: { model: '', contextLength: 8192 } } })

      expect(wrapper.find('.llm-context-readout').exists()).toBe(false)
    })

    it('surfaces a retrieval error from the last send', () => {
      const wrapper = mountPanel({
        chat: makeChat({ retrievalError: 'Index the manuscript first.' }),
      })

      expect(wrapper.find('.llm-retrieval-error').text()).toBe('Index the manuscript first.')
    })
  })

  describe('clear conversation', () => {
    it('needs a second click to clear', async () => {
      const chat = makeChat()
      const wrapper = mountPanel({ chat })
      const toggle = () => wrapper.findAll('.llm-clear-btn')[0]

      // The confirm button is `v-show`n, so it is always in the DOM but
      // `display: none` until the writer asks for it. (Asserted on the inline
      // style: jsdom has no layout, so `isVisible()` cannot answer.)
      expect(wrapper.find('#clearConfirm').attributes('style')).toContain('display: none')
      expect(toggle().text()).toBe('Clear Conversation')
      expect(toggle().attributes('aria-expanded')).toBe('false')

      await toggle().trigger('click')
      expect(wrapper.find('#clearConfirm').attributes('style') || '').not.toContain('display: none')
      expect(toggle().text()).toBe('Cancel')
      expect(toggle().attributes('aria-expanded')).toBe('true')
      expect(chat.clear).not.toHaveBeenCalled()

      await wrapper.find('#clearConfirm').trigger('click')
      expect(chat.clear).toHaveBeenCalledTimes(1)
    })

    it('cancels the confirmation without clearing', async () => {
      const chat = makeChat()
      const wrapper = mountPanel({ chat })
      const toggle = () => wrapper.findAll('.llm-clear-btn')[0]

      await toggle().trigger('click')
      await toggle().trigger('click')

      expect(wrapper.find('#clearConfirm').attributes('style')).toContain('display: none')
      expect(chat.clear).not.toHaveBeenCalled()
    })

    it('is unavailable while a reply is streaming', () => {
      const wrapper = mountPanel({ busy: true })

      expect(wrapper.find('.llm-clear-btn').attributes('disabled')).toBeDefined()
    })
  })

  describe('slash commands', () => {
    const slashItems = (wrapper) => wrapper.findAll('.llm-slash-item')

    it('opens on / with every preset and filters as the writer types', async () => {
      const chat = makeChat()
      const wrapper = mountPanel({ chat })
      const input = wrapper.find('.llm-input')

      // Not focused yet: no popup even with a `/` in the field.
      await input.setValue('/')
      expect(wrapper.find('.llm-slash-menu').exists()).toBe(false)

      await input.trigger('focus')
      expect(slashItems(wrapper)).toHaveLength(PRESETS.length)
      expect(slashItems(wrapper)[0].text()).toContain('/summarize')

      await input.setValue('/crit')
      expect(slashItems(wrapper)).toHaveLength(1)
      expect(slashItems(wrapper)[0].text()).toContain('/critique')
    })

    it('shows nothing for a token that matches no preset', async () => {
      const wrapper = mountPanel({ chat: makeChat() })
      const input = wrapper.find('.llm-input')

      await input.trigger('focus')
      await input.setValue('/xyz')

      expect(wrapper.find('.llm-slash-menu').exists()).toBe(false)
    })

    it('moves the highlight with the arrow keys and wraps', async () => {
      const wrapper = mountPanel({ chat: makeChat() })
      const input = wrapper.find('.llm-input')

      await input.trigger('focus')
      await input.setValue('/')

      expect(slashItems(wrapper)[0].classes()).toContain('active')

      await input.trigger('keydown', { key: 'ArrowDown' })
      expect(slashItems(wrapper)[1].classes()).toContain('active')

      await input.trigger('keydown', { key: 'ArrowUp' })
      await input.trigger('keydown', { key: 'ArrowUp' })
      expect(slashItems(wrapper)[PRESETS.length - 1].classes()).toContain('active')
    })

    it('inserts the preset prompt and its scope on Enter without sending', async () => {
      const chat = makeChat({ input: '/crit' })
      const wrapper = mountPanel({ chat })
      const input = wrapper.find('.llm-input')

      await input.trigger('focus')
      await input.trigger('keydown', { key: 'Enter' })

      const critique = PRESETS.find((preset) => preset.id === 'critique')
      expect(chat.input).toBe(critique.prompt)
      expect(chat.scope).toBe(critique.scope)
      expect(chat.send).not.toHaveBeenCalled()
    })

    it('keeps the writer’s trailing note after the inserted prompt', async () => {
      const chat = makeChat({ input: '/crit focus on dialogue' })
      const wrapper = mountPanel({ chat })
      const input = wrapper.find('.llm-input')

      await input.trigger('focus')
      await input.trigger('keydown', { key: 'Tab' })

      const critique = PRESETS.find((preset) => preset.id === 'critique')
      expect(chat.input).toBe(`${critique.prompt} focus on dialogue`)
    })

    it('closes on Escape', async () => {
      const wrapper = mountPanel({ chat: makeChat() })
      const input = wrapper.find('.llm-input')

      await input.trigger('focus')
      await input.setValue('/')
      expect(wrapper.find('.llm-slash-menu').exists()).toBe(true)

      await input.trigger('keydown', { key: 'Escape' })

      expect(wrapper.find('.llm-slash-menu').exists()).toBe(false)
    })

    it('selects an item with the mouse', async () => {
      const chat = makeChat({ input: '/' })
      const wrapper = mountPanel({ chat })
      const input = wrapper.find('.llm-input')

      await input.trigger('focus')
      await slashItems(wrapper)[2].trigger('click')

      const pacing = PRESETS[2]
      expect(chat.input).toBe(pacing.prompt)
      expect(chat.scope).toBe(pacing.scope)
    })
  })
})

// Revision 2: the manuscript-wide summary refresh belongs to the Assistant
// panel, not the References drawer.
describe('LlmPanel Regenerate all', () => {
  it('S-045: offers Regenerate all and reports the click', async () => {
    const wrapper = mountPanel()

    const control = wrapper.find('.regenerate-all')
    expect(control.exists()).toBe(true)
    await control.trigger('click')

    expect(wrapper.emitted('regenerate-all')).toBeTruthy()
  })
})
