import { describe, it, expect, vi, beforeEach } from 'vitest'
import { documentToText, useChat, PRESETS, matchSlashCommands } from './useChat.js'

// Mock the Tauri bridge: `invoke` for commands, `listen` for streaming events.
// `listen` resolves to an unlisten function; we capture the event handlers so
// tests can simulate token/error events arriving.
vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'

// --- Test fixtures ----------------------------------------------------------

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

function makeDocument(sections) {
  return {
    title: 'Test Novel',
    author: 'A',
    authorContact: '',
    hasTOC: false,
    hasEpigram: false,
    epigramText: '',
    sections,
  }
}

// A two-section doc: one chapter + one section, each with a couple paragraphs.
function sampleDocument() {
  return makeDocument([
    makeSection('s1', 'The Arrival', 'chapter', [
      makeParagraph('p1', 'The door opened.'),
      makeParagraph('p2', 'Rain fell softly.'),
    ]),
    makeSection('s2', 'Notes', 'section', [
      makeParagraph('p3', 'A quiet scene.'),
    ]),
  ])
}

// A stand-in for the reactive `doc` ref (the factory reads `docRef.value`).
function docRef(doc) {
  return { value: doc }
}

// A stand-in for the llmSettings composable (the factory reads
// `llmSettings.settings.value.{endpoint,model,apiKey,temperature}`).
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

// A stand-in for the nav object (selectedNavId is a ref-like with `.value`).
function makeNav(selectedId = null) {
  return { selectedNavId: { value: selectedId } }
}

// Capture listen handlers so tests can emit synthetic token/error events.
let listenHandlers = {}
let unlistenFns = []

beforeEach(() => {
  vi.clearAllMocks()
  listenHandlers = {}
  unlistenFns = []
  listen.mockImplementation(async (event, handler) => {
    listenHandlers[event] = handler
    const unlisten = vi.fn(() => {
      delete listenHandlers[event]
    })
    unlistenFns.push(unlisten)
    return unlisten
  })
})

// Simulate the invoke('llm_chat_stream') resolution. By default it resolves
// (stream completes); tests can override to reject.
function mockStreamResolves() {
  invoke.mockResolvedValue('full text')
}
function mockStreamRejects(message) {
  invoke.mockRejectedValue(message)
}

// Emit a token event to the captured handler.
function emitToken(token) {
  if (listenHandlers['llm-token']) {
    listenHandlers['llm-token']({ payload: { token } })
  }
}
function emitError(message) {
  if (listenHandlers['llm-error']) {
    listenHandlers['llm-error']({ payload: { message } })
  }
}

// --- documentToText --------------------------------------------------------

describe('documentToText', () => {
  it('returns the selected section with a chapter header', () => {
    const doc = sampleDocument()
    const text = documentToText(doc, 'section', '', 's1')
    expect(text).toContain('Chapter 1: The Arrival')
    expect(text).toContain('The door opened.')
    expect(text).toContain('Rain fell softly.')
    // Should NOT include the other section.
    expect(text).not.toContain('Notes')
  })

  it('falls back to the first section when sectionId is not found', () => {
    const doc = sampleDocument()
    const text = documentToText(doc, 'section', '', 'nonexistent')
    expect(text).toContain('Chapter 1: The Arrival')
  })

  it('returns the selection text for the selection scope', () => {
    const doc = sampleDocument()
    const text = documentToText(doc, 'selection', 'selected words here')
    expect(text).toBe('selected words here')
  })

  it('returns empty for selection scope with no selection', () => {
    const doc = sampleDocument()
    expect(documentToText(doc, 'selection', '')).toBe('')
  })

  it('returns all sections for the document scope', () => {
    const doc = sampleDocument()
    const text = documentToText(doc, 'document')
    expect(text).toContain('Chapter 1: The Arrival')
    expect(text).toContain('The door opened.')
    expect(text).toContain('Rain fell softly.')
    expect(text).toContain('Notes')
    expect(text).toContain('A quiet scene.')
  })

  it('uses a section title verbatim (no chapter prefix) for section-type', () => {
    const doc = sampleDocument()
    const text = documentToText(doc, 'section', '', 's2')
    expect(text).toContain('Notes')
    expect(text).not.toContain('Chapter')
  })

  it('returns empty for a doc with no sections', () => {
    expect(documentToText({ sections: [] }, 'document')).toBe('')
    expect(documentToText(null, 'document')).toBe('')
  })
})

// --- matchSlashCommands -----------------------------------------------------

describe('matchSlashCommands', () => {
  it('returns null when the text does not start with /', () => {
    expect(matchSlashCommands('critique this')).toBeNull()
    expect(matchSlashCommands('')).toBeNull()
    expect(matchSlashCommands(' /summarize')).toBeNull()
  })

  it('returns all four presets for a bare /', () => {
    expect(matchSlashCommands('/').map((p) => p.id)).toEqual([
      'summarize',
      'critique',
      'pacing',
      'suggest',
    ])
  })

  it('filters to presets whose id starts with the token', () => {
    expect(matchSlashCommands('/cri').map((p) => p.id)).toEqual(['critique'])
    expect(matchSlashCommands('/pac').map((p) => p.id)).toEqual(['pacing'])
  })

  it('returns matching presets in PRESETS order, not input order', () => {
    // /s matches both "summarize" and "suggest"; PRESETS order is summarize
    // then suggest (not alphabetical), so the result preserves that.
    expect(matchSlashCommands('/s').map((p) => p.id)).toEqual([
      'summarize',
      'suggest',
    ])
  })

  it('uses only the first whitespace-delimited word as the token', () => {
    // `/critique focus on dialogue` → token is `critique`; the trailing text
    // is for the panel to append to the inserted prompt, not for matching.
    expect(matchSlashCommands('/critique focus on dialogue').map((p) => p.id)).toEqual([
      'critique',
    ])
  })

  it('returns an empty array when nothing matches', () => {
    expect(matchSlashCommands('/xyz')).toEqual([])
  })
})

// --- buildContextMessages ---------------------------------------------------

describe('useChat — buildContextMessages', () => {
  it('orders messages: system → context → history → new', () => {
    const doc = sampleDocument()
    const llmSettings = makeLlmSettings()
    const nav = makeNav('s1')
    const chat = useChat(docRef(doc), llmSettings, nav, { value: null })

    chat.setRole({ name: 'Critic', body: 'You are a critic.' })
    chat.scope.value = 'section'

    // Seed a prior exchange so history is present.
    chat.messages.value = [
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ]

    const messages = chat.buildContextMessages('new question')
    expect(messages[0]).toEqual({ role: 'system', content: 'You are a critic.' })
    // Context message references the current section.
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('current section')
    expect(messages[1].content).toContain('The door opened.')
    // History.
    expect(messages[2]).toEqual({ role: 'user', content: 'earlier question' })
    expect(messages[3]).toEqual({ role: 'assistant', content: 'earlier answer' })
    // New user message last.
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'new question' })
  })

  it('omits the system message when no role is selected', () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav('s1'), { value: null })
    chat.scope.value = 'section'
    const messages = chat.buildContextMessages('hello')
    // First message should be the context, not a system prompt.
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toContain('current section')
  })

  it('uses the document scope label for whole-document context', () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav(), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'document'
    const messages = chat.buildContextMessages('analyze')
    expect(messages[1].content).toContain('full manuscript')
  })

  it('omits the context message when the doc has no sections', () => {
    const doc = makeDocument([])
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav('s1'), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'section'
    const messages = chat.buildContextMessages('hi')
    // No context message — only system + new user.
    expect(messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ])
  })
})

// --- send / streaming -------------------------------------------------------

describe('useChat — send + streaming', () => {
  it('appends a user message and a streaming assistant placeholder, then finalizes', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav('s1'), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'section'
    mockStreamResolves()

    chat.input.value = 'What do you think?'
    await chat.send()

    // Two messages pushed: the user question + the assistant response.
    expect(chat.messages.value.length).toBe(2)
    expect(chat.messages.value[0].role).toBe('user')
    expect(chat.messages.value[0].content).toBe('What do you think?')
    expect(chat.messages.value[1].role).toBe('assistant')
    expect(chat.messages.value[1].streaming).toBe(false)
    expect(chat.busy.value).toBe(false)
    // Input is cleared after send.
    expect(chat.input.value).toBe('')
  })

  it('appends streamed tokens to the last assistant message', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav('s1'), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'section'

    // Make invoke resolve only after we emit some tokens, so the listener is
    // active while we pump events. We use a deferred promise.
    let resolveStream
    invoke.mockReturnValue(new Promise((resolve) => { resolveStream = resolve }))

    chat.input.value = 'critique this'
    const sendPromise = chat.send()

    // The assistant placeholder is now the last message and streaming.
    expect(chat.messages.value[1].streaming).toBe(true)

    emitToken('Hello ')
    emitToken('world')
    expect(chat.messages.value[1].content).toBe('Hello world')

    resolveStream('Hello world')
    await sendPromise

    expect(chat.messages.value[1].streaming).toBe(false)
    expect(chat.messages.value[1].content).toBe('Hello world')
  })

  it('ignores tokens that arrive after the stream finalizes', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav('s1'), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'section'
    mockStreamResolves()

    chat.input.value = 'test'
    await chat.send()

    // The stream is done; a late token must not write into the finalized msg.
    const contentBefore = chat.messages.value[1].content
    emitToken('late token')
    expect(chat.messages.value[1].content).toBe(contentBefore)
  })

  it('marks the assistant message as error on a rejected invoke', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav('s1'), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'section'
    mockStreamRejects('connection refused')

    chat.input.value = 'test'
    await chat.send()

    expect(chat.messages.value[1].error).toBe(true)
    expect(chat.messages.value[1].content).toBe('connection refused')
    expect(chat.busy.value).toBe(false)
  })

  it('does not send when busy or when input is empty', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav('s1'), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })

    mockStreamResolves()
    // Empty input — no-op.
    chat.input.value = '   '
    await chat.send()
    expect(invoke).not.toHaveBeenCalled()
    expect(chat.messages.value.length).toBe(0)
  })
})

// --- preset -----------------------------------------------------------------

describe('useChat — preset', () => {
  it('sets input + scope and sends for a section preset', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav('s1'), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    mockStreamResolves()

    await chat.preset('summarize')

    expect(chat.scope.value).toBe('section')
    expect(invoke).toHaveBeenCalledTimes(1)
    // The preset prompt is sent as the user message.
    const request = invoke.mock.calls[0][1].request
    const lastMessage = request.messages[request.messages.length - 1]
    expect(lastMessage.role).toBe('user')
    expect(lastMessage.content).toContain('Summarize this section')
  })

  it('sets the document scope for the pacing preset', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav(), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    mockStreamResolves()

    await chat.preset('pacing')
    expect(chat.scope.value).toBe('document')
    const request = invoke.mock.calls[0][1].request
    const lastMessage = request.messages[request.messages.length - 1]
    expect(lastMessage.content).toContain('pacing across the whole manuscript')
  })

  it('PRESETS has exactly four presets with the expected ids', () => {
    const ids = PRESETS.map((p) => p.id)
    expect(ids).toEqual(['summarize', 'critique', 'pacing', 'suggest'])
  })
})

// --- stop / clear -----------------------------------------------------------

describe('useChat — stop + clear', () => {
  it('clear resets messages to empty', () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav('s1'), { value: null })
    chat.messages.value = [{ role: 'user', content: 'x' }]
    chat.clear()
    expect(chat.messages.value).toEqual([])
  })

  it('stop invokes llm_cancel and finalizes the streaming message', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav('s1'), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'section'

    let resolveStream
    invoke.mockReturnValue(new Promise((resolve) => { resolveStream = resolve }))
    chat.input.value = 'test'
    const sendPromise = chat.send()

    expect(chat.busy.value).toBe(true)
    chat.stop()
    expect(invoke).toHaveBeenCalledWith('llm_cancel')
    expect(chat.busy.value).toBe(false)
    expect(chat.messages.value[1].streaming).toBe(false)

    // Resolve the pending stream so the test doesn't hang.
    resolveStream('')
    await sendPromise
  })
})