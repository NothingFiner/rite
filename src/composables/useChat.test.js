import { describe, it, expect, vi, beforeEach } from 'vitest'
import { documentToText, useChat, PRESETS, matchSlashCommands, estimateTokens, estimateContextTokens, formatPassages, formatStructuralSignals, formatSummaries } from './useChat.js'

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
    // Embeddings triple (Phase 4.2 follow-up / 4.4): separate from chat. The
    // "Relevant passages" scope sends these into `retrieve_passages`.
    embeddingsEndpoint: 'http://localhost:11434',
    embeddingsApiKey: '',
    embeddingsModel: 'nomic-embed-text',
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

  it('headers a subtitle-less chapter as just "Chapter N" — no dangling separator (5.9)', () => {
    const doc = makeDocument([
      makeSection('s1', '', 'chapter', [makeParagraph('p1', 'The door opened.')]),
    ])
    const text = documentToText(doc, 'document')
    expect(text).toContain('Chapter 1')
    expect(text).not.toContain('Chapter 1:')
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

  it('supplies a hidden section to the model as body only — no header line (5.10)', () => {
    const doc = makeDocument([
      { ...makeSection('s1', 'Epigram', 'section', [makeParagraph('p1', 'Only connect.')]), hidden: true },
      makeSection('s2', 'The Arrival', 'chapter', [makeParagraph('p2', 'The door opened.')]),
    ])
    const text = documentToText(doc, 'document')
    // Body renders, header does not.
    expect(text).toContain('Only connect.')
    expect(text).not.toContain('Epigram')
    expect(text).toContain('Chapter 1: The Arrival')
  })

  it('omits a hidden section with no body entirely (no blank separators)', () => {
    const doc = makeDocument([
      { ...makeSection('s1', 'Dedication', 'section', [makeParagraph('p1', '')]), hidden: true },
      makeSection('s2', 'One', 'section', [makeParagraph('p2', 'Body.')]),
    ])
    const text = documentToText(doc, 'document')
    expect(text).toBe('One\nBody.')
  })

  it('suppresses the header for a hidden section in the section scope too', () => {
    const doc = makeDocument([
      { ...makeSection('s1', 'Epigram', 'section', [makeParagraph('p1', 'Only connect.')]), hidden: true },
    ])
    const text = documentToText(doc, 'section', '', 's1')
    expect(text).toBe('Only connect.')
  })
})

// --- formatPassages (4.4) ---------------------------------------------------
//
// Pure helper backing the "Relevant passages" context message. Chunks come back
// camelCase from `retrieve_passages`; `chapterIndex` is null for front matter.

describe('formatPassages', () => {
  it('labels a chunk with its chapter index', () => {
    const chunks = [{ id: 'c1:0', sectionId: 'c1', chapterIndex: 2, text: 'The door opened.' }]
    expect(formatPassages(chunks)).toBe('[Chapter 2]\nThe door opened.')
  })

  it('labels a front-matter chunk (chapterIndex null) as Front matter', () => {
    const chunks = [{ id: 'front:0', sectionId: 'front', chapterIndex: null, text: 'An epigram.' }]
    expect(formatPassages(chunks)).toBe('[Front matter]\nAn epigram.')
  })

  it('joins multiple chunks with a blank line', () => {
    const chunks = [
      { id: 'c1:0', sectionId: 'c1', chapterIndex: 1, text: 'First passage.' },
      { id: 'c2:0', sectionId: 'c2', chapterIndex: 2, text: 'Second passage.' },
    ]
    expect(formatPassages(chunks)).toBe('[Chapter 1]\nFirst passage.\n\n[Chapter 2]\nSecond passage.')
  })

  it('returns empty for no chunks', () => {
    expect(formatPassages([])).toBe('')
    expect(formatPassages(null)).toBe('')
  })
})

// --- formatStructuralSignals (4.6) ------------------------------------------
//
// Pure helper backing the "Structure" context message. A StructuralReport comes
// back camelCase from `structural_signals`; the formatter renders a compact
// per-chapter breakdown the model can scan as a consistent column.

describe('formatStructuralSignals', () => {
  it('renders the header, front matter, and one line per chapter', () => {
    const report = {
      chapters: [
        { chapterIndex: 1, title: 'The Door', words: 2400, paragraphs: 18, sceneBreaks: 2, sectionCount: 2 },
        { chapterIndex: 2, title: 'Rain', words: 800, paragraphs: 6, sceneBreaks: 0, sectionCount: 1 },
      ],
      frontMatter: { words: 120, paragraphs: 2, sceneBreaks: 0, sectionCount: 1 },
      totals: { chapters: 2, sections: 4, words: 3320, paragraphs: 26, sceneBreaks: 2 },
    }
    const text = formatStructuralSignals(report)
    const lines = text.split('\n')
    expect(lines[0]).toBe('Manuscript structure — 2 chapters, 4 sections, ~3320 words total:')
    expect(lines[1]).toBe('Front matter: 120 words, 2 paragraphs, 0 scene breaks')
    expect(lines[2]).toBe('Chapter 1: The Door — 2400 words, 18 paragraphs, 2 scene breaks (2 sections)')
    expect(lines[3]).toBe('Chapter 2: Rain — 800 words, 6 paragraphs, 0 scene breaks (1 section)')
  })

  it('omits the front-matter line when there is none', () => {
    const report = {
      chapters: [{ chapterIndex: 1, title: 'One', words: 100, paragraphs: 2, sceneBreaks: 0, sectionCount: 1 }],
      frontMatter: { words: 0, paragraphs: 0, sceneBreaks: 0, sectionCount: 0 },
      totals: { chapters: 1, sections: 1, words: 100, paragraphs: 2, sceneBreaks: 0 },
    }
    const lines = formatStructuralSignals(report).split('\n')
    expect(lines[0]).toBe('Manuscript structure — 1 chapter, 1 section, ~100 words total:')
    // No front-matter line — the second line is the chapter.
    expect(lines[1]).toBe('Chapter 1: One — 100 words, 2 paragraphs, 0 scene breaks (1 section)')
    expect(lines.length).toBe(2)
  })

  it('renders a chapter with no title as just its number', () => {
    const report = {
      chapters: [{ chapterIndex: 3, title: '', words: 50, paragraphs: 1, sceneBreaks: 0, sectionCount: 1 }],
      frontMatter: { words: 0, paragraphs: 0, sceneBreaks: 0, sectionCount: 0 },
      totals: { chapters: 1, sections: 1, words: 50, paragraphs: 1, sceneBreaks: 0 },
    }
    const line = formatStructuralSignals(report).split('\n')[1]
    expect(line).toBe('Chapter 3 — 50 words, 1 paragraph, 0 scene breaks (1 section)')
  })

  it('pluralizes counts (1 chapter / 2 chapters, 1 section / 2 sections)', () => {
    const one = {
      chapters: [{ chapterIndex: 1, title: 'Solo', words: 10, paragraphs: 1, sceneBreaks: 1, sectionCount: 1 }],
      frontMatter: { words: 0, paragraphs: 0, sceneBreaks: 0, sectionCount: 0 },
      totals: { chapters: 1, sections: 1, words: 10, paragraphs: 1, sceneBreaks: 1 },
    }
    expect(formatStructuralSignals(one).split('\n')[0]).toBe(
      'Manuscript structure — 1 chapter, 1 section, ~10 words total:',
    )
    expect(formatStructuralSignals(one).split('\n')[1]).toBe(
      'Chapter 1: Solo — 10 words, 1 paragraph, 1 scene break (1 section)',
    )
  })

  it('returns empty for a null report', () => {
    expect(formatStructuralSignals(null)).toBe('')
  })
})

// --- formatSummaries (4.8) --------------------------------------------------
//
// Pure helper backing the "Summaries" context message. SummaryEntry objects come
// back camelCase from `retrieve_summaries`; the formatter renders a compact
// per-section recap block the model can scan to trace the arc.

describe('formatSummaries', () => {
  it('renders the header and one line per summarized section', () => {
    const entries = [
      { sectionId: 's1', chapterIndex: 1, title: 'The Arrival', sectionType: 'chapter', summary: 'A stranger arrives.', stale: false },
      { sectionId: 's2', chapterIndex: 2, title: 'The Bargain', sectionType: 'chapter', summary: 'A deal is struck.', stale: false },
    ]
    const lines = formatSummaries(entries).split('\n')
    expect(lines[0]).toBe('Manuscript summaries — 2 sections:')
    expect(lines[1]).toBe('Chapter 1: The Arrival — A stranger arrives.')
    expect(lines[2]).toBe('Chapter 2: The Bargain — A deal is struck.')
  })

  it('labels a front-matter section (chapterIndex null) as Front matter', () => {
    const entries = [
      { sectionId: 'front', chapterIndex: null, title: 'Epigraph', sectionType: 'section', summary: 'An epigram.', stale: false },
    ]
    expect(formatSummaries(entries).split('\n')[1]).toBe('Front matter: Epigraph — An epigram.')
  })

  it('marks a stale entry with (stale) on the header line', () => {
    const entries = [
      { sectionId: 's1', chapterIndex: 1, title: 'The Arrival', sectionType: 'chapter', summary: 'A stranger arrives.', stale: false },
      { sectionId: 's2', chapterIndex: 2, title: 'The Bargain', sectionType: 'chapter', summary: 'A deal is struck.', stale: true },
    ]
    const lines = formatSummaries(entries).split('\n')
    // The fresh entry has no marker; the stale one is annotated.
    expect(lines[1]).toBe('Chapter 1: The Arrival — A stranger arrives.')
    expect(lines[2]).toBe('Chapter 2: The Bargain (stale) — A deal is struck.')
  })

  it('pluralizes the section count (1 section / 2 sections)', () => {
    const one = [
      { sectionId: 's1', chapterIndex: 1, title: 'Solo', sectionType: 'chapter', summary: 'r', stale: false },
    ]
    expect(formatSummaries(one).split('\n')[0]).toBe('Manuscript summaries — 1 section:')
    const two = [
      { sectionId: 's1', chapterIndex: 1, title: 'A', sectionType: 'chapter', summary: 'r', stale: false },
      { sectionId: 's2', chapterIndex: 2, title: 'B', sectionType: 'chapter', summary: 'r', stale: false },
    ]
    expect(formatSummaries(two).split('\n')[0]).toBe('Manuscript summaries — 2 sections:')
  })

  it('falls back to Untitled for an empty title', () => {
    const entries = [
      { sectionId: 's1', chapterIndex: 1, title: '', sectionType: 'chapter', summary: 'recap', stale: false },
    ]
    expect(formatSummaries(entries).split('\n')[1]).toBe('Chapter 1: Untitled — recap')
  })

  it('returns empty for no entries', () => {
    expect(formatSummaries([])).toBe('')
    expect(formatSummaries(null)).toBe('')
  })
})

// --- matchSlashCommands -----------------------------------------------------

describe('matchSlashCommands', () => {
  it('returns null when the text does not start with /', () => {
    expect(matchSlashCommands('critique this')).toBeNull()
    expect(matchSlashCommands('')).toBeNull()
    expect(matchSlashCommands(' /summarize')).toBeNull()
  })

  it('returns all five presets for a bare /', () => {
    expect(matchSlashCommands('/').map((p) => p.id)).toEqual([
      'summarize',
      'critique',
      'pacing',
      'pacing-shape',
      'suggest',
    ])
  })

  it('filters to presets whose id starts with the token', () => {
    expect(matchSlashCommands('/cri').map((p) => p.id)).toEqual(['critique'])
    // `/pac` is a prefix of BOTH `pacing` and `pacing-shape`, so both match.
    expect(matchSlashCommands('/pac').map((p) => p.id)).toEqual(['pacing', 'pacing-shape'])
    // Typing the hyphen disambiguates down to the shape preset alone.
    expect(matchSlashCommands('/pacing-').map((p) => p.id)).toEqual(['pacing-shape'])
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

// --- estimateTokens / estimateContextTokens (3.4) -------------------------
//
// Pure helpers backing the panel's token-usage readout. `estimateTokens` uses
// the chars/4 heuristic (ceil, so a 5-char string is 2 tokens — we round up so
// the readout errs toward "more full," the safer direction for a context
// warning). `estimateContextTokens` sums over the [{role, content}] shape
// `buildContextMessages` returns, charging only content.

describe('estimateTokens', () => {
  it('returns 0 for empty / null / undefined', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens(null)).toBe(0)
    expect(estimateTokens(undefined)).toBe(0)
  })

  it('estimates ~4 chars per token, rounding up', () => {
    expect(estimateTokens('abcd')).toBe(1) // exactly 4 chars → 1 token
    expect(estimateTokens('abcde')).toBe(2) // 5 chars → ceil(1.25) = 2
    expect(estimateTokens('ab')).toBe(1) // 2 chars → ceil(0.5) = 1
  })
})

describe('estimateContextTokens', () => {
  it('sums the token cost of each message content', () => {
    const messages = [
      { role: 'system', content: 'abcd' }, // 1
      { role: 'user', content: 'abcdefgh' }, // 2
      { role: 'assistant', content: 'ab' }, // 1
    ]
    expect(estimateContextTokens(messages)).toBe(4)
  })

  it('handles an empty message list', () => {
    expect(estimateContextTokens([])).toBe(0)
  })

  it('treats missing content as 0 tokens (defensive)', () => {
    const messages = [
      { role: 'user' }, // no content
      { role: 'assistant', content: 'abcd' },
    ]
    expect(estimateContextTokens(messages)).toBe(1)
  })

  it('matches the sum of per-message estimateTokens calls', () => {
    const messages = [
      { role: 'system', content: 'You are a critic.' },
      { role: 'user', content: 'The door opened. Rain fell softly.' },
    ]
    const manual = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
    expect(estimateContextTokens(messages)).toBe(manual)
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

  it('uses supplied retrieved context with the passages label (4.4)', () => {
    // When `send` has fetched passages, it threads the formatted text in as the
    // second arg; the context message must use the passages label + that text
    // (NOT documentToText, regardless of scope).
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav('s1'), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'passages'
    const messages = chat.buildContextMessages('merge these two?', '[Chapter 1]\nThe door opened.')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('most relevant manuscript passages')
    expect(messages[1].content).toContain('[Chapter 1]\nThe door opened.')
    // Must NOT fall back to the section/document body.
    expect(messages[1].content).not.toContain('Rain fell softly.')
  })

  it('omits the context message for the passages scope when no retrieved context', () => {
    // The readout path: passages can't be previewed, so no context message is
    // emitted (the token estimate under-counts by design).
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav(), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'passages'
    const messages = chat.buildContextMessages('question')
    expect(messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'question' },
    ])
  })

  it('uses supplied retrieved context with the structure label (4.6)', () => {
    // The "Structure" scope pre-fetches the breakdown in `send` and threads it
    // in as the second arg; the context message must use the structure label +
    // that text (NOT documentToText).
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav('s1'), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'structure'
    const messages = chat.buildContextMessages(
      'where does the middle sag?',
      'Manuscript structure — 1 chapter, 1 section, ~6 words total:\nChapter 1: The Arrival — 4 words, 2 paragraphs, 0 scene breaks (1 section)',
    )
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('manuscript structure')
    expect(messages[1].content).toContain('Chapter 1: The Arrival')
    // Must NOT fall back to the section/document body.
    expect(messages[1].content).not.toContain('The door opened.')
  })

  it('omits the context message for the structure scope when no retrieved context', () => {
    // Readout path: like passages, the structure breakdown can't be previewed
    // synchronously, so no context message is emitted (under-counts by design).
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav(), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'structure'
    const messages = chat.buildContextMessages('question')
    expect(messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'question' },
    ])
  })

  it('uses supplied retrieved context with the summaries label (4.8)', () => {
    // The "Summaries" scope pre-fetches the recaps in `send` and threads them in
    // as the second arg; the context message must use the summaries label + that
    // text (NOT documentToText).
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav('s1'), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'summaries'
    const messages = chat.buildContextMessages(
      'trace the arc',
      'Manuscript summaries — 1 section:\nChapter 1: The Arrival — A stranger arrives.',
    )
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('section summaries')
    expect(messages[1].content).toContain('Chapter 1: The Arrival')
    // Must NOT fall back to the section/document body.
    expect(messages[1].content).not.toContain('The door opened.')
  })

  it('omits the context message for the summaries scope when no retrieved context', () => {
    // Readout path: like passages/structure, summaries can't be previewed
    // synchronously, so no context message is emitted (under-counts by design).
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav(), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'summaries'
    const messages = chat.buildContextMessages('question')
    expect(messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'question' },
    ])
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

// --- effectiveScope / selection-default (3.2) -----------------------------
//
// `effectiveScope` layers a live editor selection on top of the writer's
// explicit dropdown choice: "selection wins, except Whole document". A mock
// `editorRef` exposes `hasSelection` (a plain boolean — the real one is a
// reactive ref forwarded through DocumentRenderer) + `getSelectionText`.

// A mock editorRef with a controllable selection. `hasSelection` is a plain
// boolean here; the real exposed value is a reactive ref that unwraps to one.
function makeEditorRef({ hasSelection, selectionText = '' }) {
  return {
    value: {
      hasSelection,
      getSelectionText: () => selectionText,
    },
  }
}

describe('useChat — effectiveScope (selection-default)', () => {
  it('upgrades section scope to selection when the editor has a selection', () => {
    const doc = sampleDocument()
    const chat = useChat(
      docRef(doc),
      makeLlmSettings(),
      makeNav('s1'),
      makeEditorRef({ hasSelection: true, selectionText: 'the chosen passage' }),
    )
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'section'

    expect(chat.effectiveScope.value).toBe('selection')
    const messages = chat.buildContextMessages('critique this')
    // The context message uses the selection text, not the section body.
    expect(messages[1].content).toContain('selected text')
    expect(messages[1].content).toContain('the chosen passage')
    expect(messages[1].content).not.toContain('The door opened.')
  })

  it('respects an explicit Whole-document scope even with a selection', () => {
    const doc = sampleDocument()
    const chat = useChat(
      docRef(doc),
      makeLlmSettings(),
      makeNav(),
      makeEditorRef({ hasSelection: true, selectionText: 'the chosen passage' }),
    )
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'document'

    // Pacing/whole-document analysis must NOT be overridden by a stray selection.
    expect(chat.effectiveScope.value).toBe('document')
    const messages = chat.buildContextMessages('analyze pacing')
    expect(messages[1].content).toContain('full manuscript')
    expect(messages[1].content).not.toContain('the chosen passage')
  })

  it('leaves section scope unchanged when there is no selection', () => {
    const doc = sampleDocument()
    const chat = useChat(
      docRef(doc),
      makeLlmSettings(),
      makeNav('s1'),
      makeEditorRef({ hasSelection: false, selectionText: '' }),
    )
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'section'

    expect(chat.effectiveScope.value).toBe('section')
    const messages = chat.buildContextMessages('critique this')
    expect(messages[1].content).toContain('current section')
    expect(messages[1].content).toContain('The door opened.')
  })

  it('treats a null editorRef (no editor mounted) as no selection', () => {
    // The existing fixtures pass { value: null }; effectiveScope must fall back
    // to the chosen scope so prior tests' behavior is unchanged.
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav('s1'), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'section'
    expect(chat.effectiveScope.value).toBe('section')
  })

  it('respects an explicit Relevant-passages scope even with a selection', () => {
    // Like Whole document, "Relevant passages" is a whole-manuscript choice — a
    // stray selection must NOT override it (the retrieval ranks against the full
    // index, not a highlighted snippet).
    const doc = sampleDocument()
    const chat = useChat(
      docRef(doc),
      makeLlmSettings(),
      makeNav(),
      makeEditorRef({ hasSelection: true, selectionText: 'the chosen passage' }),
    )
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'passages'
    expect(chat.effectiveScope.value).toBe('passages')
  })

  it('respects an explicit Structure scope even with a selection', () => {
    // Like Whole document / Relevant passages, "Structure" is a whole-manuscript
    // choice — a stray selection must NOT override it (the breakdown covers every
    // chapter, not a highlighted snippet).
    const doc = sampleDocument()
    const chat = useChat(
      docRef(doc),
      makeLlmSettings(),
      makeNav(),
      makeEditorRef({ hasSelection: true, selectionText: 'the chosen passage' }),
    )
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'structure'
    expect(chat.effectiveScope.value).toBe('structure')
  })

  it('respects an explicit Summaries scope even with a selection', () => {
    // Like Whole document / Relevant passages / Structure, "Summaries" is a
    // whole-manuscript choice — a stray selection must NOT override it (the
    // recaps cover every section, not a highlighted snippet).
    const doc = sampleDocument()
    const chat = useChat(
      docRef(doc),
      makeLlmSettings(),
      makeNav(),
      makeEditorRef({ hasSelection: true, selectionText: 'the chosen passage' }),
    )
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'summaries'
    expect(chat.effectiveScope.value).toBe('summaries')
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

// --- Relevant passages scope (4.4) ------------------------------------------
//
// The "Relevant passages" scope fetches passages via `retrieve_passages` BEFORE
// assembling the request, then threads them into `buildContextMessages`. These
// tests drive the two invoke calls (retrieve_passages + llm_chat_stream) with a
// per-command mock implementation.

describe('useChat — Relevant passages send', () => {
  it('fetches passages and injects them as the context message', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav(), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'passages'

    // retrieve_passages returns chunks; llm_chat_stream resolves (value unused).
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'retrieve_passages') {
        return [{ id: 's1:0', sectionId: 's1', chapterIndex: 1, text: 'The door opened.' }]
      }
      return 'full text'
    })

    chat.input.value = 'Would merging these two characters work?'
    await chat.send()

    // retrieve_passages was called with the question as the query + the embeddings triple.
    const retrieveCall = invoke.mock.calls.find((c) => c[0] === 'retrieve_passages')
    expect(retrieveCall[1]).toMatchObject({
      query: 'Would merging these two characters work?',
      endpoint: 'http://localhost:11434',
      model: 'nomic-embed-text',
    })
    // The request shipped to the model includes the passages context message.
    const streamCall = invoke.mock.calls.find((c) => c[0] === 'llm_chat_stream')
    const contextMessage = streamCall[1].request.messages.find((m) =>
      m.content.includes('most relevant manuscript passages'),
    )
    expect(contextMessage).toBeTruthy()
    expect(contextMessage.content).toContain('The door opened.')
    // The user's question is still the final message.
    const lastMessage = streamCall[1].request.messages[streamCall[1].request.messages.length - 1]
    expect(lastMessage.content).toBe('Would merging these two characters work?')
    // Retrieval error is clear on success.
    expect(chat.retrievalError.value).toBe('')
  })

  it('aborts on retrieval failure, restoring input + setting retrievalError', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav(), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'passages'

    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'retrieve_passages') throw new Error('manuscript index is empty')
      return 'full text'
    })

    chat.input.value = 'merge these two?'
    await chat.send()

    // Nothing pushed to the conversation (no failed exchange pollutes history).
    expect(chat.messages.value.length).toBe(0)
    // The error is surfaced inline...
    expect(chat.retrievalError.value).toBe('manuscript index is empty')
    // ...the input is restored so the writer can fix setup + retry...
    expect(chat.input.value).toBe('merge these two?')
    // ...and we never reached the chat stream.
    expect(invoke.mock.calls.some((c) => c[0] === 'llm_chat_stream')).toBe(false)
    expect(chat.busy.value).toBe(false)
  })

  it('clears a stale retrievalError at the start of a successful send', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav(), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'passages'
    chat.retrievalError.value = 'stale error from before'

    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'retrieve_passages') return [{ id: 's1:0', sectionId: 's1', chapterIndex: 1, text: 'ok' }]
      return 'full text'
    })

    chat.input.value = 'question'
    await chat.send()
    expect(chat.retrievalError.value).toBe('')
  })
})

// --- Structure scope (4.6) ---------------------------------------------------
//
// The "Structure" scope fetches the per-chapter breakdown via
// `structural_signals` BEFORE assembling the request (no embeddings triple —
// it's a pure Rust walk), then threads it into `buildContextMessages`. These
// tests drive the two invoke calls (structural_signals + llm_chat_stream) with a
// per-command mock implementation.

describe('useChat — Structure send', () => {
  it('fetches the structural breakdown and injects it as the context message', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav(), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'structure'

    // structural_signals returns a report; llm_chat_stream resolves (unused).
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'structural_signals') {
        return {
          chapters: [{ chapterIndex: 1, title: 'The Arrival', words: 4, paragraphs: 2, sceneBreaks: 0, sectionCount: 2 }],
          frontMatter: { words: 0, paragraphs: 0, sceneBreaks: 0, sectionCount: 0 },
          totals: { chapters: 1, sections: 2, words: 5, paragraphs: 3, sceneBreaks: 0 },
        }
      }
      return 'full text'
    })

    chat.input.value = 'Where does the middle sag?'
    await chat.send()

    // structural_signals was called with NO args (the document is read from
    // AppState server-side, not passed in).
    const signalsCall = invoke.mock.calls.find((c) => c[0] === 'structural_signals')
    expect(signalsCall[1]).toEqual({})
    // The request shipped to the model includes the structure context message.
    const streamCall = invoke.mock.calls.find((c) => c[0] === 'llm_chat_stream')
    const contextMessage = streamCall[1].request.messages.find((m) =>
      m.content.includes('manuscript structure'),
    )
    expect(contextMessage).toBeTruthy()
    expect(contextMessage.content).toContain('Chapter 1: The Arrival')
    // The user's question is still the final message.
    const lastMessage = streamCall[1].request.messages[streamCall[1].request.messages.length - 1]
    expect(lastMessage.content).toBe('Where does the middle sag?')
    // Error is clear on success.
    expect(chat.retrievalError.value).toBe('')
  })

  it('aborts on structural_signals failure, restoring input + setting retrievalError', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav(), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'structure'

    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'structural_signals') throw new Error('document lock poisoned')
      return 'full text'
    })

    chat.input.value = 'balance check'
    await chat.send()

    // Nothing pushed to the conversation.
    expect(chat.messages.value.length).toBe(0)
    expect(chat.retrievalError.value).toBe('document lock poisoned')
    // Input restored so the writer can retry.
    expect(chat.input.value).toBe('balance check')
    // We never reached the chat stream.
    expect(invoke.mock.calls.some((c) => c[0] === 'llm_chat_stream')).toBe(false)
    expect(chat.busy.value).toBe(false)
  })

  it('clears a stale retrievalError at the start of a successful structure send', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav(), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'structure'
    chat.retrievalError.value = 'stale error from before'

    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'structural_signals') {
        return { chapters: [], frontMatter: { words: 0, paragraphs: 0, sceneBreaks: 0, sectionCount: 0 }, totals: { chapters: 0, sections: 0, words: 0, paragraphs: 0, sceneBreaks: 0 } }
      }
      return 'full text'
    })

    chat.input.value = 'question'
    await chat.send()
    expect(chat.retrievalError.value).toBe('')
  })
})

// --- Summaries scope (4.8) ---------------------------------------------------
//
// The "Summaries" scope fetches the stored per-section recaps via
// `retrieve_summaries` BEFORE assembling the request (no embeddings triple —
// it's a pure Rust read of the sidecar-backed store), then threads them into
// `buildContextMessages`. An empty store is an error (not a silent empty
// context): the writer must generate summaries first. These tests drive the two
// invoke calls (retrieve_summaries + llm_chat_stream) with a per-command mock.

describe('useChat — Summaries send', () => {
  it('fetches the summaries and injects them as the context message', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav(), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'summaries'

    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'retrieve_summaries') {
        return [
          { sectionId: 's1', chapterIndex: 1, title: 'The Arrival', sectionType: 'chapter', summary: 'A stranger arrives.', stale: false },
          { sectionId: 's2', chapterIndex: 1, title: 'Notes', sectionType: 'section', summary: 'A quiet scene.', stale: false },
        ]
      }
      return 'full text'
    })

    chat.input.value = 'Trace the arc of the book.'
    await chat.send()

    // retrieve_summaries was called with NO args (the store + document are read
    // from AppState server-side, not passed in).
    const retrieveCall = invoke.mock.calls.find((c) => c[0] === 'retrieve_summaries')
    expect(retrieveCall[1]).toEqual({})
    // The request shipped to the model includes the summaries context message.
    const streamCall = invoke.mock.calls.find((c) => c[0] === 'llm_chat_stream')
    const contextMessage = streamCall[1].request.messages.find((m) =>
      m.content.includes('section summaries'),
    )
    expect(contextMessage).toBeTruthy()
    expect(contextMessage.content).toContain('Chapter 1: The Arrival')
    expect(contextMessage.content).toContain('A stranger arrives.')
    // The user's question is still the final message.
    const lastMessage = streamCall[1].request.messages[streamCall[1].request.messages.length - 1]
    expect(lastMessage.content).toBe('Trace the arc of the book.')
    // Error is clear on success.
    expect(chat.retrievalError.value).toBe('')
  })

  it('aborts on an empty summaries store, restoring input + setting retrievalError', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav(), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'summaries'

    invoke.mockImplementation(async (cmd) => {
      // The empty-store case is an error server-side ("no summaries yet…").
      if (cmd === 'retrieve_summaries') throw new Error('no summaries yet — generate them from the AI options')
      return 'full text'
    })

    chat.input.value = 'trace the arc'
    await chat.send()

    // Nothing pushed to the conversation.
    expect(chat.messages.value.length).toBe(0)
    expect(chat.retrievalError.value).toContain('no summaries yet')
    // Input restored so the writer can generate summaries + retry.
    expect(chat.input.value).toBe('trace the arc')
    // We never reached the chat stream.
    expect(invoke.mock.calls.some((c) => c[0] === 'llm_chat_stream')).toBe(false)
    expect(chat.busy.value).toBe(false)
  })

  it('clears a stale retrievalError at the start of a successful summaries send', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav(), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    chat.scope.value = 'summaries'
    chat.retrievalError.value = 'stale error from before'

    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'retrieve_summaries') {
        return [{ sectionId: 's1', chapterIndex: 1, title: 'The Arrival', sectionType: 'chapter', summary: 'r', stale: false }]
      }
      return 'full text'
    })

    chat.input.value = 'question'
    await chat.send()
    expect(chat.retrievalError.value).toBe('')
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

  it('sets the structure scope for the pacing-shape preset (4.6)', async () => {
    const doc = sampleDocument()
    const chat = useChat(docRef(doc), makeLlmSettings(), makeNav(), { value: null })
    chat.setRole({ name: 'Critic', body: 'sys' })
    // pacing-shape pre-fetches structural_signals; llm_chat_stream resolves.
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'structural_signals') {
        return { chapters: [], frontMatter: { words: 0, paragraphs: 0, sceneBreaks: 0, sectionCount: 0 }, totals: { chapters: 0, sections: 0, words: 0, paragraphs: 0, sceneBreaks: 0 } }
      }
      return 'full text'
    })

    await chat.preset('pacing-shape')
    expect(chat.scope.value).toBe('structure')
    const streamCall = invoke.mock.calls.find((c) => c[0] === 'llm_chat_stream')
    const lastMessage = streamCall[1].request.messages[streamCall[1].request.messages.length - 1]
    expect(lastMessage.content).toContain('macro pacing and structure')
  })

  it('PRESETS has exactly five presets with the expected ids', () => {
    const ids = PRESETS.map((p) => p.id)
    expect(ids).toEqual(['summarize', 'critique', 'pacing', 'pacing-shape', 'suggest'])
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