import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useDocumentStore } from '../stores/document.js'

vi.mock('@tauri-apps/api/tauri', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/tauri'
import { useRetrieval } from './useRetrieval.js'

// A stand-in for the RAW useLlmSettings() composable: same shape useRetrieval
// reads (`settings.value.*`). A plain `ref` keeps the test independent of the
// singleton's persisted localStorage state (and lets each test pick its own
// enabled/model config).
function makeLlmSettings(overrides = {}) {
  const settings = ref({
    embeddingsEnabled: false,
    embeddingsEndpoint: 'http://localhost:11434',
    embeddingsApiKey: '',
    embeddingsModel: 'nomic-embed-text',
    ...overrides,
  })
  return { settings }
}

// A typical successful report shape (camelCase, as Rust serializes it).
function report(over = {}) {
  return {
    builtFromScratch: true,
    sectionsEmbedded: 2,
    chunksEmbedded: 2,
    chunksTotal: 2,
    ...over,
  }
}

describe('useRetrieval', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does nothing while the index is disabled', async () => {
    invoke.mockResolvedValue(report())
    const store = useDocumentStore()
    const llm = makeLlmSettings({ embeddingsEnabled: false })
    const { reembedStatus } = useRetrieval(store, llm)

    store.docVersion++ // an edit happened
    await vi.advanceTimersByTimeAsync(1500)

    expect(invoke).not.toHaveBeenCalled()
    expect(reembedStatus.value).toBe('idle')
  })

  it('fires reembed_document after a docVersion bump when enabled (debounced)', async () => {
    invoke.mockResolvedValue(report({ chunksTotal: 2 }))
    const store = useDocumentStore()
    const llm = makeLlmSettings({ embeddingsEnabled: true })
    const { reembedStatus, reembedReport } = useRetrieval(store, llm)

    store.docVersion++
    // Before the 1500ms debounce window elapses, no call and status unchanged.
    await vi.advanceTimersByTimeAsync(1499)
    expect(invoke).not.toHaveBeenCalled()
    // Crossing 1500ms fires the call; the async mock resolves within the flush.
    await vi.advanceTimersByTimeAsync(1)
    expect(invoke).toHaveBeenCalledWith('reembed_document', {
      endpoint: 'http://localhost:11434',
      apiKey: null, // empty key → null → Rust Option<String> = None
      model: 'nomic-embed-text',
    })
    expect(reembedStatus.value).toBe('ready')
    expect(reembedReport.value.chunksTotal).toBe(2)
  })

  it('collapses a burst of edits into one re-embed (last edit wins)', async () => {
    invoke.mockResolvedValue(report({ chunksTotal: 5 }))
    const store = useDocumentStore()
    const llm = makeLlmSettings({ embeddingsEnabled: true })
    useRetrieval(store, llm)

    // Three edits 500ms apart; each bump resets the debounce timer, so only one
    // re-embed fires — after the last bump's 1500ms.
    store.docVersion++
    await vi.advanceTimersByTimeAsync(500)
    store.docVersion++
    await vi.advanceTimersByTimeAsync(500)
    store.docVersion++
    await vi.advanceTimersByTimeAsync(1500)

    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('triggers an immediate full build when the index is toggled on', async () => {
    invoke.mockResolvedValue(report({ chunksTotal: 3 }))
    const store = useDocumentStore()
    const llm = makeLlmSettings({ embeddingsEnabled: false })
    const { reembedStatus } = useRetrieval(store, llm)

    llm.settings.value.embeddingsEnabled = true
    // Flush the Vue watcher (microtask) + the invoke mock resolution. The
    // toggle-on path calls reembedNow directly — no debounce timer — so a 0ms
    // advance (which still flushes microtasks) is enough.
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(reembedStatus.value).toBe('ready')
  })

  it('does not fire when toggled on with no embeddings model configured', async () => {
    const store = useDocumentStore()
    const llm = makeLlmSettings({ embeddingsEnabled: false, embeddingsModel: '' })
    const { reembedStatus } = useRetrieval(store, llm)

    llm.settings.value.embeddingsEnabled = true
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)

    expect(invoke).not.toHaveBeenCalled()
    expect(reembedStatus.value).toBe('idle')
  })

  it('goes to error status when the invoke rejects', async () => {
    invoke.mockRejectedValue('model not found')
    const store = useDocumentStore()
    const llm = makeLlmSettings({ embeddingsEnabled: true })
    const { reembedStatus, reembedError } = useRetrieval(store, llm)

    store.docVersion++
    await vi.advanceTimersByTimeAsync(1500)

    expect(reembedStatus.value).toBe('error')
    expect(reembedError.value).toBe('model not found')
  })

  it('returns to idle and cancels a pending re-embed when toggled off', async () => {
    invoke.mockResolvedValue(report())
    const store = useDocumentStore()
    const llm = makeLlmSettings({ embeddingsEnabled: true })
    const { reembedStatus } = useRetrieval(store, llm)

    store.docVersion++ // arm a pending (debounced) re-embed
    await vi.advanceTimersByTimeAsync(500) // halfway through the debounce
    llm.settings.value.embeddingsEnabled = false
    await vi.advanceTimersByTimeAsync(0) // let the toggle watcher clear the timer
    await vi.advanceTimersByTimeAsync(1500) // the original 1500ms would have fired here

    expect(invoke).not.toHaveBeenCalled() // the pending timer was cleared, not fired
    expect(reembedStatus.value).toBe('idle')
  })
})