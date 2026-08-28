//! LLM proxy: roles + OpenAI-compatible chat/streaming + model discovery.
//!
//! Rite's LLM is an *analytical collaborator* — feedback, analysis, research,
//! summarization — never prose that goes into the document. This module is the
//! Rust proxy for every provider network call (chat, streaming, model list),
//! keeping the API key (needed for Ollama Cloud) out of the webview's
//! inspectable fetch headers. The endpoint URL + API key are passed into each
//! command call (Rust holds no long-lived provider config — the key never
//! enters `AppState`).
//!
//! ### Roles (personas) — compile-time embedding
//!
//! Persona files live in `src-tauri/roles/` (`_base.md` + one file per role).
//! They are static, so we bake them into the binary with `include_str!` rather
//! than Tauri `resources` bundling. Embedding means `list_roles` works at a
//! fixed path in dev AND in a packaged app with zero filesystem resolution —
//! the right call for a v0.0.1 personal app with static personas. Each role's
//! composed system prompt is `_base.md` (the shared rules) prepended to the
//! persona's own body, so every role inherits the same constraints.
//!
//! ### Streaming
//!
//! `llm_chat_stream` posts to `${endpoint}/v1/chat/completions` with
//! `stream: true`, reads the SSE chunk stream, and emits `llm-token` Tauri
//! events per delta. Both local Ollama and Ollama Cloud speak the standard
//! OpenAI SSE shape: `data: {"choices":[{"delta":{"content":"..."}}]}` lines
//! terminated by `data: [DONE]`. Ollama Cloud's base is `https://ollama.com`
//! with `Authorization: Bearer <key>`; local Ollama is `http://localhost:11434`
//! (key ignored).

use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Window;

/// A single message in the OpenAI chat format. `role` is "system" | "user" |
/// "assistant". Built by the frontend's `buildContextMessages` (system prompt
/// from the selected role, then document context, then conversation history).
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Full request for a chat completion. Endpoint + key come from localStorage
/// (frontend) and are passed in per call, so Rust is stateless re: provider
/// config. `temperature` is optional; when `None` the server's default applies.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub endpoint: String,
    pub model: String,
    pub api_key: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f32>,
}

/// One role's metadata + composed system prompt, returned to the frontend.
/// `body` is `_base.md` + the persona's body — the full system prompt sent to
/// the model when this role is selected.
#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoleInfo {
    pub name: String,
    pub description: String,
    pub body: String,
}

// --- Roles (compile-time embedded) ------------------------------------------

/// The shared base rules, prepended to every persona. `_base.md` has no
/// frontmatter — it is pure body content.
const BASE_ROLE: &str = include_str!("../roles/_base.md");

/// One embedded persona file: its source text (frontmatter + body) and the
/// composed body (base + persona body). We resolve these at first access.
struct EmbeddedRole {
    source: &'static str,
}

// The persona files. Order here does not matter — `list_roles` sorts
// alphabetically by name before returning.
static ROLES: &[EmbeddedRole] = &[
    EmbeddedRole { source: include_str!("../roles/writingAssistant.md") },
    EmbeddedRole { source: include_str!("../roles/critic.md") },
    EmbeddedRole { source: include_str!("../roles/copyEditor.md") },
    EmbeddedRole { source: include_str!("../roles/poet.md") },
    EmbeddedRole { source: include_str!("../roles/genreFan.md") },
];

/// Parsed YAML frontmatter. The persona files use only `name` and
/// `description`, so a tiny line-based parser suffices — no `serde_yaml` dep.
/// A line `name: Writing Assistant` becomes `("name", "Writing Assistant")`.
fn parse_frontmatter(source: &str) -> (Option<String>, Option<String>, String) {
    let mut name = None;
    let mut description = None;
    let mut body_start = 0;

    // A frontmatter block starts at the very first line with `---` and closes at
    // the next line that is exactly `---` (or `...`). Anything after the
    // closing fence is the body.
    let lines: Vec<&str> = source.lines().collect();
    if lines.first().map(|l| l.trim() == "---").unwrap_or(false) {
        for (i, line) in lines.iter().enumerate().skip(1) {
            let trimmed = line.trim();
            if trimmed == "---" || trimmed == "..." {
                body_start = i + 1;
                break;
            }
            if let Some(rest) = trimmed.strip_prefix("name:") {
                name = Some(rest.trim().to_string());
            } else if let Some(rest) = trimmed.strip_prefix("description:") {
                description = Some(rest.trim().to_string());
            }
        }
    }

    let body = if body_start > 0 && body_start < lines.len() {
        lines[body_start..].join("\n").trim_start_matches('\n').to_string()
    } else if body_start == 0 {
        // No frontmatter fence — the whole source is the body.
        source.to_string()
    } else {
        String::new()
    };

    (name, description, body)
}

/// Compose the system prompt for one role: base rules + persona body. The base
/// is prepended so every persona inherits the shared "never write prose"
/// constraint; a blank line separates the two for readability.
fn compose_role_body(persona_body: &str) -> String {
    format!("{}\n\n{}", BASE_ROLE.trim_end(), persona_body.trim_start())
}

/// Build a `RoleInfo` from an embedded persona file. Roles without a `name`
/// in frontmatter are skipped (defensive — all current files have one).
fn build_role_info(role: &EmbeddedRole) -> Option<RoleInfo> {
    let (name, description, persona_body) = parse_frontmatter(role.source);
    let name = name?;
    Some(RoleInfo {
        name,
        description: description.unwrap_or_default(),
        body: compose_role_body(&persona_body),
    })
}

/// List all available roles, sorted alphabetically by name. The frontend
/// selects a sensible default (Writing Assistant) when present. Composing the
/// body here (base + persona) means the frontend sends the result verbatim as
/// the system prompt — no client-side assembly.
#[tauri::command]
pub fn list_roles() -> Vec<RoleInfo> {
    let mut roles: Vec<RoleInfo> = ROLES.iter().filter_map(build_role_info).collect();
    roles.sort_by(|a, b| a.name.cmp(&b.name));
    roles
}

// --- Request building (pure, testable) --------------------------------------

/// Build the OpenAI-compatible JSON request body. `stream` toggles streaming.
/// Temperature is included only when `Some` so the server default applies
/// otherwise.
fn build_request_body(request: &ChatRequest, stream: bool) -> Value {
    let messages: Vec<Value> = request
        .messages
        .iter()
        .map(|m| json!({ "role": m.role, "content": m.content }))
        .collect();
    let mut body = json!({
        "model": request.model,
        "messages": messages,
        "stream": stream,
    });
    if let Some(temp) = request.temperature {
        body["temperature"] = json!(temp);
    }
    body
}

/// Build the HTTP headers for a provider request. `Content-Type` is always
/// set; `Authorization: Bearer <key>` is set only when an API key is present
/// (required for Ollama Cloud, ignored by local Ollama).
fn build_headers(api_key: &Option<String>) -> Result<reqwest::header::HeaderMap, String> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/json"),
    );
    if let Some(key) = api_key {
        if !key.is_empty() {
            // Bearer auth. `reqwest` parses "Bearer <key>" into the
            // Authorization header; invalid header values (control chars etc.)
            // would error here, which we surface to the caller.
            headers.insert(
                reqwest::header::AUTHORIZATION,
                reqwest::header::HeaderValue::from_str(&format!("Bearer {}", key))
                    .map_err(|e| format!("invalid API key: {}", e))?,
            );
        }
    }
    Ok(headers)
}

/// The full chat-completions URL: `${endpoint}/v1/chat/completions`. Trailing
/// slashes and a trailing `/v1` or `/api` on the endpoint are stripped so users
/// can enter either the root URL (`https://ollama.com`) or an API base
/// (`https://ollama.com/api`) without constructing doubled paths.
fn chat_completions_url(endpoint: &str) -> String {
    let base = endpoint
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .trim_end_matches("/api");
    format!("{}/v1/chat/completions", base)
}

// --- SSE parsing (pure, testable) -------------------------------------------

/// One parsed SSE event from a `data:` line.
#[derive(Debug, PartialEq)]
enum SseEvent {
    /// A content delta to surface to the UI.
    Token(String),
    /// The terminal sentinel — stream is complete.
    Done,
}

/// Parse one line of an OpenAI-compatible SSE stream. Returns `None` for
/// non-data lines (comments, empty lines, keep-alive pings). `data: [DONE]`
/// yields `Done`; `data: {json}` yields `Token(content)` when the JSON carries
/// a `choices[0].delta.content` string. Malformed JSON or unexpected shapes
/// yield `None` (skipped, not fatal — one bad chunk shouldn't kill the stream).
fn parse_sse_line(line: &str) -> Option<SseEvent> {
    let trimmed = line.trim();
    let payload = trimmed.strip_prefix("data:")?.trim();
    if payload == "[DONE]" {
        return Some(SseEvent::Done);
    }
    let value: Value = serde_json::from_str(payload).ok()?;
    let content = value
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("delta"))
        .and_then(|d| d.get("content"))?
        .as_str()?;
    Some(SseEvent::Token(content.to_string()))
}

/// Drain complete lines from an SSE buffer, returning (parsed_events, leftover).
/// Lines are split on `\n`; a trailing partial line is kept as leftover for
/// the next chunk. Empty events (non-data lines) are filtered out.
fn drain_sse_buffer(buffer: &str) -> (Vec<SseEvent>, String) {
    let mut events = Vec::new();
    let mut leftover = String::new();
    for line in buffer.split_inclusive('\n') {
        if line.ends_with('\n') {
            let line_text = &line[..line.len() - 1];
            if let Some(event) = parse_sse_line(line_text) {
                events.push(event);
            }
        } else {
            // Partial line (no trailing newline) — keep for the next chunk.
            leftover = line.to_string();
            break;
        }
    }
    (events, leftover)
}

// --- Cancellation -----------------------------------------------------------

/// Global cancel flag for the one active stream. v1 is single-user with one
/// chat at a time, so a module-level static is sufficient — no per-stream
/// channel plumbing needed. Set by `llm_cancel`, checked-and-cleared in the
/// stream loop between chunks.
static CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Request cancellation of the active stream (if any). Idempotent.
#[tauri::command]
pub fn llm_cancel() {
    CANCEL_REQUESTED.store(true, Ordering::SeqCst);
}

// --- Commands ---------------------------------------------------------------

/// One-shot completion: posts with `stream: false`, returns the full assistant
/// text. Used by "Test connection" (with a trivial message).
#[tauri::command]
pub async fn llm_chat(request: ChatRequest) -> Result<String, String> {
    let url = chat_completions_url(&request.endpoint);
    let body = build_request_body(&request, false);
    let headers = build_headers(&request.api_key)?;
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(&url)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {}", e))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("endpoint returned {}: {}", status.as_u16(), text));
    }
    let json: Value = response.json().await.map_err(|e| format!("bad response: {}", e))?;
    let content = json
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or_else(|| "response missing choices[0].message.content".to_string())?;
    Ok(content.to_string())
}

/// Streaming completion: posts with `stream: true`, emits `llm-token` events
/// (payload `{ token: String }`) as deltas arrive, returns the full text when
/// the stream ends. Emits `llm-error` (payload `{ message: String }`) on a
/// mid-stream failure. Checked against `CANCEL_REQUESTED` between chunks so a
/// `Stop` press ends the loop promptly.
#[tauri::command]
pub async fn llm_chat_stream(request: ChatRequest, window: Window) -> Result<String, String> {
    CANCEL_REQUESTED.store(false, Ordering::SeqCst);
    let url = chat_completions_url(&request.endpoint);
    let body = build_request_body(&request, true);
    let headers = build_headers(&request.api_key)?;
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(&url)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {}", e))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("endpoint returned {}: {}", status.as_u16(), text));
    }

    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full_text = String::new();

    while let Some(chunk_result) = stream.next().await {
        // Check cancellation before processing each chunk so a Stop press
        // during a wait ends the loop on the next arrival.
        if CANCEL_REQUESTED.load(Ordering::SeqCst) {
            CANCEL_REQUESTED.store(false, Ordering::SeqCst);
            break;
        }
        let chunk = chunk_result.map_err(|e| {
            let message = format!("stream error: {}", e);
            let _ = window.emit("llm-error", json!({ "message": message }));
            message
        })?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        let (events, leftover) = drain_sse_buffer(&buffer);
        buffer = leftover;
        for event in events {
            match event {
                SseEvent::Token(token) => {
                    full_text.push_str(&token);
                    let _ = window.emit("llm-token", json!({ "token": token }));
                }
                SseEvent::Done => {
                    // Stream complete — return what we have.
                    return Ok(full_text);
                }
            }
        }
    }

    // Stream ended without an explicit [DONE] — return what accumulated.
    Ok(full_text)
}

/// List models available at the endpoint. Tries the OpenAI-compatible
/// `${endpoint}/v1/models` first (works for local Ollama, Ollama Cloud, and
/// most OpenAI-compatible servers); on failure falls back to Ollama-native
/// `${endpoint}/api/tags` and maps `models[].name`. Sends `Authorization:
/// Bearer <key>` when an API key is present (required for Ollama Cloud).
///
/// The endpoint is normalized so a trailing `/api` or `/v1` is not doubled:
/// entering `https://ollama.com` or `https://ollama.com/api` both resolve
/// correctly. This matters because users may copy either the root URL or the
/// native API base from provider docs.
#[tauri::command]
pub async fn llm_list_models(endpoint: String, api_key: Option<String>) -> Result<Vec<String>, String> {
    let headers = build_headers(&api_key)?;
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    // Strip trailing slashes AND a trailing /v1 or /api so we don't construct
    // doubled paths like `/api/api/tags` or `/v1/v1/models`.
    let base = endpoint
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .trim_end_matches("/api");

    // OpenAI-compatible path first.
    let url = format!("{}/v1/models", base);
    let result = client.get(&url).headers(headers.clone()).send().await;
    if let Ok(response) = result {
        if response.status().is_success() {
            if let Ok(json) = response.json::<Value>().await {
                let models = json
                    .get("data")
                    .and_then(|d| d.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from))
                            .collect::<Vec<_>>()
                    });
                if let Some(models) = models {
                    if !models.is_empty() {
                        return Ok(models);
                    }
                }
            }
        }
    }

    // Native Ollama fallback (local robustness — `/api/tags` predates the
    // OpenAI layer and always lists pulled models).
    let tags_url = format!("{}/api/tags", base);
    let response = client
        .get(&tags_url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("could not reach endpoint: {}", e))?;
    let status_code = response.status();
    if !status_code.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("endpoint returned {}: {}", status_code.as_u16(), text));
    }
    let json: Value = response.json().await.map_err(|e| format!("bad response: {}", e))?;
    let models = json
        .get("models")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(String::from))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(models)
}

// --- Tests ------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- Frontmatter / roles ---

    #[test]
    fn parse_frontmatter_extracts_name_and_description() {
        let source = "---\nname: Critic\ndescription: Gives feedback\n---\n\nYou are a critic.\nRules:\n- Be kind";
        let (name, description, body) = parse_frontmatter(source);
        assert_eq!(name.as_deref(), Some("Critic"));
        assert_eq!(description.as_deref(), Some("Gives feedback"));
        assert!(body.starts_with("You are a critic."));
    }

    #[test]
    fn parse_frontmatter_without_frontmatter_treats_all_as_body() {
        let source = "You are providing feedback.\n\nNever add content.";
        let (name, description, body) = parse_frontmatter(source);
        assert_eq!(name, None);
        assert_eq!(description, None);
        assert_eq!(body, source);
    }

    #[test]
    fn compose_role_body_prepends_base_rules() {
        let body = compose_role_body("You are a poet.");
        // Base rules come first, then a blank-line separator, then the persona.
        assert!(body.starts_with(BASE_ROLE.trim_end()));
        assert!(body.contains("You are a poet."));
        // The two blocks are separated by a blank line for readability.
        assert!(body.contains("\n\nYou are a poet."));
    }

    #[test]
    fn list_roles_returns_all_personas_sorted_alphabetically() {
        let roles = list_roles();
        assert_eq!(roles.len(), 5);
        // Alphabetical by name: Copy Editor, Critic, Genre fan, Poet, Writing Assistant.
        let names: Vec<&str> = roles.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["Copy Editor", "Critic", "Genre fan", "Poet", "Writing Assistant"]
        );
    }

    #[test]
    fn list_roles_composes_base_into_body() {
        let roles = list_roles();
        // Every role's body must begin with the base rules.
        for role in &roles {
            assert!(
                role.body.starts_with(BASE_ROLE.trim_end()),
                "role '{}' missing base rules",
                role.name
            );
        }
    }

    #[test]
    fn list_roles_writing_assistant_has_description() {
        let roles = list_roles();
        let assistant = roles.iter().find(|r| r.name == "Writing Assistant");
        assert!(assistant.is_some());
        assert!(!assistant.unwrap().description.is_empty());
    }

    // --- Request building ---

    fn sample_request() -> ChatRequest {
        ChatRequest {
            endpoint: "http://localhost:11434".to_string(),
            model: "test-model".to_string(),
            api_key: None,
            messages: vec![
                ChatMessage { role: "system".to_string(), content: "you are helpful".to_string() },
                ChatMessage { role: "user".to_string(), content: "hi".to_string() },
            ],
            temperature: Some(0.5),
        }
    }

    #[test]
    fn build_request_body_streaming_includes_stream_true() {
        let body = build_request_body(&sample_request(), true);
        assert_eq!(body["stream"], json!(true));
        assert_eq!(body["model"], json!("test-model"));
        // 0.5 is exactly representable in f32 (unlike 0.7), so the JSON
        // round-trip compares clean.
        assert_eq!(body["temperature"], json!(0.5));
        assert_eq!(body["messages"][0]["role"], json!("system"));
    }

    #[test]
    fn build_request_body_non_streaming_sets_stream_false() {
        let body = build_request_body(&sample_request(), false);
        assert_eq!(body["stream"], json!(false));
    }

    #[test]
    fn build_request_body_omits_temperature_when_none() {
        let mut request = sample_request();
        request.temperature = None;
        let body = build_request_body(&request, true);
        assert!(body.get("temperature").is_none() || body["temperature"].is_null());
    }

    #[test]
    fn build_headers_sets_bearer_when_key_present() {
        let headers = build_headers(&Some("sk-test".to_string())).unwrap();
        let auth = headers.get(reqwest::header::AUTHORIZATION).unwrap();
        assert_eq!(auth.to_str().unwrap(), "Bearer sk-test");
    }

    #[test]
    fn build_headers_omits_auth_when_key_empty() {
        // An empty-string key means "no auth" (local Ollama). We must not send
        // `Bearer ` (empty) — some servers reject it.
        let headers = build_headers(&Some(String::new())).unwrap();
        assert!(headers.get(reqwest::header::AUTHORIZATION).is_none());
    }

    #[test]
    fn build_headers_omits_auth_when_key_none() {
        let headers = build_headers(&None).unwrap();
        assert!(headers.get(reqwest::header::AUTHORIZATION).is_none());
    }

    #[test]
    fn build_headers_always_sets_content_type() {
        let headers = build_headers(&None).unwrap();
        assert!(headers.contains_key(reqwest::header::CONTENT_TYPE));
    }

    #[test]
    fn chat_completions_url_handles_trailing_slash() {
        assert_eq!(
            chat_completions_url("http://localhost:11434"),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("http://localhost:11434/"),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("https://ollama.com/"),
            "https://ollama.com/v1/chat/completions"
        );
    }

    #[test]
    fn chat_completions_url_strips_trailing_api_or_v1() {
        // A user who copied the native API base (ends in /api) or the OpenAI
        // base (ends in /v1) must not get a doubled path.
        assert_eq!(
            chat_completions_url("https://ollama.com/api"),
            "https://ollama.com/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("https://ollama.com/v1"),
            "https://ollama.com/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("https://ollama.com/api/"),
            "https://ollama.com/v1/chat/completions"
        );
    }

    // --- SSE parsing ---

    #[test]
    fn parse_sse_line_extracts_token_from_data_json() {
        let line = r#"data: {"choices":[{"delta":{"content":"Hello"}}]}"#;
        assert_eq!(parse_sse_line(line), Some(SseEvent::Token("Hello".to_string())));
    }

    #[test]
    fn parse_sse_line_handles_done_sentinel() {
        assert_eq!(parse_sse_line("data: [DONE]"), Some(SseEvent::Done));
    }

    #[test]
    fn parse_sse_line_ignores_non_data_lines() {
        assert_eq!(parse_sse_line(": keep-alive"), None);
        assert_eq!(parse_sse_line(""), None);
        assert_eq!(parse_sse_line("event: ping"), None);
    }

    #[test]
    fn parse_sse_line_ignores_malformed_json() {
        assert_eq!(parse_sse_line("data: {not json}"), None);
    }

    #[test]
    fn parse_sse_line_ignores_json_without_content() {
        // A chunk carrying only role/final_reason (no content delta) is common
        // in OpenAI streams — it must not be fatal, just skipped.
        let line = r#"data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}"#;
        assert_eq!(parse_sse_line(line), None);
    }

    #[test]
    fn drain_sse_buffer_processes_complete_lines_and_keeps_partial() {
        let buffer = "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\ndata: [DONE]\ndata: {\"ch";
        let (events, leftover) = drain_sse_buffer(buffer);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0], SseEvent::Token("Hi".to_string()));
        assert_eq!(events[1], SseEvent::Done);
        assert_eq!(leftover, "data: {\"ch");
    }

    #[test]
    fn drain_sse_buffer_returns_empty_for_no_complete_lines() {
        let buffer = "data: {\"partial";
        let (events, leftover) = drain_sse_buffer(buffer);
        assert!(events.is_empty());
        assert_eq!(leftover, buffer);
    }

    #[test]
    fn drain_sse_buffer_skips_non_data_lines() {
        let buffer = ": comment\ndata: {\"choices\":[{\"delta\":{\"content\":\"X\"}}]}\n\n";
        let (events, leftover) = drain_sse_buffer(buffer);
        assert_eq!(events, vec![SseEvent::Token("X".to_string())]);
        assert_eq!(leftover, "");
    }
}