// Thin wrapper over the Rust `llm_list_models` command. Keeping model
// discovery behind the Rust proxy (not a webview fetch) means the API key
// never appears in inspectable fetch headers — every provider network call
// goes through the one Rust boundary. The Rust command handles the
// `/v1/models` → `/api/tags` fallback and Bearer auth for Ollama Cloud.

import { invoke } from '@tauri-apps/api/tauri'

/// Fetch the list of model names available at the endpoint. Throws on error
/// (caught by the settings UI to show "can't reach endpoint").
export async function fetchModels({ endpoint, apiKey }) {
  return invoke('llm_list_models', { endpoint, apiKey: apiKey || null })
}