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

/// How many passages the "Relevant passages" Feedback Target (Phase 4.4) injects
/// as context. The Rust `retrieve_passages` command cosine-ranks the manuscript's
/// indexed chunks against the question and returns this many. Tunable; not yet a
/// setting — a writer who wants more/fewer can adjust here until it becomes one.
const DEFAULT_TOP_K = 8

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
    id: 'pacing-shape',
    label: 'Analyze pacing (shape)',
    scope: 'structure',
    prompt:
      'Analyze the macro pacing and structure across the whole manuscript from this per-chapter breakdown: chapter lengths, scene-break rhythm, where tension might sag or rush, and structural balance.',
  },
  {
    id: 'suggest',
    label: 'Suggest improvements',
    scope: 'section',
    prompt: 'Suggest concrete improvements to this section — without rewriting it. Name the issues and the direction to take.',
  },
]

/// Match slash-commands against the input text. Used by the Assistant panel's
/// autocomplete popup (Phase 3.3): when the input starts with `/`, the popup
/// lists the presets the writer can invoke by id.
///
/// Returns:
///   - `null`  when `text` does NOT start with `/` (no popup — normal typing).
///   - `[]`    when it starts with `/` but no preset id is a prefix of the
///             token (popup shows nothing, e.g. `/xyz`).
///   - the matching presets, in `presets` order, whose id is a prefix of the
///             token after `/`.
///
/// The "token" is the first whitespace-delimited word after the leading `/` —
/// so `/critique focus on dialogue` has token `critique` (the trailing text is
/// preserved by the panel and appended to the inserted prompt). Just `/` (or
/// `/ ` with nothing after it) matches every preset, which is what makes the
/// commands discoverable: type `/` and all four appear.
///
/// Pure on purpose: pulling the matching out of the component keeps it
/// unit-testable without mounting Vue (the codebase tests composables, not
/// components).
export function matchSlashCommands(text, presets = PRESETS) {
  if (!text.startsWith('/')) return null
  // Everything after the leading `/`, up to the first whitespace, is the token
  // the writer is trying to complete. `/` alone → empty token → matches all.
  const afterSlash = text.slice(1)
  const trimmed = afterSlash.trim()
  const token = trimmed.split(/\s/)[0] || ''
  return presets.filter((preset) => preset.id.startsWith(token))
}

/// Rough token estimate using the chars/4 heuristic. Good enough for a v1
/// "how full is the context window" readout — we are NOT billing on this, just
/// showing the writer whether their assembled request is nearing the limit. A
/// real tokenizer (Ollama /api/tokenize, or tiktoken) is deferred; at that
/// precision the per-message framing overhead (role tags, separators) the model
/// adds is also negligible, so we charge only for `content` here.
export function estimateTokens(text) {
  return Math.ceil((text || '').length / 4)
}

/// Sum the token cost of an assembled message list (`[{role, content}]`, the
/// shape `buildContextMessages` returns). Charges only each message's content —
/// see `estimateTokens` for why the framing overhead is ignored. Pure so it can
/// be unit-tested and reused (Phase 4's RAG cost reasoning will want the same
/// measure over a retrieved-passages message).
export function estimateContextTokens(messages) {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
}

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
    // A subtitle-less chapter renders as just "Chapter N" — no dangling
    // separator (same rule the editor/manuscript renderer follows).
    const header = isChapter
      ? titleBlock.title
        ? `Chapter ${chapterIndex}: ${titleBlock.title}`
        : `Chapter ${chapterIndex}`
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

/// Format retrieved passages (from the Rust `retrieve_passages` command) into a
/// plain-text context block for the model. Each `Chunk` comes back camelCase
/// (`{ id, sectionId, chapterIndex, text }`); `chapterIndex` is `null` for front
/// matter before any Chapter (Rust `None`) and a 1-based number otherwise (a
/// `Section` between Chapters inherits its nearest preceding Chapter's index, so
/// it still labels as "Chapter N"). Pure so it is unit-testable without mounting.
export function formatPassages(chunks) {
  if (!chunks || chunks.length === 0) return ''
  return chunks
    .map((chunk) => {
      const location = chunk.chapterIndex ? `Chapter ${chunk.chapterIndex}` : 'Front matter'
      return `[${location}]\n${chunk.text}`
    })
    .join('\n\n')
}

/// Format a `StructuralReport` (from the Rust `structural_signals` command) into
/// a compact plain-text block for the model's context — the "Structure" Feedback
/// Target (Phase 4.6). The report comes back camelCase:
///   `{ chapters: [{ chapterIndex, title, words, paragraphs, sceneBreaks,
///      sectionCount }], frontMatter: { … }, totals: { chapters, sections,
///      words, paragraphs, sceneBreaks } }`.
///
/// One header line (document scale), a front-matter line only when there IS
/// front matter, then one line per chapter — each with its render-derived
/// number, title, and the three counts plus its section-group size. Every
/// chapter line carries all three counts (even when 0) so the model can scan a
/// consistent column and compare chapters at a glance. Pure so it is unit-
/// testable without mounting, like `formatPassages`.
export function formatStructuralSignals(report) {
  if (!report) return ''
  const totals = report.totals || {}
  const headerParts = []
  if (totals.chapters) headerParts.push(pluralize(totals.chapters, 'chapter'))
  if (totals.sections) headerParts.push(pluralize(totals.sections, 'section'))
  if (totals.words) headerParts.push(`~${totals.words} words total`)
  const lines = [
    headerParts.length
      ? `Manuscript structure — ${headerParts.join(', ')}:`
      : 'Manuscript structure:',
  ]

  const frontMatter = report.frontMatter || {}
  if (frontMatter.sectionCount) {
    lines.push(
      `Front matter: ${frontMatter.words} words, ${pluralize(
        frontMatter.paragraphs,
        'paragraph',
      )}, ${pluralize(frontMatter.sceneBreaks, 'scene break')}`,
    )
  }

  for (const chapter of report.chapters || []) {
    const label = chapter.title
      ? `Chapter ${chapter.chapterIndex}: ${chapter.title}`
      : `Chapter ${chapter.chapterIndex}`
    lines.push(
      `${label} — ${chapter.words} words, ${pluralize(
        chapter.paragraphs,
        'paragraph',
      )}, ${pluralize(chapter.sceneBreaks, 'scene break')} (${pluralize(
        chapter.sectionCount,
        'section',
      )})`,
    )
  }

  return lines.join('\n')
}

/// `n` + unit, pluralized ("1 chapter", "2 chapters"). Module-private helper
/// for `formatStructuralSignals` so the breakdown reads naturally rather than
/// dropping an "s" on every count.
function pluralize(count, unit) {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

/// Format retrieved section summaries (from the Rust `retrieve_summaries`
/// command) into a compact plain-text context block for the model — the
/// "Summaries" Feedback Target (Phase 4.8). Each `SummaryEntry` comes back
/// camelCase: `{ sectionId, chapterIndex, title, sectionType, summary, stale }`.
/// `chapterIndex` is `null` for front matter before any Chapter (Rust `None`),
/// a 1-based number for a Chapter, and inherited from the nearest preceding
/// Chapter for a `Section` under it — so a `Section` labels as "Chapter N" too
/// (mirroring `formatPassages`' location label). One header line (document
/// scale), then one line per summarized section in manuscript order:
/// `Chapter 1: The Door — {summary}`. A `stale` entry (the section's text
/// changed since its summary was generated) is marked `(stale)` so the model
/// knows that recap may be outdated rather than treat it as ground truth. Pure
/// so it is unit-testable without mounting, like `formatPassages`/
/// `formatStructuralSignals`. Null/empty → `''` (the empty-store case is an
/// error caught in `send`, so this only sees a real list).
export function formatSummaries(entries) {
  if (!entries || entries.length === 0) return ''
  const lines = [`Manuscript summaries — ${pluralize(entries.length, 'section')}:`]
  for (const entry of entries) {
    const location = entry.chapterIndex ? `Chapter ${entry.chapterIndex}` : 'Front matter'
    const title = entry.title || 'Untitled'
    const stale = entry.stale ? ' (stale)' : ''
    lines.push(`${location}: ${title}${stale} — ${entry.summary}`)
  }
  return lines.join('\n')
}

export function useChat(docRef, llmSettings, nav, editorRef) {
  const messages = ref([])
  const input = ref('')
  const scope = ref('section')
  const busy = ref(false)
  const selectedRoleBody = ref('') // composed system prompt from the role selector
  const selectedRoleName = ref('')
  // The error from a failed context fetch (Phase 4.4 passages / 4.6 structure /
  // 4.8 summaries), shown inline by the panel when the active scope can't fetch
  // its context — e.g. manuscript indexing is off, the embeddings model isn't
  // pulled, or no summaries have been generated yet. Cleared at the start of
  // each send. Not a toast: keeps this composable Pinia-free and unit-testable
  // without a store setup, matching how `busy`/`input` are exposed.
  const retrievalError = ref('')

  // The scope that will actually be used for the next send. `scope` is the
  // writer's explicit dropdown choice; `effectiveScope` layers a live editor
  // selection on top of it: "selection wins, except the whole-manuscript
  // scopes". A selection upgrades any localized scope to `selection` (so
  // highlighting a passage and asking "critique this" targets the passage, not
  // the whole section); an explicit `document`, `passages`, `structure`, OR
  // `summaries` choice short-circuits and is always respected — all four are
  // whole-manuscript choices (pacing needs the full dump; `passages` needs to
  // rank against the whole index; `structure` needs the complete per-chapter
  // breakdown; `summaries` needs every section's recap to trace the arc), so a
  // stray selection must not derail any of them. Separating intent (`scope`)
  // from what's used (`effectiveScope`) means the auto-override never mutates
  // `scope`, so there's no sticky state — clearing the selection reverts on the
  // next read. `editorRef.value.hasSelection` is the reactive boolean forwarded
  // through DocumentRenderer (see editorDisplay.vue).
  const effectiveScope = computed(() => {
    const isWholeManuscriptScope =
      scope.value === 'document' ||
      scope.value === 'passages' ||
      scope.value === 'structure' ||
      scope.value === 'summaries'
    if (editorRef?.value?.hasSelection && !isWholeManuscriptScope) {
      return 'selection'
    }
    return scope.value
  })

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
  ///
  /// `retrievedContext` (Phase 4.4) is the pre-fetched "Relevant passages" text
  /// from `retrieve_passages`. When supplied it becomes context message (2)
  /// directly — `buildContextMessages` stays SYNCHRONOUS (the 3.4 token readout
  /// calls it in a computed, which can't await), so the async retrieval happens
  /// in `send` BEFORE this is called and is threaded in here. When `null` (the
  /// readout, or any non-passages scope) the context is built from
  /// `documentToText` per `effectiveScope` as before. For the `passages` scope
  /// with no `retrievedContext` (the readout case), the context is empty — the
  /// readout can't preview async-retrieved passages, so it under-estimates
  /// (accepted, same philosophy as the `getSelectionText` caveat in 3.4).
  function buildContextMessages(userMessage, retrievedContext = null) {
    const systemPrompt = selectedRoleBody.value
    const out = []
    if (systemPrompt) {
      out.push({ role: 'system', content: systemPrompt })
    }

    let contextText
    let label
    if (retrievedContext !== null) {
      contextText = retrievedContext
      // The pre-fetched context is the cosine-ranked passages (4.4), the
      // structural breakdown (4.6), or the section summaries (4.8) — label it
      // by which scope fetched it.
      label =
        effectiveScope.value === 'structure'
          ? 'manuscript structure'
          : effectiveScope.value === 'summaries'
            ? 'section summaries'
            : 'most relevant manuscript passages'
    } else if (
      effectiveScope.value === 'passages' ||
      effectiveScope.value === 'structure' ||
      effectiveScope.value === 'summaries'
    ) {
      // Readout path: these scopes pre-fetch their context async in `send`
      // before this runs, but the sync token readout (3.4) calls
      // `buildContextMessages` directly and can't await. So with no
      // `retrievedContext` yet, the context is empty → the readout under-counts
      // by design (same accepted caveat as the passages scope).
      contextText = ''
      label = ''
    } else {
      contextText = documentToText(
        docRef?.value || docRef,
        effectiveScope.value,
        editorRef?.value?.getSelectionText?.() || '',
        nav?.selectedNavId?.value || null,
      )
      label = scopeLabel(effectiveScope.value)
    }
    if (contextText.trim()) {
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
    if (s === 'passages') return 'relevant manuscript passages'
    if (s === 'structure') return 'manuscript structure'
    if (s === 'summaries') return 'section summaries'
    return 'current section'
  }

  /// Send the current input as a new user message and stream the response.
  async function send() {
    if (busy.value || !input.value.trim()) return
    const userMessage = input.value.trim()
    // Clear any prior retrieval error up front so a fresh send doesn't inherit
    // a stale red notice from a previous failed attempt.
    retrievalError.value = ''

    // Phase 4.4 — "Relevant passages" scope: fetch the top-k passages matching
    // the question BEFORE assembling the request, and thread them into
    // `buildContextMessages` as the context. The question itself is the retrieval
    // query (no separate query field). Uses the EMBEDDINGS triple (separate from
    // the chat endpoint/key, per the 4.2 follow-up — Ollama Cloud doesn't host
    // embeddings models). On failure, surface the error inline and abort without
    // pushing anything to the conversation (no failed exchange pollutes history);
    // the input is restored so the writer can fix setup and retry.
    let retrievedContext = null
    if (effectiveScope.value === 'passages') {
      const settings = llmSettings.settings.value
      busy.value = true
      input.value = ''
      try {
        const chunks = await invoke('retrieve_passages', {
          query: userMessage,
          topK: DEFAULT_TOP_K,
          endpoint: settings.embeddingsEndpoint,
          apiKey: settings.embeddingsApiKey || null,
          model: settings.embeddingsModel,
        })
        retrievedContext = formatPassages(chunks)
      } catch (err) {
        retrievalError.value = typeof err === 'string' ? err : (err?.message || String(err))
        busy.value = false
        input.value = userMessage // restore so they can retry
        return
      }
    } else if (effectiveScope.value === 'structure') {
      // Phase 4.6 — "Structure" scope: fetch the per-chapter structural
      // breakdown BEFORE assembling the request, and thread it in as the
      // context. Unlike `passages` this needs no embeddings triple — it's a pure
      // Rust walk over the live document (no network), so the only failure mode
      // is a poisoned document lock (near-impossible). Still, on failure surface
      // the error inline and abort without pushing anything, mirroring the
      // passages branch; `retrievalError` is reused as the "couldn't fetch
      // context" notice for any async-context scope.
      busy.value = true
      input.value = ''
      try {
        // No args on the JS side — the command's `State<'_, AppState>` is
        // auto-injected by Tauri. Pass `{}` so the no-args intent is explicit
        // (mirrors how the test asserts the call shape).
        const report = await invoke('structural_signals', {})
        retrievedContext = formatStructuralSignals(report)
      } catch (err) {
        retrievalError.value = typeof err === 'string' ? err : (err?.message || String(err))
        busy.value = false
        input.value = userMessage // restore so they can retry
        return
      }
    } else if (effectiveScope.value === 'summaries') {
      // Phase 4.8 — "Summaries" scope: fetch the stored per-section summaries
      // BEFORE assembling the request, and thread them in as the context. Like
      // `structure` this is a pure Rust read (no network) — the summaries were
      // generated ahead of time by `useSummaries.generateSummaries`; here we
      // just read them back. An empty store is a clear error (not a silent
      // empty context): the writer must generate summaries first. On failure
      // surface the error inline and abort without pushing anything, mirroring
      // the passages/structure branches; `retrievalError` carries the
      // "generate summaries first" message.
      busy.value = true
      input.value = ''
      try {
        const entries = await invoke('retrieve_summaries', {})
        retrievedContext = formatSummaries(entries)
      } catch (err) {
        retrievalError.value = typeof err === 'string' ? err : (err?.message || String(err))
        busy.value = false
        input.value = userMessage // restore so they can retry
        return
      }
    }

    // Push the user message + an empty streaming assistant placeholder.
    messages.value.push({ role: 'user', content: userMessage })
    activeAssistantIndex = messages.value.length
    messages.value.push({ role: 'assistant', content: '', streaming: true })
    // `input` was already cleared for the passages / structure scopes (above);
    // clear it for the other scopes here, on the commit path.
    input.value = ''
    busy.value = true

    const request = {
      endpoint: llmSettings.settings.value.endpoint,
      model: llmSettings.settings.value.model,
      apiKey: llmSettings.settings.value.apiKey || null,
      temperature: llmSettings.settings.value.temperature ?? null,
      messages: buildContextMessages(userMessage, retrievedContext),
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
    effectiveScope,
    busy,
    selectedRoleName,
    retrievalError,
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

  /// Reload the persona list from Rust (built-in + user roles merged server-
  /// side). After a refresh, if the active session's selected role is no longer
  /// in the list (e.g. it was deleted in the Roles editor), fall back to the
  /// default role when available, else clear it — so the selector never points
  /// at a vanished role. Exposed so the Roles editor can call it after a
  /// save/delete and the selector updates live.
  async function refreshRoles() {
    try {
      roles.value = await invoke('list_roles')
    } catch (e) {
      console.error('Failed to load roles:', e)
      return
    }
    const active = activeSession.value
    if (!active) return
    const current = active.selectedRoleName
    if (current && !findRole(current)) {
      // The selected role vanished — re-apply the default if present, else clear.
      if (findRole(DEFAULT_ROLE_NAME)) {
        applyRole(active, DEFAULT_ROLE_NAME)
      } else {
        active.setRole(null)
      }
    }
  }

  /// Load roles on first construction. Same as `refreshRoles`, plus giving the
  /// active session its default role if it doesn't have one yet (mirrors the
  /// old auto-select-on-mount behavior).
  async function loadRoles() {
    await refreshRoles()
    const active = activeSession.value
    if (active && !active.selectedRoleName) {
      applyRole(active, DEFAULT_ROLE_NAME)
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
    refreshRoles,
    createSession,
    selectSession,
    closeSession,
    stopActive,
  }
}