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
            :value="llmSettings.settings.value.endpoint"
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
            :value="llmSettings.settings.value.model"
            @change="e => llmSettings.setModel(e.target.value)"
          >
            <option value="" disabled>Choose a model…</option>
            <option v-for="name in modelList" :key="name" :value="name">{{ name }}</option>
          </select>
          <p v-if="modelsError" class="ai-error">{{ modelsError }}</p>

          <label class="drawer-label">API Key (optional — required for Ollama Cloud)</label>
          <input
            class="drawer-input"
            type="password"
            :value="llmSettings.settings.value.apiKey"
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
            :value="llmSettings.settings.value.temperature ?? ''"
            @input="e => {
              const v = e.target.value
              llmSettings.setSettings({ temperature: v === '' ? null : Number(v) })
            }"
          />

          <button class="ai-test-btn" @click="testConnection" :disabled="testingConnection">
            {{ testingConnection ? 'Testing…' : 'Test connection' }}
          </button>
          <p v-if="testResult" class="ai-test-result" :class="{ ok: testOk }">
            {{ testResult }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/tauri'
import { fetchModels } from '../composables/useLlmModels.js'

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
})

const expandedSections = ref({ 'chapter-naming': true, 'document-info': false, 'ai-assistant': false })

// Live preview of how the configured prefix + numbering render for a chapter
// with a sample subtitle. formatChapter(3) yields e.g. "Chapter 3: ".
const previewTitle = computed(() => {
  const prefix = props.sectionFormat.formatChapter(3)
  return prefix + 'The Arrival'
})

// --- AI Assistant model discovery + test connection ---

const modelList = ref([])
const modelsLoading = ref(false)
const modelsError = ref('')
const testingConnection = ref(false)
const testResult = ref('')
const testOk = ref(false)

async function fetchModelList() {
  modelsLoading.value = true
  modelsError.value = ''
  try {
    modelList.value = await fetchModels({
      endpoint: props.llmSettings.settings.value.endpoint,
      apiKey: props.llmSettings.settings.value.apiKey,
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
    // A trivial ping via the one-shot chat command confirms the endpoint +
    // model + auth are all valid end-to-end.
    await invoke('llm_chat', {
      request: {
        endpoint: props.llmSettings.settings.value.endpoint,
        model: props.llmSettings.settings.value.model,
        apiKey: props.llmSettings.settings.value.apiKey || null,
        temperature: null,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      },
    })
    testResult.value = '✓ connected'
    testOk.value = true
  } catch (e) {
    testResult.value = '✗ ' + (typeof e === 'string' ? e : String(e))
    testOk.value = false
  } finally {
    testingConnection.value = false
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
</style>