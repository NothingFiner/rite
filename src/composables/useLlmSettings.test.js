import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useLlmSettings, resetLlmSettingsForTests } from './useLlmSettings.js'

const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => { store[key] = String(value) }),
    clear: () => { store = {} },
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

beforeEach(() => {
  localStorageMock.clear()
  vi.clearAllMocks()
  resetLlmSettingsForTests()
})

describe('useLlmSettings', () => {
  it('has sensible defaults (local Ollama endpoint, no model, no key)', () => {
    const llm = useLlmSettings()
    expect(llm.settings.value.endpoint).toBe('http://localhost:11434')
    expect(llm.settings.value.model).toBe('')
    expect(llm.settings.value.apiKey).toBe('')
    expect(llm.settings.value.temperature).toBeNull()
  })

  it('saves settings to localStorage', () => {
    const llm = useLlmSettings()
    llm.setSettings({ endpoint: 'https://ollama.com' })
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'rite-llm-settings',
      expect.stringContaining('https://ollama.com')
    )
  })

  it('loads saved settings', () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify({
      endpoint: 'https://ollama.com',
      model: 'gpt-oss:120b',
      apiKey: 'sk-test',
      temperature: 0.3,
    }))
    const llm = useLlmSettings()
    llm.loadPrefs()
    expect(llm.settings.value.endpoint).toBe('https://ollama.com')
    expect(llm.settings.value.model).toBe('gpt-oss:120b')
    expect(llm.settings.value.apiKey).toBe('sk-test')
    expect(llm.settings.value.temperature).toBe(0.3)
  })

  it('merges saved settings with defaults (missing fields fall back)', () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify({ model: 'llama3' }))
    const llm = useLlmSettings()
    llm.loadPrefs()
    expect(llm.settings.value.model).toBe('llama3')
    // endpoint falls back to the default
    expect(llm.settings.value.endpoint).toBe('http://localhost:11434')
  })

  it('setModel persists the model name', () => {
    const llm = useLlmSettings()
    llm.setModel('qwen2.5')
    expect(llm.settings.value.model).toBe('qwen2.5')
    expect(localStorageMock.setItem).toHaveBeenCalled()
  })

  it('shares one settings object across callers (module-level singleton)', () => {
    const a = useLlmSettings()
    const b = useLlmSettings()
    a.setSettings({ model: 'mistral' })
    expect(b.settings.value.model).toBe('mistral')
  })

  it('survives a corrupted localStorage entry (defensive)', () => {
    localStorageMock.getItem.mockReturnValue('{not json')
    const llm = useLlmSettings()
    llm.loadPrefs() // should not throw
    expect(llm.settings.value.endpoint).toBe('http://localhost:11434')
  })
})