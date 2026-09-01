import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive } from 'vue'

// Mock the Tauri bridge: `invoke` for commands (list_roles + llm_chat_stream +
// llm_cancel), `listen` for streaming events. The same shape useChat.test.js
// uses; `listen` resolves to an unlisten function and captures handlers.
vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'
import { useChatManager } from './useChat.js'

// --- Test fixtures (mirror useChat.test.js) --------------------------------

function makeParagraph(id, text) {
  return {
    id,
    elements: [{ textRun: { content: text, textStyle: {} } }],
    leftIndent: null,
    rightIndent: null,
    firstLineIndent: null,
  }
}

function makeSection(id, title, sectionType, paragraphs) {
  return { id, title, sectionType, paragraphs }
}

function sampleDocument() {
  return {
    title: 'Test Novel',
    author: 'A',
    authorContact: '',
    hasTOC: false,
    hasEpigram: false,
    epigramText: '',
    sections: [
      makeSection('s1', 'The Arrival', 'chapter', [makeParagraph('p1', 'Rain fell.')]),
      makeSection('s2', 'Notes', 'section', [makeParagraph('p2', 'A quiet scene.')]),
    ],
  }
}

function docRef(doc) {
  return { value: doc }
}

function makeLlmSettings(overrides = {}) {
  const settings = {
    endpoint: 'http://localhost:11434',
    model: 'llama3',
    apiKey: '',
    temperature: null,
    ...overrides,
  }
  return { settings: { value: settings } }
}

function makeNav(selectedId = null) {
  return { selectedNavId: { value: selectedId } }
}

/// The persona list `list_roles` returns: name + description + composed body.
/// Ordered as the Rust side would (alphabetical) — the manager doesn't sort.
function sampleRoles() {
  return [
    { name: 'Copy Editor', description: 'Line-level edits.', body: 'base+copyeditor' },
    { name: 'Critic', description: 'Structural feedback.', body: 'base+critic' },
    { name: 'Writing Assistant', description: 'General helper.', body: 'base+assistant' },
  ]
}

// --- Shared mock wiring -----------------------------------------------------

let listenHandlers = {}

beforeEach(() => {
  vi.clearAllMocks()
  listenHandlers = {}
  // `list_roles` resolves with the persona list so the manager's construction-
  // time loadRoles() populates roles. Other commands resolve to undefined until
  // a test overrides (e.g. to drive a deferred stream).
  invoke.mockImplementation(async (cmd) => {
    if (cmd === 'list_roles') return sampleRoles()
    return undefined
  })
  listen.mockImplementation(async (event, handler) => {
    listenHandlers[event] = handler
    return vi.fn(() => { delete listenHandlers[event] })
  })
})

/// Flush the construction-time `loadRoles()` microtask chain so roles have
/// resolved and the default role applied. setTimeout(0) drains microtasks first.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function makeManager() {
  return reactive(
    useChatManager(docRef(sampleDocument()), makeLlmSettings(), makeNav('s1'), { value: null }),
  )
}

// --- Construction + roles ---------------------------------------------------

describe('useChatManager — construction', () => {
  it('starts with exactly one session and that session is active', () => {
    const manager = makeManager()
    expect(manager.sessions.length).toBe(1)
    expect(manager.tabs.length).toBe(1)
    expect(manager.activeSession).toBeDefined()
    expect(manager.activeSession.messages.length).toBe(0)
    expect(manager.anyBusy).toBe(false)
  })

  it('applies the Writing Assistant default role once list_roles resolves', async () => {
    const manager = makeManager()
    // Before roles resolve, the first tab is role-less ("New chat").
    expect(manager.activeSession.selectedRoleName).toBe('')
    await tick()
    expect(manager.roles.length).toBe(3)
    expect(manager.activeSession.selectedRoleName).toBe('Writing Assistant')
  })

  it('tab label follows the chosen role, falling back to "New chat"', async () => {
    const manager = makeManager()
    await tick()
    expect(manager.tabs[0].label).toBe('Writing Assistant')
    // Switch the active session's role; the tab label tracks it.
    manager.activeSession.setRole({ name: 'Critic', body: 'sys' })
    expect(manager.tabs[0].label).toBe('Critic')
    // Clear the role and the label falls back.
    manager.activeSession.setRole(null)
    expect(manager.tabs[0].label).toBe('New chat')
  })
})

// --- create / select / close ------------------------------------------------

describe('useChatManager — tabs', () => {
  it('createSession adds a new tab, defaults it to Writing Assistant, and selects it', async () => {
    const manager = makeManager()
    await tick()
    const firstId = manager.sessions[0].id

    manager.createSession()

    expect(manager.sessions.length).toBe(2)
    expect(manager.activeSession.id).not.toBe(firstId)
    expect(manager.activeSession.selectedRoleName).toBe('Writing Assistant')
    expect(manager.tabs.length).toBe(2)
  })

  it('createSession with an explicit role name applies that role', async () => {
    const manager = makeManager()
    await tick()
    manager.createSession('Critic')
    expect(manager.activeSession.selectedRoleName).toBe('Critic')
    expect(manager.tabs[manager.tabs.length - 1].label).toBe('Critic')
  })

  it('selectSession switches the active session', async () => {
    const manager = makeManager()
    await tick()
    const firstId = manager.sessions[0].id
    manager.createSession()
    const secondId = manager.activeSession.id

    manager.selectSession(firstId)
    expect(manager.activeSession.id).toBe(firstId)

    manager.selectSession(secondId)
    expect(manager.activeSession.id).toBe(secondId)
  })

  it('selectSession ignores an unknown id', async () => {
    const manager = makeManager()
    await tick()
    const activeId = manager.activeSession.id
    manager.selectSession('does-not-exist')
    expect(manager.activeSession.id).toBe(activeId)
  })

  it('closeSession removes a non-active tab and leaves the active one selected', async () => {
    const manager = makeManager()
    await tick()
    manager.createSession() // active is now the 2nd
    const activeId = manager.activeSession.id
    const otherId = manager.sessions.find((s) => s.id !== activeId).id

    manager.closeSession(otherId)

    expect(manager.sessions.length).toBe(1)
    expect(manager.activeSession.id).toBe(activeId)
    expect(manager.tabs.length).toBe(1)
  })

  it('closing the active tab selects a remaining one', async () => {
    const manager = makeManager()
    await tick()
    const firstId = manager.sessions[0].id
    manager.createSession() // active is the 2nd

    manager.closeSession(manager.activeSession.id)

    expect(manager.sessions.length).toBe(1)
    // The remaining (first) tab is now active.
    expect(manager.activeSession.id).toBe(firstId)
  })

  it('closing the last tab clears it instead of removing (always >=1 tab)', async () => {
    const manager = makeManager()
    await tick()
    // Seed a message, then close the only tab.
    manager.activeSession.messages = [{ role: 'user', content: 'hello' }]
    expect(manager.sessions.length).toBe(1)

    manager.closeSession(manager.activeSession.id)

    expect(manager.sessions.length).toBe(1)
    expect(manager.tabs.length).toBe(1)
    expect(manager.activeSession.messages.length).toBe(0)
  })

  it('tabs reflects every session id + role label in order', async () => {
    const manager = makeManager()
    await tick()
    manager.createSession('Critic')

    const tabs = manager.tabs
    expect(tabs.length).toBe(2)
    expect(tabs.map((t) => t.id)).toEqual(manager.sessions.map((s) => s.id))
    expect(tabs[0].label).toBe('Writing Assistant')
    expect(tabs[1].label).toBe('Critic')
  })
})

// --- stream serialization (anyBusy + stopActive) ---------------------------

describe('useChatManager — stream serialization', () => {
  it('anyBusy is true while a session streams and false after it completes', async () => {
    const manager = makeManager()
    await tick()
    manager.activeSession.scope = 'section'

    let resolveStream
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'list_roles') return sampleRoles()
      if (cmd === 'llm_cancel') return undefined
      if (cmd === 'llm_chat_stream') return new Promise((resolve) => { resolveStream = resolve })
      return undefined
    })

    manager.activeSession.input = 'critique this'
    const sendPromise = manager.activeSession.send()
    await tick() // let listeners attach + invoke be called

    expect(manager.anyBusy).toBe(true)

    resolveStream('done')
    await sendPromise

    expect(manager.anyBusy).toBe(false)
  })

  it('stopActive cancels the busy session and invokes llm_cancel', async () => {
    const manager = makeManager()
    await tick()
    manager.activeSession.scope = 'section'

    let resolveStream
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'list_roles') return sampleRoles()
      if (cmd === 'llm_cancel') return undefined
      if (cmd === 'llm_chat_stream') return new Promise((resolve) => { resolveStream = resolve })
      return undefined
    })

    manager.activeSession.input = 'test'
    const sendPromise = manager.activeSession.send()
    await tick()

    expect(manager.anyBusy).toBe(true)
    manager.stopActive()

    expect(invoke).toHaveBeenCalledWith('llm_cancel')
    expect(manager.anyBusy).toBe(false)
    // The streaming assistant message is finalized (no longer streaming).
    expect(manager.activeSession.messages[1].streaming).toBe(false)

    // Let the pending stream settle so the test doesn't hang.
    resolveStream('')
    await sendPromise
  })
})