<template>
  <div class="drawer left" :class="{ open }">
    <div class="drawer-content">
      <div class="general-options">
        <h3 class="drawer-heading">General Options</h3>

        <!-- Chapter Naming accordion — replaces the old 6-level Heading
             Options. Sections are flat now, so there is one auto-numbered kind
             (Chapter) whose prefix word + numbering scheme are configured here.
             The number itself is render-derived (position among Chapter-type
             sections), so it is never stored or entered. -->
        <button
          class="accordion-header"
          :class="{ active: expandedSections['chapter-naming'] }"
          @click="expandedSections['chapter-naming'] = !expandedSections['chapter-naming']"
        >
          <span>Chapter Naming</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ rotated: expandedSections['chapter-naming'] }">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <div v-show="expandedSections['chapter-naming']" class="accordion-body">
          <label class="drawer-label">Prefix</label>
          <input
            class="drawer-input"
            :value="sectionFormat.sectionFormat.prefix"
            @input="e => sectionFormat.setFormat({ prefix: e.target.value })"
          />
          <label class="drawer-label">Numbering</label>
          <select
            class="drawer-input"
            :value="sectionFormat.sectionFormat.numbering"
            @change="e => sectionFormat.setFormat({ numbering: e.target.value })"
          >
            <option value="arabic">Arabic (1, 2, 3)</option>
            <option value="roman">Roman (I, II, III)</option>
          </select>
          <div class="drawer-preview">
            <span class="drawer-label">Preview</span>
            <div class="preview-text">{{ previewTitle }}</div>
          </div>
        </div>

        <!-- Document Info accordion -->
        <button
          class="accordion-header"
          :class="{ active: expandedSections['document-info'] }"
          @click="expandedSections['document-info'] = !expandedSections['document-info']"
        >
          <span>Document Info</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ rotated: expandedSections['document-info'] }">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <div v-show="expandedSections['document-info']" class="accordion-body">
          <label class="drawer-label">Title</label>
          <input class="drawer-input" :value="store.doc?.title || ''" @input="e => { store.doc.title = e.target.value; store.markModified() }" />
          <label class="drawer-label">Author</label>
          <input class="drawer-input" :value="store.doc?.author || ''" @input="e => { store.doc.author = e.target.value; store.markModified() }" />
          <label class="drawer-label">Contact Info</label>
          <textarea class="drawer-textarea" :value="store.doc?.authorContact || ''" @input="e => { store.doc.authorContact = e.target.value; store.markModified() }" rows="4" />
          <div class="drawer-check">
            <input id="toc" type="checkbox" :checked="store.doc?.hasTOC" @change="e => { store.doc.hasTOC = e.target.checked; store.markModified() }" />
            <label for="toc">Table of Contents</label>
          </div>
          <div class="drawer-check">
            <input id="epigram" type="checkbox" :checked="store.doc?.hasEpigram" @change="e => { store.doc.hasEpigram = e.target.checked; store.markModified() }" />
            <label for="epigram">Epigram Page</label>
          </div>
          <template v-if="store.doc?.hasEpigram">
            <label class="drawer-label">Epigram Text</label>
            <textarea class="drawer-textarea" :value="store.doc?.epigramText || ''" @input="e => { store.doc.epigramText = e.target.value; store.markModified() }" rows="3" />
          </template>
        </div>

        <!-- AI Assistant accordion — BYOK provider config. Endpoint + model +
             optional API key for any OpenAI-compatible server (Ollama local,
             Ollama Cloud, etc.). Bound to the useLlmSettings singleton so the
             Assistant panel sees changes immediately. -->
        <button
          class="accordion-header"
          :class="{ active: expandedSections['ai-assistant'] }"
          @click="expandedSections['ai-assistant'] = !expandedSections['ai-assistant']"
        >
          <span>AI Assistant</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ rotated: expandedSections['ai-assistant'] }">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <div v-show="expandedSections['ai-assistant']" class="accordion-body">
          <label class="drawer-label">Endpoint</label>
          <input
            class="drawer-input"
            :value="llmSettings.settings.endpoint"
            @input="e => llmSettings.setSettings({ endpoint: e.target.value })"
            placeholder="http://localhost:11434"
          />

          <label class="drawer-label">
            Model
            <button class="ai-refresh-btn" @click="fetchModelList" :disabled="modelsLoading" title="Refresh model list">
              {{ modelsLoading ? '…' : '↻' }}
            </button>
          </label>
          <select
            class="drawer-input"
            :value="llmSettings.settings.model"
            @change="e => llmSettings.setModel(e.target.value)"
          >
            <option value="" disabled>Choose a model…</option>
            <option v-for="name in modelList" :key="name" :value="name">{{ name }}</option>
          </select>
          <p v-if="modelsError" class="ai-error">{{ modelsError }}</p>

          <!-- Embeddings (RAG retrieval, Phase 4) have their OWN endpoint + key,
               separate from chat: Ollama Cloud hosts only large chat models, not
               embeddings models, so a writer on Cloud for chat runs a local
               Ollama for embeddings. Defaulted to local Ollama (no key). -->
          <label class="drawer-label">Embeddings endpoint</label>
          <input
            class="drawer-input"
            :value="llmSettings.settings.embeddingsEndpoint"
            @input="e => llmSettings.setSettings({ embeddingsEndpoint: e.target.value })"
            placeholder="http://localhost:11434"
          />
          <label class="drawer-label">Embeddings API key (optional — empty for local Ollama)</label>
          <input
            class="drawer-input"
            type="password"
            :value="llmSettings.settings.embeddingsApiKey"
            @input="e => llmSettings.setSettings({ embeddingsApiKey: e.target.value })"
            placeholder="Empty for local Ollama"
          />
          <label class="drawer-label">Embeddings model</label>
          <input
            class="drawer-input"
            :value="llmSettings.settings.embeddingsModel"
            @input="e => llmSettings.setSettings({ embeddingsModel: e.target.value })"
            placeholder="nomic-embed-text"
          />
          <p class="ai-context-hint">
            Turns manuscript passages into vectors so the assistant can read only
            the parts relevant to a question (Phase 4). Ollama Cloud doesn't host
            embeddings models — point the endpoint above at a local Ollama and
            pull the model there (e.g. ollama pull nomic-embed-text). Test it
            below before relying on it.
          </p>
          <button class="ai-test-btn" @click="testEmbeddings" :disabled="testingEmbeddings">
            {{ testingEmbeddings ? 'Testing…' : 'Test embeddings' }}
          </button>
          <p v-if="embeddingsTestResult" class="ai-test-result" :class="{ ok: embeddingsTestOk }">
            {{ embeddingsTestResult }}
          </p>

          <!-- Manuscript index opt-in (Phase 4.3). When on, the manuscript is
               chunked + embedded in the background ~1.5s after each edit and
               kept current in Rust's in-memory vector store, so 4.4 can feed
               the assistant only the passages relevant to a question instead of
               the whole manuscript. Off by default: a writer without a local
               Ollama isn't peppered with failing embedding calls. The status
               line below makes the index observable before retrieval is wired
               in. Toggling on triggers an immediate full build. -->
          <div class="drawer-check">
            <input
              id="embeddings-enabled"
              type="checkbox"
              :checked="llmSettings.settings.embeddingsEnabled"
              @change="e => llmSettings.setSettings({ embeddingsEnabled: e.target.checked })"
            />
            <label for="embeddings-enabled">Enable manuscript index for document-aware chat</label>
          </div>
          <p class="ai-context-hint index-status" :class="indexStatusClass">
            {{ indexStatusText }}
          </p>

          <label class="drawer-label">API Key (optional — required for Ollama Cloud)</label>
          <input
            class="drawer-input"
            type="password"
            :value="llmSettings.settings.apiKey"
            @input="e => llmSettings.setSettings({ apiKey: e.target.value })"
            placeholder="Empty for local Ollama"
          />

          <label class="drawer-label">Temperature (0–1, blank = server default)</label>
          <input
            class="drawer-input"
            type="number"
            min="0"
            max="1"
            step="0.1"
            :value="llmSettings.settings.temperature ?? ''"
            @input="e => {
              const v = e.target.value
              llmSettings.setSettings({ temperature: v === '' ? null : Number(v) })
            }"
          />

          <label class="drawer-label">Context length (tokens — used for the panel's usage readout)</label>
          <input
            class="drawer-input"
            type="number"
            min="512"
            step="512"
            :value="llmSettings.settings.contextLength"
            @input="e => {
              const v = Number(e.target.value)
              // Empty/non-numeric input falls back to the default rather than
              // persisting NaN or 0 (which would make the readout divide-by-zero
              // or show a nonsensical window).
              llmSettings.setSettings({ contextLength: v >= 512 ? v : 8192 })
            }"
          />
          <p class="ai-context-hint">
            The model's context window can't be auto-detected from the server, so
            set it here. The Assistant panel shows how much of it your assembled
            request consumes. 8192 fits common local models; raise it for a
            larger-context model.
          </p>

          <button class="ai-test-btn" @click="testConnection" :disabled="testingConnection">
            {{ testingConnection ? 'Testing…' : 'Test connection' }}
          </button>
          <p v-if="testResult" class="ai-test-result" :class="{ ok: testOk }">
            {{ testResult }}
          </p>
        </div>

        <!-- Roles accordion (Phase 4.5) — manage user-authored personas.
             Built-in roles (●) are read-only here; custom roles (◆) can be
             edited or deleted. "copy" forks a built-in into an editable user
             role (saving with the built-in's exact name creates an override).
             The Prompt body field edits only the persona — the shared
             analytical-only base rules are composed on top by Rust and are
             never shown or editable here. -->
        <button
          class="accordion-header"
          :class="{ active: expandedSections['roles'] }"
          @click="expandedSections['roles'] = !expandedSections['roles']"
        >
          <span>Roles</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ rotated: expandedSections['roles'] }">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <div v-show="expandedSections['roles']" class="accordion-body">
          <ul class="role-list">
            <li v-for="role in roles.roles" :key="role.name" class="role-row">
              <span class="role-name">
                <span class="role-badge" :class="{ builtin: role.isBuiltIn }" :title="role.isBuiltIn ? 'Built-in' : 'Custom'">{{ role.isBuiltIn ? '●' : '◆' }}</span>
                {{ role.name }}
              </span>
              <span class="role-actions">
                <button v-if="role.isBuiltIn" class="role-mini-btn" @click="roles.copyToCustom(role)" title="Copy to a custom role">copy</button>
                <template v-else>
                  <button class="role-mini-btn" @click="roles.startEdit(role)" title="Edit">edit</button>
                  <button class="role-mini-btn danger" @click="roles.remove(role)" title="Delete">delete</button>
                </template>
              </span>
            </li>
          </ul>
          <button class="ai-test-btn" @click="roles.startNew" :disabled="roles.isCreating || roles.editing">+ New role</button>

          <div v-if="roles.isCreating || roles.editing" class="role-editor">
            <label class="drawer-label">
              {{ roles.isCreating ? 'New role' : 'Editing: ' + roles.editing.name }}
            </label>
            <input class="drawer-input" :value="roles.draftName" @input="e => roles.draftName = e.target.value" placeholder="Role name" />
            <label class="drawer-label">Description</label>
            <input class="drawer-input" :value="roles.draftDescription" @input="e => roles.draftDescription = e.target.value" placeholder="One-line description" />
            <label class="drawer-label">Prompt body</label>
            <textarea class="drawer-textarea" :value="roles.draftBody" @input="e => roles.draftBody = e.target.value" rows="8" placeholder="You are a…"></textarea>
            <p class="ai-context-hint">The shared analytical-only rules (never write prose into the doc) are always applied on top — you only edit this role's persona.</p>
            <p v-if="roles.roleError" class="ai-test-result">{{ roles.roleError }}</p>
            <div class="role-editor-actions">
              <button class="ai-test-btn" @click="roles.save" :disabled="roles.roleSaving">{{ roles.roleSaving ? 'Saving…' : 'Save' }}</button>
              <button class="ai-test-btn ghost" @click="roles.cancelEdit">Cancel</button>
              <button v-if="!roles.isCreating && roles.editing" class="ai-test-btn danger" @click="roles.remove(roles.editing)">Delete</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/tauri'
import { fetchModels } from '../composables/useLlmModels.js'
import { useRoles } from '../composables/useRoles.js'

// Receives the document store, the section-format composable, and the
// llm-settings composable as props and drives them directly. These are
// app-specific config panels coupled to the preference composables by nature,
// so the coupling is honest; keeping it behind emits would be plumbing for no
// reuse benefit. Accordion expansion state is local — nothing else reads it.
const props = defineProps({
  open: { type: Boolean, default: false },
  store: { type: Object, required: true },
  sectionFormat: { type: Object, required: true },
  llmSettings: { type: Object, required: true },
  // The useRetrieval composable (reactive) from App.vue — exposes
  // `reembedStatus` / `reembedReport` / `reembedError` for the index-status
  // readout. May be absent in contexts that don't wire retrieval, so it is
  // optional and the status computed guards against that.
  retrieval: { type: Object, default: null },
  // The reactive useChatManager from App.vue — owns the merged role list
  // (`roles`) + `refreshRoles()`. The Roles accordion's editor (useRoles)
  // reads the list from it and calls `refreshRoles()` after a save/delete so
  // the Assistant role selector updates live.
  chatManager: { type: Object, required: true },
})

const expandedSections = ref({ 'chapter-naming': true, 'document-info': false, 'ai-assistant': false, 'roles': false })

// Role editor (Phase 4.5). Wrapped in `reactive()` so its nested refs
// (`draftName` / `isCreating` / `roles` / …) auto-unwrap in the template — the
// same pattern App.vue uses for every composable. Reads the list + refresh hook
// off the reactive `chatManager` prop.
const roles = reactive(useRoles(props.chatManager))

// Live preview of how the configured prefix + numbering render for a chapter
// with a sample subtitle. formatChapter(3) yields e.g. "Chapter 3: ".
const previewTitle = computed(() => {
  const prefix = props.sectionFormat.formatChapter(3)
  return prefix + 'The Arrival'
})

// Index-status readout for the manuscript index (Phase 4.3). Maps the four
// `reembedStatus` states to a one-line, human-readable status, pulling the
// "ready" counts from the last `ReembedReport`. Reactive through
// `props.retrieval` — App.vue wraps useRetrieval in `reactive()`, so its ref
// members (`reembedStatus` / `reembedReport` / `reembedError`) auto-unwrap and
// the computed re-evaluates as they change. When indexing is off (or the
// composable isn't wired), the line just reads "Index: off".
const indexStatusText = computed(() => {
  const retrieval = props.retrieval
  if (!retrieval || !props.llmSettings.settings.embeddingsEnabled) return 'Index: off'
  switch (retrieval.reembedStatus) {
    case 'indexing':
      return 'Indexing…'
    case 'error':
      return 'Index error: ' + (retrieval.reembedError || 'unknown')
    case 'ready': {
      const report = retrieval.reembedReport
      if (!report) return 'Index: up to date'
      return `Index: ${report.chunksTotal} chunks · ${report.sectionsEmbedded} sections · up to date`
    }
    default:
      return 'Index: off'
  }
})

// Color cue for the status line: green when ready, red on error, neutral
// otherwise (off / indexing). Reuses `.ai-context-hint` as the base style and
// only overrides the color via these classes.
const indexStatusClass = computed(() => {
  const retrieval = props.retrieval
  if (!retrieval) return ''
  if (retrieval.reembedStatus === 'error') return 'is-error'
  if (retrieval.reembedStatus === 'ready') return 'is-ok'
  return ''
})

// --- AI Assistant model discovery + test connection ---

const modelList = ref([])
const modelsLoading = ref(false)
const modelsError = ref('')
const testingConnection = ref(false)
const testResult = ref('')
const testOk = ref(false)
const testingEmbeddings = ref(false)
const embeddingsTestResult = ref('')
const embeddingsTestOk = ref(false)

async function fetchModelList() {
  modelsLoading.value = true
  modelsError.value = ''
  try {
    modelList.value = await fetchModels({
      endpoint: props.llmSettings.settings.endpoint,
      apiKey: props.llmSettings.settings.apiKey,
    })
  } catch (e) {
    modelsError.value = typeof e === 'string' ? e : String(e)
    modelList.value = []
  } finally {
    modelsLoading.value = false
  }
}

async function testConnection() {
  testingConnection.value = true
  testResult.value = ''
  testOk.value = false
  try {
    // Test connection by fetching the model list — this validates the endpoint
    // + auth WITHOUT requiring a model to be selected first (a chat completion
    // needs a model name, but the models endpoint just lists what's available).
    // Also refreshes the <select> so a successful test immediately populates
    // the model picker.
    const models = await fetchModels({
      endpoint: props.llmSettings.settings.endpoint,
      apiKey: props.llmSettings.settings.apiKey,
    })
    modelList.value = models
    testResult.value = `✓ connected (${models.length} model${models.length === 1 ? '' : 's'})`
    testOk.value = true
  } catch (e) {
    testResult.value = '✗ ' + (typeof e === 'string' ? e : String(e))
    testOk.value = false
  } finally {
    testingConnection.value = false
  }
}

async function testEmbeddings() {
  testingEmbeddings.value = true
  embeddingsTestResult.value = ''
  embeddingsTestOk.value = false
  try {
    // Embed a one-word probe with the configured embeddings model. Unlike the
    // chat "Test connection" (which only lists models — no model needed), this
    // actually RUNS the embeddings model, so it confirms the model is pulled
    // AND the endpoint serves embeddings before Phase 4.3/4.4 rely on it. The
    // returned vector's length is the model's embedding dimension (e.g. 768 for
    // nomic-embed-text), which is useful to see.
    //
    // Uses the SEPARATE embeddings endpoint/key (not the chat endpoint/key):
    // a writer on Ollama Cloud for chat runs a local Ollama for embeddings,
    // since Cloud doesn't host embeddings models.
    const vectors = await invoke('embed_texts', {
      endpoint: props.llmSettings.settings.embeddingsEndpoint,
      apiKey: props.llmSettings.settings.embeddingsApiKey,
      model: props.llmSettings.settings.embeddingsModel,
      texts: ['probe'],
    })
    embeddingsTestResult.value = `✓ embeddings OK (${vectors[0].length}-dim)`
    embeddingsTestOk.value = true
  } catch (e) {
    embeddingsTestResult.value = '✗ ' + (typeof e === 'string' ? e : String(e))
    embeddingsTestOk.value = false
  } finally {
    testingEmbeddings.value = false
  }
}

// Fetch the model list when the AI Assistant accordion first opens, so the
// <select> is populated without an extra click.
watch(
  () => expandedSections.value['ai-assistant'],
  (isOpen) => {
    if (isOpen && modelList.value.length === 0 && !modelsError.value) {
      fetchModelList()
    }
  },
)
</script>

<style scoped>
/* Base drawer shell — duplicated per drawer component by convention (see
   NavigationDrawer.vue); scoped styles only reach this component's template. */
.drawer {
  position: fixed;
  top: 38px;
  bottom: 36px;
  width: 260px;
  transition: transform 0.25s ease;
  z-index: 25;
}

.drawer.left {
  left: 48px;
  transform: translateX(-100%);
}

.drawer.left.open {
  transform: translateX(0);
}

.drawer-content {
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  background: var(--glass-bg);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border-right: 1px solid var(--bg-glass-border);
}

.drawer-heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.drawer-label {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
  margin-top: 10px;
}

.drawer-input,
.drawer-textarea {
  width: 100%;
  background: var(--input-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: 6px;
  padding: 6px 8px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  resize: vertical;
}

.drawer-input:focus,
.drawer-textarea:focus {
  border-color: var(--accent);
}

.drawer-check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 13px;
  color: var(--text-primary);
}

.drawer-check input {
  accent-color: var(--accent);
}

.drawer-preview {
  margin-top: 12px;
}

.preview-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding: 8px 10px;
  background: var(--input-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: 6px;
}

.general-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.accordion-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 0;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--bg-glass-border);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  user-select: none;
}

.accordion-header svg {
  transition: transform 0.2s ease;
  color: var(--text-secondary);
}

.accordion-header svg.rotated {
  transform: rotate(180deg);
}

.accordion-body {
  padding: 8px 0 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* AI Assistant accordion bits */
.ai-refresh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 6px;
  padding: 0;
  border: 1px solid var(--bg-glass-border);
  border-radius: 4px;
  background: var(--input-bg);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  vertical-align: middle;
}

.ai-refresh-btn:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
}

.ai-refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-error {
  font-size: 11px;
  color: #e88;
  margin: 0;
}

/* Explanatory note under the Context length input. Muted like the error/test
   lines but neutral (not a warning), using the secondary text token. */
.ai-context-hint {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 4px 0 0 0;
  line-height: 1.4;
}

.ai-test-btn {
  margin-top: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--accent);
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
}

.ai-test-btn:hover:not(:disabled) {
  background: var(--accent-hover);
  color: var(--text-primary);
}

.ai-test-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-test-result {
  font-size: 12px;
  margin: 4px 0 0;
  color: #e88;
}

.ai-test-result.ok {
  color: #6c6;
}

/* Index-status line (Phase 4.3). Built on `.ai-context-hint` (muted neutral);
   these modifiers only recolor it — green when the index is current, red when
   the last re-embed failed — so it reads at a glance like the test-result lines. */
.index-status.is-ok {
  color: #6c6;
}

.index-status.is-error {
  color: #e88;
}

/* Roles accordion (Phase 4.5) */
.role-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.role-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
}

.role-row:hover {
  background: var(--input-bg);
}

.role-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-badge {
  font-size: 10px;
  color: var(--text-secondary);
  flex: 0 0 auto;
}

.role-badge.builtin {
  color: var(--accent);
}

.role-actions {
  display: flex;
  gap: 4px;
  flex: 0 0 auto;
}

.role-mini-btn {
  padding: 2px 6px;
  border: 1px solid var(--bg-glass-border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.role-mini-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.role-mini-btn.danger:hover {
  color: #e88;
  border-color: #e88;
}

.role-editor {
  margin-top: 8px;
  padding: 10px;
  border: 1px solid var(--bg-glass-border);
  border-radius: 8px;
  background: var(--input-bg);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* A label inside the editor's tinted box needs a touch of top margin so the
   first one isn't flush against the box's padding. */
.role-editor .drawer-label {
  margin-top: 2px;
}

.role-editor-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
}

/* Button variants for the editor action row: ghost (cancel) is neutral, danger
   (delete) is red. Built on `.ai-test-btn` (accent by default). */
.ai-test-btn.ghost {
  border-color: var(--bg-glass-border);
  background: transparent;
  color: var(--text-secondary);
}

.ai-test-btn.ghost:hover:not(:disabled) {
  background: var(--input-bg);
  color: var(--text-primary);
}

.ai-test-btn.danger {
  border-color: #e88;
  background: transparent;
  color: #e88;
  margin-left: auto;
}

.ai-test-btn.danger:hover:not(:disabled) {
  background: #e88;
  color: var(--text-primary);
}
</style>