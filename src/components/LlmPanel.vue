<template>
  <div class="llm-panel">
    <h3 class="drawer-heading">Assistant</h3>

    <!-- Role selector: the chosen persona's composed body becomes the system
         prompt. Presets layer on top; they don't replace the role. -->
    <div class="llm-role-row">
      <select
        class="drawer-input llm-role-select"
        :value="chat.selectedRoleName"
        @change="onRoleChange"
      >
        <option value="" disabled>Select a role…</option>
        <option v-for="role in roles" :key="role.name" :value="role.name">
          {{ role.name }}
        </option>
      </select>
    </div>
    <p v-if="currentRoleDescription" class="llm-role-desc">{{ currentRoleDescription }}</p>

    <!-- Preset row: quick analytical actions. Each sets a prompt + scope, then
         sends — on top of the role's system prompt. -->
    <div class="llm-presets">
      <button
        v-for="preset in PRESETS"
        :key="preset.id"
        class="llm-preset-btn"
        :disabled="chat.busy || !chat.selectedRoleName"
        @click="chat.preset(preset.id)"
        :title="preset.prompt"
      >
        {{ preset.label }}
      </button>
    </div>
    <!-- Message list -->
    <div class="llm-messages" ref="messagesContainer">
      <div v-if="chat.messages.length === 0" class="llm-empty">
        <template v-if="!settings.settings.model">
          <p class="llm-empty-text">Configure the AI assistant in General Options → AI Assistant.</p>
          <button class="llm-empty-btn" @click="$emit('openSettings')">Open General Options</button>
        </template>
        <template v-else-if="!chat.selectedRoleName">
          <p class="llm-empty-text">Pick a role above, then type a question or tap a preset.</p>
        </template>
        <template v-else>
          <p class="llm-empty-text">Ask the assistant about your manuscript, or use a preset above.</p>
        </template>
      </div>

      <div
        v-for="(msg, index) in chat.messages"
        :key="index"
        class="llm-message"
        :class="msg.role"
      >
        <div class="llm-bubble" :class="{ error: msg.error }">
          <template v-if="msg.role === 'assistant'">
            <span v-if="!msg.content && msg.streaming" class="llm-cursor"></span>
            <template v-else>
              <span class="llm-content" v-html="renderMarkdown(msg.content)"></span>
              <span v-if="msg.streaming" class="llm-cursor"></span>
            </template>
          </template>
          <template v-else>
            {{ msg.content }}
          </template>
        </div>
      </div>
    </div>

    <!-- Input row -->
    <div class="llm-input-row">
      <textarea
        class="drawer-textarea llm-input"
        v-model="chat.input"
        :placeholder="inputPlaceholder"
        rows="2"
        @keydown.enter.exact.prevent="chat.send"
        @keydown.enter.shift.exact.prevent="() => {}"
        :disabled="chat.busy"
      ></textarea>
      <button v-if="!chat.busy" class="llm-send-btn" :disabled="!chat.input.trim()" @click="chat.send">
        Send
      </button>
      <button v-else class="llm-send-btn llm-stop-btn" @click="chat.stop">
        Stop
      </button>
    </div>
    <div class="llm-scope-row">
      <label :for="scopeSelect" class="llm-scope-label">Feedback Target: </label>
      <select :id="scopeSelect" class="drawer-input llm-scope-select" v-model="chat.scope">
        <option value="section">Current section</option>
        <option value="selection">Selection</option>
        <option value="document">Whole document</option>
      </select>
    </div>
    <div class="llm-clear-row">
       <button
          class="llm-clear-btn"
          :disabled="chat.busy"
          :aria-expanded="clearOpen"
          aria-controls="clearConfirm"
          @click="toggleClearOpen"
        >
          {{ clearOpen ? 'Cancel' : 'Clear Conversation'}}
        </button>
      <transition name="slide-fade">
        <button
          class="llm-clear-btn"
          :disabled="chat.busy"
          v-show="clearOpen"
          @click="chat.clear"
          id="clearConfirm"
        >Confirm Clear</button>
      </transition>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/tauri'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { PRESETS } from '../composables/useChat.js'

const props = defineProps({
  chat: { type: Object, required: true },
  settings: { type: Object, required: true },
})

defineEmits(['openSettings'])

// Configure marked once: no extra HTML, compact output.
marked.setOptions({ breaks: true, gfm: true })

const roles = ref([])
const messagesContainer = ref(null)
const clearOpen = ref(false)

// Stable id pairing the Feedback Target <label> with its <select> (label[for]
// ↔ select[id]) so clicking the label focuses the control.
const scopeSelect = 'llm-scope-select'

// Load roles from the Rust command (compile-time-embedded personas). Each
// role's `body` is the composed system prompt (base rules + persona) — sent
// verbatim as the system message when the role is selected.
async function loadRoles() {
  try {
    roles.value = await invoke('list_roles')
    // Auto-select Writing Assistant as the default role when present.
    const defaultRole = roles.value.find((r) => r.name === 'Writing Assistant')
    if (defaultRole && !props.chat.selectedRoleName) {
      props.chat.setRole(defaultRole)
    }
  } catch (e) {
    console.error('Failed to load roles:', e)
  }
}

loadRoles()

const currentRoleDescription = computed(() => {
  const role = roles.value.find((r) => r.name === props.chat.selectedRoleName)
  return role?.description || ''
})

const toggleClearOpen = () => {
  clearOpen.value = !clearOpen.value;
  if (clearOpen.value) {
    nextTick(() => {
      document.getElementById('clearConfirm')?.focus();
    });
  }
}

const inputPlaceholder = computed(() => {
  if (!props.settings.settings.model) return 'Configure a model in General Options…'
  if (!props.chat.selectedRoleName) return 'Select a role first…'
  return 'Ask about your manuscript… (Enter to send, Shift+Enter for newline)'
})

function onRoleChange(event) {
  const role = roles.value.find((r) => r.name === event.target.value)
  props.chat.setRole(role || null)
}

/// Render assistant markdown to sanitized HTML. LLM output is not trusted to
/// be free of markup quirks, so `DOMPurify.sanitize` runs before `v-html`.
function renderMarkdown(content) {
  if (!content) return ''
  const html = marked.parse(content)
  return DOMPurify.sanitize(html)
}

// Auto-scroll the message list to the bottom as new content streams in.
// `props.chat.messages` is auto-unwrapped by the reactive proxy (no `.value`).
watch(
  () => props.chat.messages.map((m) => m.content).join(''),
  () => {
    nextTick(() => {
      if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
      }
    })
  },
)
</script>

<style scoped>
.llm-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 8px;
}

.drawer-heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.llm-role-row {
  display: flex;
  flex-direction: column;
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

.llm-role-desc {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 2px 0 0;
  line-height: 1.4;
}

.llm-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.llm-preset-btn {
  flex: 1 1 auto;
  min-width: 0;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--bg-glass-border);
  background: var(--input-bg);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.llm-preset-btn:hover:not(:disabled) {
  background: var(--hover-bg);
  color: var(--text-primary);
  border-color: var(--accent);
}

.llm-preset-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.llm-scope-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.llm-scope-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.llm-scope-select {
  flex: 1 1 auto;
  flex-basis: 50%;
}

.llm-clear-row {
  display: flex;
  gap: 6px;
}

.llm-clear-btn {
  flex: 1 1 auto;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--bg-glass-border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.llm-clear-btn:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--accent);
}

.llm-clear-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Message list — scrolls independently within the drawer. */
.llm-messages {
  flex: 1 1 auto;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 2px;
  min-height: 0; /* allow flex child to shrink so it scrolls */
}

.llm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  text-align: center;
  gap: 10px;
  padding: 24px 12px;
}

.llm-empty-text {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
}

.llm-empty-btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--accent);
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
}

.llm-empty-btn:hover {
  background: var(--accent-hover);
  color: var(--text-primary);
}

.llm-message {
  display: flex;
}

.llm-message.user {
  justify-content: flex-end;
}

.llm-message.assistant {
  justify-content: flex-start;
}

.llm-bubble {
  max-width: 90%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.55;
  word-wrap: break-word;
}

.llm-message.user .llm-bubble {
  background: var(--accent-bg);
  border: 1px solid var(--accent);
  color: var(--text-primary);
  border-bottom-right-radius: 3px;
}

.llm-message.assistant .llm-bubble {
  background: var(--hover-bg);
  border: 1px solid var(--bg-glass-border);
  color: var(--text-primary);
  border-bottom-left-radius: 3px;
}

.llm-bubble.error {
  border-color: #e55;
  background: rgba(238, 85, 85, 0.12);
  color: #e55;
}

/* Markdown content inside assistant bubbles. */
.llm-content :deep(p) {
  margin: 0 0 0.5em;
}

.llm-content :deep(p:last-child) {
  margin-bottom: 0;
}

.llm-content :deep(ul),
.llm-content :deep(ol) {
  margin: 0 0 0.5em;
  padding-left: 1.4em;
}

.llm-content :deep(li) {
  margin: 0.2em 0;
}

.llm-content :deep(strong) {
  font-weight: 600;
}

.llm-content :deep(em) {
  font-style: italic;
}

.llm-content :deep(h1),
.llm-content :deep(h2),
.llm-content :deep(h3) {
  font-size: 14px;
  font-weight: 600;
  margin: 0.6em 0 0.3em;
}

.llm-content :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  background: var(--bg-glass-border);
  padding: 1px 4px;
  border-radius: 3px;
}

.llm-content :deep(blockquote) {
  border-left: 2px solid var(--bg-glass-border);
  padding-left: 10px;
  margin: 0.4em 0;
  color: var(--text-secondary);
}

/* Blinking cursor shown while streaming. */
.llm-cursor {
  display: inline-block;
  width: 7px;
  height: 14px;
  background: var(--accent);
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: llm-blink 1s steps(2, start) infinite;
}

@keyframes llm-blink {
  to { visibility: hidden; }
}

/* Input row pinned to the bottom of the panel. */
.llm-input-row {
  display: flex;
  gap: 6px;
  align-items: flex-end;
  flex: 0 0 auto;
}

.llm-input {
  flex: 1 1 auto;
  min-height: 36px;
  max-height: 120px;
}

.llm-send-btn {
  flex: 0 0 auto;
  padding: 8px 14px;
  border-radius: 6px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.llm-send-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.llm-send-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.llm-stop-btn {
  background: transparent;
  border-color: #e55;
  color: #e55;
}

.llm-stop-btn:hover {
  background: rgba(238, 85, 85, 0.12);
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
</style>