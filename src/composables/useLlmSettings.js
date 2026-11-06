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
    // The model's context-window size in tokens. NOT auto-detected: the
    // llm_list_models command returns model names only (Ollama's /api/tags and
    // OpenAI's /v1/models don't expose context length), so the writer tells us.
    // Used by the Assistant panel's token-usage readout (Phase 3.4). 8192 is a
    // reasonable default for common local models (e.g. llama3); bump it for a
    // larger-context model. Backward-compatible: loadPrefs merges over these
    // defaults, so existing saved settings gain this on next load.
    contextLength: 8192,
    // Embeddings (RAG retrieval, Phase 4.2+) need their OWN endpoint + key,
    // separate from chat. Reason: Ollama Cloud hosts only large
    // chat/generation models — it does NOT host embeddings models
    // (nomic-embed-text and friends are small and run locally). So a writer on
    // Cloud for chat still runs a LOCAL Ollama for embeddings. Defaulting the
    // embeddings endpoint to local Ollama (no key) makes that work out of the
    // box; a writer whose chat is also local just has two identical endpoints.
    // Backward-compatible: loadPrefs merges over these defaults, so older saved
    // settings blobs gain both fields on next load.
    embeddingsEndpoint: 'http://localhost:11434',
    embeddingsApiKey: '',
    // The embeddings model used by RAG retrieval (Phase 4.2 embed → 4.3 store →
    // 4.4 retrieve). Kept SEPARATE from the chat `model` because an embeddings
    // model and a chat model are different binaries you pull independently
    // (nomic-embed-text turns text into vectors; llama3 answers questions).
    // Same backward-compatibility story as contextLength: older saved settings
    // blobs predate this field, so loadPrefs's merge-over-defaults supplies it.
    embeddingsModel: 'nomic-embed-text',
    // Opt-in toggle for the manuscript index (Phase 4.3). When off, no
    // `reembed_document` calls are ever fired — a writer without a local
    // Ollama isn't peppered with failing embedding requests. When on, the
    // index refreshes ~1.5s after each edit (debounced in `useRetrieval`) so
    // it's always current for 4.4's retrieval. Default off for the same
    // backward-compat reason as the fields above: older saved blobs gain
    // `false` on next load, so embeddings stay off until the writer turns it
    // on explicitly.
    embeddingsEnabled: false,
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