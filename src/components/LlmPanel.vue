<template>
  <div class="llm-panel">
    <h3 class="drawer-heading">Assistant</h3>

    <!-- Tab row: one chip per chat session + a "+" to open a new one. The row
         is ALWAYS shown (even with one tab) so the "+" is discoverable from
         launch — otherwise a single-tab start would hide the only way to add a
         second chat. The × close only appears once 2+ tabs exist, so the lone
         tab can't be closed by accident (use the Clear button to wipe it).
         Each label follows its session's chosen role; only one generation runs
         at a time (see useChatManager's stream serialization), so Stop cancels
         the active stream regardless of which tab is selected. -->
    <div class="llm-tabs">
      <button
        v-for="tab in manager.tabs"
        :key="tab.id"
        class="llm-tab"
        :class="{ active: tab.id === manager.activeId }"
        :title="tab.label"
        @click="manager.selectSession(tab.id)"
      >
        <span class="llm-tab-label">{{ tab.label }}</span>
        <span
          v-if="manager.tabs.length > 1"
          class="llm-tab-close"
          aria-label="Close tab"
          @click.stop="manager.closeSession(tab.id)"
        >×</span>
      </button>
      <button
        class="llm-tab llm-tab-new"
        aria-label="New chat"
        title="New chat"
        @click="manager.createSession()"
      >+</button>
    </div>

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

    <!-- Message list -->
    <div class="llm-messages" ref="messagesContainer">
      <div v-if="chat.messages.length === 0" class="llm-empty">
        <template v-if="!settings.settings.model">
          <p class="llm-empty-text">Configure the AI assistant in General Options → AI Assistant.</p>
          <button class="llm-empty-btn" @click="$emit('openSettings')">Open General Options</button>
        </template>
        <template v-else-if="!chat.selectedRoleName">
          <p class="llm-empty-text">Pick a role above, then type a question. Type / for built-in commands.</p>
        </template>
        <template v-else>
          <p class="llm-empty-text">Ask the assistant about your manuscript, or type / for commands.</p>
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

    <!-- Input row. The slash-command popup floats above the textarea, so the
         row is the positioning context (position: relative; the popup is
         bottom: 100%). -->
    <div class="llm-input-row">
      <!-- Slash-command autocomplete. `@keydown.capture` on the textarea below
           intercepts Arrow/Tab/Enter/Esc while this is open; clicking an item
           also selects. `@mousedown.prevent` on items keeps the textarea
           focused so the click lands without a blur/click race. -->
      <div v-if="slashMenuOpen" class="llm-slash-menu">
        <button
          v-for="(preset, index) in slashMatches"
          :key="preset.id"
          class="llm-slash-item"
          :class="{ active: index === selectIndex }"
          :title="preset.prompt"
          @mousedown.prevent
          @click="selectSlashCommand(preset)"
          @mouseenter="selectIndex = index"
        >
          <span class="llm-slash-id">/{{ preset.id }}</span>
          <span class="llm-slash-label">{{ preset.label }}</span>
        </button>
      </div>
      <!-- Enter alone sends (`.exact` = no modifiers held). Shift+Enter is
           intentionally NOT bound here: it falls through to the textarea's
           native default, which inserts a newline. (Binding it with `.prevent`
           would swallow that newline — the bug this replaces.) Enter and Return
           are the same key in the browser (`event.key` is 'Enter'), so this
           covers both. -->
      <textarea
        ref="inputEl"
        class="drawer-textarea llm-input"
        v-model="chat.input"
        :placeholder="inputPlaceholder"
        rows="2"
        @focus="inputFocused = true"
        @blur="inputFocused = false"
        @keydown.capture="onInputKeydownCapture"
        @keydown.enter.exact.prevent="onSend"
        :disabled="busy"
      ></textarea>
      <button v-if="!busy" class="llm-send-btn" :disabled="!chat.input.trim()" @click="onSend">
        Send
      </button>
      <button v-else class="llm-send-btn llm-stop-btn" @click="manager.stopActive">
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
      <!-- Shows only when a live editor selection overrides the chosen scope
           ("selection wins, except Whole document"). `scope` is the writer's
           explicit dropdown choice (kept as-is); `effectiveScope` is what the
           next send will actually use. See useChat.effectiveScope. -->
      <span
        v-if="chat.effectiveScope === 'selection' && chat.scope !== 'selection'"
        class="llm-scope-hint"
        >Using your selection</span
      >
    </div>
    <div class="llm-clear-row">
       <button
          class="llm-clear-btn"
          :disabled="busy"
          :aria-expanded="clearOpen"
          aria-controls="clearConfirm"
          @click="toggleClearOpen"
        >
          {{ clearOpen ? 'Cancel' : 'Clear Conversation'}}
        </button>
      <transition name="slide-fade">
        <button
          class="llm-clear-btn"
          :disabled="busy"
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
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { matchSlashCommands } from '../composables/useChat.js'

const props = defineProps({
  chat: { type: Object, required: true },
  settings: { type: Object, required: true },
  // The chat-session manager (see useChatManager): owns the tab list, role
  // list, and stream-serialization `anyBusy`. The panel drives it directly for
  // tab create/select/close and Stop, the same way it drives `chat` for send.
  manager: { type: Object, required: true },
  roles: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
})

defineEmits(['openSettings'])

// Configure marked once: no extra HTML, compact output.
marked.setOptions({ breaks: true, gfm: true })

const messagesContainer = ref(null)
const clearOpen = ref(false)

// Stable id pairing the Feedback Target <label> with its <select> (label[for]
// ↔ select[id]) so clicking the label focuses the control.
const scopeSelect = 'llm-scope-select'

// Send via the active session, but only when no other tab is streaming —
// `busy` here is the manager's `anyBusy` (one generation at a time; see
// useChatManager). The textarea/button are already disabled while busy, but
// guarding here keeps the Enter-key path honest too.
function onSend() {
  if (props.busy) return
  props.chat.send()
}

const currentRoleDescription = computed(() => {
  const role = props.roles.find((r) => r.name === props.chat.selectedRoleName)
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
  return 'Ask about your manuscript… (/ for commands, Shift+Enter for newline)'
})

// --- Slash-command autocomplete --------------------------------------------
//
// The four analytical presets (Summarize / Critique / Analyze pacing / Suggest
// improvements) used to be a button row. They're now invoked by typing the
// preset id after a `/` in the input, with this autocomplete popup. Selecting a
// command INSERTS the preset's curated prompt as editable text (and sets its
// scope) rather than sending — the writer can append " — focus on dialogue"
// before pressing Enter to send. See the plan (Phase 3.3).
//
// The popup is keyboard-driven. The textarea already binds Enter → onSend and
// Shift+Enter → newline on the bubble phase; `onInputKeydownCapture` runs on the
// CAPTURE phase (before those) so that when the popup is open, Arrow/Tab/Enter/
// Esc drive the menu and never reach the send/newline handlers. When the popup
// is closed it does nothing, leaving plain Enter-to-send untouched.
const inputEl = ref(null)
const inputFocused = ref(false)

// The presets matching the current input. `null` (not `/`-prefixed) means "no
// popup at all"; `[]` means a `/` was typed but nothing matches (still no popup
// — see `slashMenuOpen`). `chat.input` is auto-unwrapped by the reactive proxy.
const slashMatches = computed(() => matchSlashCommands(props.chat.input))

// The popup shows only while the textarea is focused AND there are matches.
// Tying open state to focus means a genuine blur (clicking outside) closes it;
// `@mousedown.prevent` on the items keeps focus during a click selection so the
// blur never fires mid-selection.
const slashMenuOpen = computed(
  () => inputFocused.value && slashMatches.value !== null && slashMatches.value.length > 0,
)

// Highlighted item index. Reset to the first item whenever the match set
// changes (i.e. as the writer types), so the top match is always pre-selected.
const selectIndex = ref(0)
watch(slashMatches, () => {
  selectIndex.value = 0
})

// Capture-phase keydown: handles Arrow/Tab/Enter/Esc when the popup is open.
// Only these four keys are intercepted — every other key (letters, Backspace,
// Space) falls through the `default` case untouched so the writer can keep
// typing and the list keeps filtering. `preventDefault()` + `stopPropagation()`
// live inside the handled cases (not above the switch) precisely so that
// fall-through keystrokes still reach the textarea; and they stop the
// bubble-phase Enter handler (onSend) from firing when Enter selects a command.
function onInputKeydownCapture(event) {
  if (!slashMenuOpen.value) return
  const matches = slashMatches.value
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      event.stopPropagation()
      selectIndex.value = (selectIndex.value + 1) % matches.length
      break
    case 'ArrowUp':
      event.preventDefault()
      event.stopPropagation()
      selectIndex.value = (selectIndex.value - 1 + matches.length) % matches.length
      break
    case 'Tab':
    case 'Enter':
      event.preventDefault()
      event.stopPropagation()
      selectSlashCommand(matches[selectIndex.value])
      break
    case 'Escape':
      event.preventDefault()
      event.stopPropagation()
      inputFocused.value = false // closes the popup (slashMenuOpen is focus-tied)
      break
    default:
      break
  }
}

/// Selecting a command inserts the preset's curated prompt as editable text and
/// sets the scope, so the next send uses it. Any text the writer typed after
/// the `/token` (e.g. `/critique focus on dialogue`) is appended after a space,
/// so the note rides along. Does NOT send — the writer reviews, then Enter.
function selectSlashCommand(preset) {
  if (!preset) return
  // Split the input into the leading `/token` and the trailing text after it.
  const afterSlash = props.chat.input.slice(1)
  const firstSpace = afterSlash.search(/\s/)
  const rest = firstSpace === -1 ? '' : afterSlash.slice(firstSpace + 1).trim()
  props.chat.scope = preset.scope
  props.chat.input = rest ? `${preset.prompt} ${rest}` : preset.prompt
  inputFocused.value = true // keep the popup closed on next render (no `/` now)
  focusInputEnd()
}

/// Refocus the textarea and place the caret at the end, ready to edit / append
/// / Enter to send. `nextTick` waits for the input value to render.
function focusInputEnd() {
  nextTick(() => {
    const textarea = inputEl.value
    if (!textarea) return
    textarea.focus()
    const length = textarea.value.length
    textarea.setSelectionRange(length, length)
  })
}

function onRoleChange(event) {
  const role = props.roles.find((r) => r.name === event.target.value)
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

.llm-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.llm-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--bg-glass-border);
  background: var(--input-bg);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.llm-tab:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}

.llm-tab.active {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--text-primary);
  font-weight: 600;
}

.llm-tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.llm-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  font-size: 13px;
  line-height: 1;
  opacity: 0.6;
}

.llm-tab-close:hover {
  opacity: 1;
  background: var(--bg-glass-border);
}

.llm-tab-new {
  flex: 0 0 auto;
  padding: 4px 8px;
  font-size: 13px;
  line-height: 1;
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

.llm-scope-row {
  display: flex;
  flex-wrap: wrap;
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

/* "Using your selection" — appears when a live editor selection overrides the
   chosen Feedback Target. Accent-colored so it reads as an active override. */
.llm-scope-hint {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--accent);
  font-style: italic;
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

/* Input row pinned to the bottom of the panel. position: relative so the
   slash-command popup can float above it (bottom: 100%). */
.llm-input-row {
  display: flex;
  gap: 6px;
  align-items: flex-end;
  flex: 0 0 auto;
  position: relative;
}

.llm-input {
  flex: 1 1 auto;
  min-height: 36px;
  max-height: 120px;
}

/* Slash-command autocomplete: floats above the textarea, reusing the panel's
   existing surface/border tokens so it reads as part of the drawer. */
.llm-slash-menu {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
  padding: 4px;
  border-radius: 6px;
  border: 1px solid var(--bg-glass-border);
  background: var(--input-bg);
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.25);
  z-index: 10;
}

.llm-slash-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}

.llm-slash-item:hover,
.llm-slash-item.active {
  background: var(--accent-bg);
  color: var(--text-primary);
}

.llm-slash-id {
  font-family: ui-monospace, monospace;
  color: var(--accent);
  flex: 0 0 auto;
}

.llm-slash-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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