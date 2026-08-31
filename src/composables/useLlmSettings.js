import { ref } from 'vue'

// BYOK LLM provider config: a generic OpenAI-compatible endpoint + model +
// optional API key. Target is Ollama — both local (http://localhost:11434,
// no auth) and Ollama Cloud (https://ollama.com, Bearer key). The config is
// generic enough that any OpenAI-compatible server works.
//
// Singleton pattern (module-level shared ref) mirroring useSectionFormat: the
// General Options drawer and the Assistant panel see the same config, so a
// model picked in settings is immediately the model the panel sends to.
// Persisted to localStorage key `rite-llm-settings`. The API key lives here
// (in localStorage, client-side) and is passed into each Rust command call —
// Rust never holds it in a long-lived mutex/AppState, keeping the boundary
// clean.

function defaultSettings() {
  return {
    endpoint: 'http://localhost:11434',
    model: '',
    apiKey: '',
    temperature: null, // null = server default
  }
}

let llmSettingsRef = null
function sharedSettings() {
  if (!llmSettingsRef) llmSettingsRef = ref(defaultSettings())
  return llmSettingsRef
}

// Test-only: reset the shared ref so mutations in one test don't leak into the
// next. Not called in production.
export function resetLlmSettingsForTests() {
  llmSettingsRef = ref(defaultSettings())
}

export function useLlmSettings() {
  const settings = sharedSettings()

  function loadPrefs() {
    try {
      const raw = localStorage.getItem('rite-llm-settings')
      if (raw) {
        const parsed = JSON.parse(raw)
        settings.value = { ...defaultSettings(), ...parsed }
      }
    } catch {}
  }

  function savePrefs() {
    try {
      localStorage.setItem('rite-llm-settings', JSON.stringify(settings.value))
    } catch {}
  }

  function setSettings(updates) {
    settings.value = { ...settings.value, ...updates }
    savePrefs()
  }

  function setModel(name) {
    settings.value = { ...settings.value, model: name }
    savePrefs()
  }

  return {
    settings,
    loadPrefs,
    savePrefs,
    setSettings,
    setModel,
  }
}