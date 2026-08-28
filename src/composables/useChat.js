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

import { ref } from 'vue'
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