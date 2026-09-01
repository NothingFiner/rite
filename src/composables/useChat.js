// Conversation state machine for the Assistant panel. The LLM is an
// analytical collaborator — feedback, analysis, research, summarization — and
// NEVER produces prose that goes into the document. Every response lives in
// the chat panel; the writer types anything they want in the manuscript
// themselves.
//
// Factory returning refs + methods, wrapped in `reactive()` by App.vue (the
// established pattern — see useNavigation/useSectionFormat). Needs the
// document store's `doc` (for context), `llmSettings` (provider config), and
// `nav` (for the current/nav-selected section id). `editorRef` supplies the
// live text selection for the `selection` scope.
//
// The conversation is ephemeral for v1 (cleared on app restart / panel close).
// `buildContextMessages` is structured as a pluggable step so a future RAG
// phase can prepend retrieved passages as an additional context message
// without rewriting the chat flow.

import { ref, reactive, computed } from 'vue'
import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'
import { flattenSections } from './useSectionBlocks.js'

/// Maximum prior turns of conversation history sent with each message.
/// Bounds the token cost — Ollama is stateless server-side, so we resend
/// context + history every turn.
const MAX_HISTORY_TURNS = 10

/// The four quick-action presets. Each sets a fixed analytical prompt + a
/// sensible scope, then sends. They layer ON TOP of the selected role's
/// system prompt — they do not replace the role.
export const PRESETS = [
  {
    id: 'summarize',
    label: 'Summarize',
    scope: 'section',
    prompt: 'Summarize this section: what happens, the beats, and its function in the story. Keep it tight.',
  },
  {
    id: 'critique',
    label: 'Critique',
    scope: 'section',
    prompt: 'Give specific feedback on this section: what\'s working, what\'s not, pacing, clarity, and voice. Point to the text.',
  },
  {
    id: 'pacing',
    label: 'Analyze pacing',
    scope: 'document',
    prompt: 'Analyze the pacing across the whole manuscript. Where does it drag, where does it rush, where is the tension well-managed?',
  },
  {
    id: 'suggest',
    label: 'Suggest improvements',
    scope: 'section',
    prompt: 'Suggest concrete improvements to this section — without rewriting it. Name the issues and the direction to take.',
  },
]

/// Flatten a paragraph's text runs into a plain-text string (no HTML, no
/// styling). Reused across all scopes — the model reads prose, not markup.
function paragraphToText(paragraph) {
  return (paragraph.elements || [])
    .map((el) => el.textRun?.content || '')
    .join('')
}

/// Serialize the document to plain text for the model's context, per scope.
///   `section` — the nav-selected section (or the first section as fallback).
///   `selection` — the editor's current text selection (passed in).
///   `document` — all sections in order, each with a header line.
///   `sectionId` (4th arg, optional) — the nav-selected section id for the
///     `section` scope.
/// Uses `flattenSections` so chapter numbering matches the editor's render
/// (derived, never stored). Plain text only — no HTML.
export function documentToText(doc, scope, selectionText = '', sectionId = null) {
  if (!doc || !doc.sections || doc.sections.length === 0) return ''

  if (scope === 'selection') {
    return selectionText || ''
  }

  // Helper: header + paragraph body for one section, looked up by id in the
  // original (nested) doc so we get the real paragraphs, not just the title
  // block from the flat walk.
  const sectionToText = (titleBlock, chapterIndex) => {
    const isChapter = titleBlock.sectionType === 'chapter'
    const header = isChapter
      ? `Chapter ${chapterIndex}: ${titleBlock.title || ''}`.trim()
      : (titleBlock.title || 'Untitled Section')
    const section = doc.sections.find((s) => s.id === titleBlock.sectionId)
    let body = ''
    if (section) {
      for (const paragraph of section.paragraphs) {
        const paraText = paragraphToText(paragraph)
        if (paraText.trim()) body += paraText + '\n'
      }
    }
    return `${header}\n${body}`.trim()
  }

  const blocks = flattenSections(doc.sections)

  if (scope === 'section') {
    // Find the section matching the nav-selected id. We walk the flat blocks
    // to get the render-derived chapter index for the header line.
    let chapterIndex = 0
    for (const block of blocks) {
      if (block.kind === 'section-title') {
        const isChapter = block.sectionType === 'chapter'
        const displayIndex = isChapter ? ++chapterIndex : null
        if (block.sectionId === sectionId) {
          return sectionToText(block, displayIndex)
        }
      }
    }
    // Fallback: first section-title block.
    chapterIndex = 0
    for (const block of blocks) {
      if (block.kind === 'section-title') {
        const isChapter = block.sectionType === 'chapter'
        const displayIndex = isChapter ? ++chapterIndex : null
        return sectionToText(block, displayIndex)
      }
    }
    return ''
  }

  // scope === 'document': all sections in order.
  let text = ''
  let chapterIndex = 0
  for (const block of blocks) {
    if (block.kind === 'section-title') {
      const isChapter = block.sectionType === 'chapter'
      const displayIndex = isChapter ? ++chapterIndex : null
      text += sectionToText(block, displayIndex) + '\n\n'
    }
  }
  return text.trim()
}

export function useChat(docRef, llmSettings, nav, editorRef) {
  const messages = ref([])
  const input = ref('')
  const scope = ref('section')
  const busy = ref(false)
  const selectedRoleBody = ref('') // composed system prompt from the role selector
  const selectedRoleName = ref('')

  // The active assistant message index during a stream — guards against a
  // late token from a prior turn writing into a new message.
  let activeAssistantIndex = -1
  let unlistenToken = null
  let unlistenError = null

  /// Build the ChatMessage[] to send to the model. Ordered:
  ///   1. system prompt (the selected role's composed body)
  ///   2. document context (per scope) as a user message
  ///   3. conversation history (last ~10 turns)
  ///   4. the new user message
  /// Structured so a future RAG step can insert retrieved context between (2)
  /// and (3) without rewriting this function.
  function buildContextMessages(userMessage) {
    const systemPrompt = selectedRoleBody.value
    const out = []
    if (systemPrompt) {
      out.push({ role: 'system', content: systemPrompt })
    }

    const contextText = documentToText(
      docRef?.value || docRef,
      scope.value,
      editorRef?.value?.getSelectionText?.() || '',
      nav?.selectedNavId?.value || null,
    )
    if (contextText.trim()) {
      const label = scopeLabel(scope.value)
      out.push({
        role: 'user',
        content: `Here is the ${label} for reference:\n\n${contextText}`,
      })
    }

    // Conversation history: prior user + assistant messages, trimmed.
    const history = messages.value.slice(-MAX_HISTORY_TURNS)
    for (const msg of history) {
      if (msg.content) {
        out.push({ role: msg.role, content: msg.content })
      }
    }

    out.push({ role: 'user', content: userMessage })
    return out
  }

  function scopeLabel(s) {
    if (s === 'selection') return 'selected text'
    if (s === 'document') return 'full manuscript'
    return 'current section'
  }

  /// Send the current input as a new user message and stream the response.
  async function send() {
    if (busy.value || !input.value.trim()) return
    const userMessage = input.value.trim()

    // Push the user message + an empty streaming assistant placeholder.
    messages.value.push({ role: 'user', content: userMessage })
    activeAssistantIndex = messages.value.length
    messages.value.push({ role: 'assistant', content: '', streaming: true })
    input.value = ''
    busy.value = true

    const request = {
      endpoint: llmSettings.settings.value.endpoint,
      model: llmSettings.settings.value.model,
      apiKey: llmSettings.settings.value.apiKey || null,
      temperature: llmSettings.settings.value.temperature ?? null,
      messages: buildContextMessages(userMessage),
    }

    // Listen for streaming tokens + errors. The index guard ensures a late
    // token after we've moved on can't corrupt a new message.
    unlistenToken = await listen('llm-token', (event) => {
      if (activeAssistantIndex < 0) return
      const msg = messages.value[activeAssistantIndex]
      if (msg && msg.streaming) {
        msg.content += event.payload.token
      }
    })
    unlistenError = await listen('llm-error', (event) => {
      if (activeAssistantIndex < 0) return
      const msg = messages.value[activeAssistantIndex]
      if (msg && msg.streaming) {
        msg.streaming = false
        msg.error = true
        msg.content = event.payload.message
      }
    })

    try {
      await invoke('llm_chat_stream', { request })
      // Stream complete — finalize the assistant message.
      if (activeAssistantIndex >= 0) {
        const msg = messages.value[activeAssistantIndex]
        if (msg) {
          msg.streaming = false
          // If the stream produced no tokens (empty response), leave the
          // content as-is; the UI shows an empty bubble.
        }
      }
    } catch (err) {
      if (activeAssistantIndex >= 0) {
        const msg = messages.value[activeAssistantIndex]
        if (msg) {
          msg.streaming = false
          msg.error = true
          msg.content = typeof err === 'string' ? err : String(err)
        }
      }
    } finally {
      busy.value = false
      activeAssistantIndex = -1
      if (unlistenToken) { unlistenToken(); unlistenToken = null }
      if (unlistenError) { unlistenError(); unlistenError = null }
    }
  }

  /// Run a preset: set input + scope, then send. The preset's prompt layers
  /// on top of the selected role's system prompt.
  async function preset(presetId) {
    const preset = PRESETS.find((p) => p.id === presetId)
    if (!preset || busy.value) return
    scope.value = preset.scope
    input.value = preset.prompt
    await send()
  }

  /// Cancel the active stream (if any).
  function stop() {
    if (!busy.value) return
    invoke('llm_cancel')
    busy.value = false
    if (activeAssistantIndex >= 0) {
      const msg = messages.value[activeAssistantIndex]
      if (msg) msg.streaming = false
    }
    activeAssistantIndex = -1
    if (unlistenToken) { unlistenToken(); unlistenToken = null }
    if (unlistenError) { unlistenError(); unlistenError = null }
  }

  /// Clear the conversation.
  function clear() {
    if (busy.value) stop()
    messages.value = []
  }

  /// Set the selected role (called by the role selector dropdown).
  function setRole(roleInfo) {
    selectedRoleName.value = roleInfo?.name || ''
    selectedRoleBody.value = roleInfo?.body || ''
  }

  return {
    messages,
    input,
    scope,
    busy,
    selectedRoleName,
    buildContextMessages,
    send,
    preset,
    stop,
    clear,
    setRole,
  }
}

// --- Multi-chat session manager --------------------------------------------
//
// `useChat` (above) is the per-conversation factory — one messages array, one
// role, one scope. `useChatManager` owns a LIST of those conversations and
// presents them as tabs in the right drawer, so a writer can hold a Writing
// Assistant tab and a Critic tab at the same time, each with its own history.
//
// `useChat` is left UNCHANGED: the existing `useChat.test.js` suite keeps
// exercising it directly, and the manager just calls it once per tab. Each
// session is wrapped in `reactive()` so its nested refs (`busy`, `messages`,
// `selectedRoleName` …) auto-unwrap — exactly the way `reactive(useChat(...))`
// worked when there was a single chat. The manager itself is wrapped in
// `reactive()` by App.vue (same established pattern as `nav`/`theme`).
//
// Persistence is EPHEMERAL for v1 (matches the single-chat scoping): tabs and
// their histories live in memory only, cleared on restart. No localStorage.
//
// Stream serialization (why only one generation runs at a time):
// `useChat.send` registers a `listen('llm-token')` / `listen('llm-error')`
// pair per send. Tauri events broadcast to EVERY active listener — there is no
// stream/session id on the event payload. If two sessions streamed at once,
// each listener would append every incoming token to its own message (the two
// responses would cross-talk and interleave). We therefore serialize: the
// panel disables Send/presets and shows Stop whenever `anyBusy` is true, and
// Stop cancels whichever single session is streaming. With at most one live
// listener at a time, tokens can't leak between tabs. A user can still keep
// several chats open; they just can't run two generations simultaneously.

/// Monotonic id source for sessions. Module-level so ids are unique across
/// manager instances (and across the app's lifetime); tests don't rely on
/// specific values, only on uniqueness within a manager.
let sessionCounter = 0
function nextSessionId() {
  sessionCounter += 1
  return `chat-${sessionCounter}`
}

/// The default persona name for a freshly created tab. Matches the persona the
/// single-chat panel used to auto-select on mount.
const DEFAULT_ROLE_NAME = 'Writing Assistant'

export function useChatManager(docRef, llmSettings, nav, editorRef) {
  const roles = ref([])
  const sessions = ref([])
  const activeId = ref('')

  /// Build one chat session (a `reactive()`-wrapped `useChat` result) with a
  /// fresh id. `reactive()` unwraps the session's nested refs so callers see
  /// plain values (`.busy` is a boolean, `.messages` is the array) — the same
  /// shape a single `reactive(useChat(...))` had. The underlying refs are
  /// untouched, so `useChat`'s own `send`/`stop`/`setRole` still mutate them
  /// and the proxy reflects the changes.
  function makeSession() {
    const session = useChat(docRef, llmSettings, nav, editorRef)
    session.id = nextSessionId()
    return reactive(session)
  }

  /// Find a role by name in the loaded list (no-op before roles have loaded).
  function findRole(name) {
    return roles.value.find((r) => r.name === name) || null
  }

  /// Apply a role to a session by name, only if the role exists.
  function applyRole(session, roleName) {
    if (!roleName) return
    const role = findRole(roleName)
    if (role) session.setRole(role)
  }

  /// Create a new tab, defaulting to the Writing Assistant role (when roles
  /// have loaded), select it, and return its id.
  function createSession(roleName = DEFAULT_ROLE_NAME) {
    const session = makeSession()
    applyRole(session, roleName)
    sessions.value.push(session)
    activeId.value = session.id
    return session.id
  }

  /// Select an existing tab by id.
  function selectSession(id) {
    if (sessions.value.some((s) => s.id === id)) {
      activeId.value = id
    }
  }

  /// Close a tab. If it's streaming, stop it first. The last tab is never
  /// removed — it's cleared instead — so there is always at least one tab.
  /// Closing the active tab selects the nearest remaining one.
  function closeSession(id) {
    const index = sessions.value.findIndex((s) => s.id === id)
    if (index === -1) return
    const session = sessions.value[index]
    if (session.busy) session.stop()
    if (sessions.value.length <= 1) {
      session.clear()
      return
    }
    sessions.value.splice(index, 1)
    if (activeId.value === id) {
      const nextIndex = Math.min(index, sessions.value.length - 1)
      activeId.value = sessions.value[nextIndex].id
    }
  }

  /// Cancel whichever single session is currently streaming (there is at most
  /// one, by serialization). The panel's Stop button calls this.
  function stopActive() {
    const session = sessions.value.find((s) => s.busy)
    if (session) session.stop()
  }

  /// The currently selected session. Falls back to the first session so it is
  /// never undefined (one session always exists). A computed so it tracks
  /// `activeId` and the sessions list.
  const activeSession = computed(
    () =>
      sessions.value.find((s) => s.id === activeId.value) || sessions.value[0],
  )

  /// Lightweight tab descriptors for the tab row: `label` follows the session's
  /// chosen role (or "New chat" while role-less), so changing a tab's role
  /// relabels it. No separate editable name for v1.
  const tabs = computed(() =>
    sessions.value.map((s) => ({
      id: s.id,
      label: s.selectedRoleName || 'New chat',
    })),
  )

  /// True when ANY session is mid-stream. The panel uses this (not a single
  /// session's `busy`) to disable Send/presets and show Stop — enforcing the
  /// one-stream-at-a-time serialization described above.
  const anyBusy = computed(() => sessions.value.some((s) => s.busy))

  /// Load the persona list once (moved here from LlmPanel, where it ran on
  /// every mount). When roles arrive, give the active session its default role
  /// if it doesn't have one yet — mirroring the panel's old auto-select.
  async function loadRoles() {
    try {
      roles.value = await invoke('list_roles')
      const active = activeSession.value
      if (active && !active.selectedRoleName) {
        applyRole(active, DEFAULT_ROLE_NAME)
      }
    } catch (e) {
      console.error('Failed to load roles:', e)
    }
  }

  // Start with one default tab so the panel is never empty, then kick off the
  // role load (which fills in the default role once it resolves).
  createSession()
  loadRoles()

  return {
    roles,
    sessions,
    activeId,
    tabs,
    activeSession,
    anyBusy,
    createSession,
    selectSession,
    closeSession,
    stopActive,
  }
}