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
//! ### Roles (personas) — compile-time embedding + runtime user roles
//!
//! Built-in persona files live in `src-tauri/roles/` (`_base.md` + one file per
//! role). They are static, so we bake them into the binary with `include_str!`
//! rather than Tauri `resources` bundling — `list_roles` works at a fixed path
//! in dev AND in a packaged app with zero filesystem resolution for the
//! built-ins. Each role's composed system prompt is `_base.md` (the shared
//! rules) prepended to the persona's own body, so every role inherits the same
//! analytical-only constraints.
//!
//! Phase 4.5 adds **runtime user roles**: `*.md` files in the same frontmatter
//! format under Tauri's `app_data_dir/roles/`. `list_roles` merges built-ins +
//! user roles (a user role wins on a name collision, hiding the built-in of
//! that name). `save_role`/`delete_role` write/remove those files via
//! `atomic_write`. The base rules are NEVER stored in a user file — they are
//! always composed by `compose_role_body` at read time, so the "never add
//! content" guarantee is structural, not a user-editable setting.
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
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Window};

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
/// the model when this role is selected. `persona_body` is the UN-composed
/// persona body (base rules NOT prepended) so the role editor can show/edit
/// only the author's persona without ever touching the shared analytical-only
/// base. `is_built_in` distinguishes compile-time-embedded roles (read-only in
/// the editor) from user-authored `*.md` files in `app_data_dir/roles/`.
#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoleInfo {
    pub name: String,
    pub description: String,
    pub body: String,
    pub persona_body: String,
    pub is_built_in: bool,
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

/// Build a `RoleInfo` from raw persona source text (frontmatter + body). Roles
/// without a `name` in frontmatter are skipped (defensive — all built-in files
/// have one; a malformed user file is skipped rather than failing the whole
/// list). `is_built_in` flags whether this came from an embedded file or a
/// user-authored one.
fn build_role_info(source: &str, is_built_in: bool) -> Option<RoleInfo> {
    let (name, description, persona_body) = parse_frontmatter(source);
    let name = name?;
    Some(RoleInfo {
        name,
        description: description.unwrap_or_default(),
        body: compose_role_body(&persona_body),
        persona_body,
        is_built_in,
    })
}

/// The compile-time-embedded roles, in arbitrary order (the final sort happens
/// in `merge_roles`). Pure — the unit-testable built-in half of `list_roles`.
fn built_in_roles() -> Vec<RoleInfo> {
    ROLES
        .iter()
        .filter_map(|role| build_role_info(role.source, true))
        .collect()
}

/// Read every `*.md` file in `dir` as a user role. A missing dir is normal on a
/// fresh install (no user roles yet) → empty vec. A file that fails to read or
/// has no `name` frontmatter is skipped — a single bad user file must NOT break
/// the whole assistant (the built-ins still load). Takes `&Path` so tests pass a
/// temp dir; the command resolves `app_data_dir` and calls this.
fn load_user_roles(dir: &Path) -> Vec<RoleInfo> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return vec![], // missing dir = no user roles yet
    };
    let mut roles = vec![];
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        // `_base.md` is the shared rules, not a role — never list it.
        if path.file_stem().and_then(|s| s.to_str()) == Some("_base") {
            continue;
        }
        if let Ok(source) = fs::read_to_string(&path) {
            if let Some(role) = build_role_info(&source, false) {
                roles.push(role);
            }
        }
    }
    roles
}

/// Merge built-in + user roles into one sorted list. A user role wins on a
/// `name` collision (the built-in of that name is dropped) — so a user can
/// override "Critic" with their own, and deleting the user file restores the
/// built-in. The result is sorted by `name` ascending (the single sort site).
/// Pure — the unit-testable core of `list_roles`.
fn merge_roles(built_ins: &[RoleInfo], user: &[RoleInfo]) -> Vec<RoleInfo> {
    let user_names: std::collections::HashSet<&str> =
        user.iter().map(|r| r.name.as_str()).collect();
    let mut merged: Vec<RoleInfo> = built_ins
        .iter()
        .filter(|r| !user_names.contains(r.name.as_str()))
        .cloned()
        .chain(user.iter().cloned())
        .collect();
    merged.sort_by(|a, b| a.name.cmp(&b.name));
    merged
}

/// Turn a role name into a safe filename stem (the file is an internal key,
/// never user-facing). Keep `[A-Za-z0-9_-]`, replace every other char with `_`,
/// and trim leading/trailing underscores. An all-empty result (e.g. a name of
/// only punctuation) falls back to `role` so we never produce a blank filename.
fn sanitize_role_name(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches('_');
    if trimmed.is_empty() {
        "role".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Compose the on-disk source text for a user role: the frontmatter
/// `parse_frontmatter` reads (`name` + `description`) followed by the persona
/// body. The base rules are deliberately NOT written — they are composed at read
/// time, so the file holds only the author's persona.
fn role_file_text(name: &str, description: &str, persona_body: &str) -> String {
    format!(
        "---\nname: {}\ndescription: {}\n---\n\n{}",
        name,
        description,
        persona_body
    )
}

/// Resolve `<app_data_dir>/roles/`, creating it on first use. Returns the dir
/// path or a clear error string.
fn roles_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "could not resolve app data dir".to_string())?;
    let dir = base.join("roles");
    fs::create_dir_all(&dir).map_err(|e| format!("could not create roles dir: {}", e))?;
    Ok(dir)
}

/// List all available roles (built-in + user), sorted alphabetically by name.
/// The frontend selects a sensible default (Writing Assistant) when present.
/// Composing the body here (base + persona) means the frontend sends the result
/// verbatim as the system prompt — no client-side assembly. Returns `Vec` (not
/// `Result`) so a corrupted user dir never breaks the assistant — `load_user_roles`
/// skips bad files and returns empty if the dir is missing. `AppHandle` is
/// auto-injected by Tauri, so the JS `invoke('list_roles')` call is unchanged.
#[tauri::command]
pub fn list_roles(app: AppHandle) -> Vec<RoleInfo> {
    let built_ins = built_in_roles();
    let user = match app.path_resolver().app_data_dir() {
        Some(base) => load_user_roles(&base.join("roles")),
        None => vec![], // no resolvable app data dir → built-ins only
    };
    merge_roles(&built_ins, &user)
}

/// Save (create or overwrite) a user role as `roles/{sanitize(name)}.md` in
/// `app_data_dir`. Writing is atomic (sibling `.tmp` + rename) so a crash can't
/// leave a half-written file. A user role whose name collides with a built-in
/// overrides it (user wins, per `merge_roles`).
#[tauri::command]
pub fn save_role(
    name: String,
    description: String,
    persona_body: String,
    app: AppHandle,
) -> Result<(), String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("role name must not be empty".to_string());
    }
    let dir = roles_dir(&app)?;
    let path = dir.join(format!("{}.md", sanitize_role_name(trimmed_name)));
    let text = role_file_text(trimmed_name, description.trim(), persona_body.trim_start());
    crate::history::atomic_write(&path, text)
}

/// Delete a user role file. If the name matched a built-in, the built-in
/// reappears on the next `list_roles` (deleting the override restores it).
/// Errors clearly if the file does not exist (e.g. trying to delete a built-in
/// directly — the editor gates that, but this guards the command too).
#[tauri::command]
pub fn delete_role(name: String, app: AppHandle) -> Result<(), String> {
    let dir = roles_dir(&app)?;
    let path = dir.join(format!("{}.md", sanitize_role_name(name.trim())));
    fs::remove_file(&path).map_err(|e| format!("could not delete role: {}", e))
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
/// (required for Ollama Cloud, ignored by local Ollama). `pub(crate)` so the
/// embeddings path (`retrieval::embed_texts`, Phase 4.2) reuses the exact same
/// header construction — one auth code path across chat, model-list, and embed.
pub(crate) fn build_headers(api_key: &Option<String>) -> Result<reqwest::header::HeaderMap, String> {
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

/// Normalize a user-entered endpoint to its base URL: strip trailing slashes,
/// then a trailing `/v1`, then a trailing `/api`. This lets users enter either
/// the root URL (`https://ollama.com`) or an API base (`https://ollama.com/api`)
/// without constructing doubled paths like `/api/api/tags` or `/v1/v1/models`.
///
/// `pub(crate)` so `retrieval::embed_texts` (Phase 4.2) builds its embeddings
/// URLs from the same base — every provider path (chat, models, embed, tags)
/// shares one normalization rule. The trim is applied in this order
/// (slashes → `/v1` → `/api`) because `trim_end_matches` strips *all* repeated
/// matches of one pattern before moving to the next: a trailing-slash run is
/// removed first, then any exposed `/v1`/`/api` suffix, so
/// `https://ollama.com/api/` → `https://ollama.com` (not `…/api`).
pub(crate) fn normalize_base(endpoint: &str) -> &str {
    endpoint
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .trim_end_matches("/api")
}

/// The full chat-completions URL: `${base}/v1/chat/completions`. See
/// `normalize_base` for the endpoint trimming.
fn chat_completions_url(endpoint: &str) -> String {
    format!("{}/v1/chat/completions", normalize_base(endpoint))
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
    // Same base normalization as the chat path — see `normalize_base`.
    let base = normalize_base(&endpoint);

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
    use std::path::PathBuf;

    /// A self-cleaning temp directory. `new` creates a fresh, unique dir; `Drop`
    /// removes it, even if the test panics. Mirrors the `history.rs` fixture.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "rite-llm-test-{}-{}",
                std::process::id(),
                name
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

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
    fn built_in_roles_returns_all_personas() {
        let roles = built_in_roles();
        assert_eq!(roles.len(), 5);
        // Every built-in carries the built-in flag + an un-composed persona body.
        for role in &roles {
            assert!(role.is_built_in, "role '{}' not flagged built-in", role.name);
            assert!(!role.persona_body.is_empty(), "role '{}' has empty persona body", role.name);
        }
    }

    #[test]
    fn built_in_roles_composes_base_into_body() {
        let roles = built_in_roles();
        // Every role's body must begin with the base rules, and the persona body
        // must follow them (base is NOT part of persona_body).
        for role in &roles {
            assert!(
                role.body.starts_with(BASE_ROLE.trim_end()),
                "role '{}' missing base rules",
                role.name
            );
            assert!(role.body.contains(&role.persona_body));
            assert!(!role.persona_body.contains(BASE_ROLE.trim_end()));
        }
    }

    #[test]
    fn built_in_roles_writing_assistant_has_description() {
        let roles = built_in_roles();
        let assistant = roles.iter().find(|r| r.name == "Writing Assistant");
        assert!(assistant.is_some());
        assert!(!assistant.unwrap().description.is_empty());
    }

    #[test]
    fn merge_roles_sorts_by_name_ascending() {
        let built_ins = built_in_roles();
        let merged = merge_roles(&built_ins, &[]);
        let names: Vec<&str> = merged.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["Copy Editor", "Critic", "Genre fan", "Poet", "Writing Assistant"]
        );
    }

    #[test]
    fn merge_roles_user_wins_on_name_collision() {
        let built_ins = built_in_roles();
        // A user role named "Critic" overrides the built-in Critic.
        let user = vec![RoleInfo {
            name: "Critic".to_string(),
            description: "my critic".to_string(),
            body: "composed".to_string(),
            persona_body: "mine".to_string(),
            is_built_in: false,
        }];
        let merged = merge_roles(&built_ins, &user);
        assert_eq!(merged.len(), 5); // not 6 — the built-in Critic is dropped
        let critic = merged.iter().find(|r| r.name == "Critic").unwrap();
        assert!(!critic.is_built_in, "user role should win the collision");
        assert_eq!(critic.description, "my critic");
    }

    #[test]
    fn merge_roles_union_when_no_collision() {
        let built_ins = built_in_roles();
        let user = vec![RoleInfo {
            name: "Beta Reader".to_string(),
            description: "a friend".to_string(),
            body: "composed".to_string(),
            persona_body: "be kind".to_string(),
            is_built_in: false,
        }];
        let merged = merge_roles(&built_ins, &user);
        assert_eq!(merged.len(), 6);
        // Sorted: Beta Reader comes before Copy Editor.
        assert_eq!(merged[0].name, "Beta Reader");
        assert!(!merged[0].is_built_in);
    }

    #[test]
    fn merge_roles_empty_both_yields_empty() {
        assert!(merge_roles(&[], &[]).is_empty());
    }

    #[test]
    fn merge_roles_empty_user_yields_built_ins() {
        let built_ins = built_in_roles();
        let merged = merge_roles(&built_ins, &[]);
        assert_eq!(merged.len(), 5);
        assert!(merged.iter().all(|r| r.is_built_in));
    }

    #[test]
    fn load_user_roles_missing_dir_yields_empty() {
        // A path that does not exist → empty, no panic.
        let roles = load_user_roles(Path::new("/nonexistent/rite-roles-test-dir"));
        assert!(roles.is_empty());
    }

    #[test]
    fn load_user_roles_parses_files_and_skips_nameless_and_base() {
        let dir = TempDir::new("roles-parse");
        let roles_path = dir.path().join("roles");
        fs::create_dir_all(&roles_path).unwrap();

        // A valid user role.
        fs::write(
            roles_path.join("beta.md"),
            "---\nname: Beta Reader\ndescription: a friend\n---\n\nBe blunt but kind.",
        )
        .unwrap();
        // A file with no name frontmatter → skipped, not fatal.
        fs::write(roles_path.join("bad.md"), "---\ndescription: no name\n---\n\nbody").unwrap();
        // `_base.md` is the shared rules, not a role → skipped.
        fs::write(roles_path.join("_base.md"), "Never add content.").unwrap();
        // A non-markdown file → skipped.
        fs::write(roles_path.join("notes.txt"), "ignore me").unwrap();

        let roles = load_user_roles(&roles_path);
        assert_eq!(roles.len(), 1);
        let role = &roles[0];
        assert_eq!(role.name, "Beta Reader");
        assert_eq!(role.description, "a friend");
        assert!(!role.is_built_in);
        // persona_body is the un-composed persona; body has the base prepended.
        assert_eq!(role.persona_body, "Be blunt but kind.");
        assert!(role.body.starts_with(BASE_ROLE.trim_end()));
        assert!(role.body.contains("Be blunt but kind."));
    }

    #[test]
    fn sanitize_role_name_replaces_unsafe_chars_and_trims() {
        assert_eq!(sanitize_role_name("Beta Reader"), "Beta_Reader");
        assert_eq!(sanitize_role_name("Critic"), "Critic");
        assert_eq!(sanitize_role_name("A/B:C*D"), "A_B_C_D");
        // Leading/trailing underscores from edge spaces/punct are trimmed.
        assert_eq!(sanitize_role_name(" Hello! "), "Hello");
    }

    #[test]
    fn sanitize_role_name_falls_back_for_empty_input() {
        assert_eq!(sanitize_role_name("!!!"), "role");
        assert_eq!(sanitize_role_name("   "), "role");
    }

    #[test]
    fn role_file_text_round_trips_through_parse_frontmatter() {
        let text = role_file_text("Beta Reader", "a friend", "Be blunt but kind.");
        let (name, description, persona_body) = parse_frontmatter(&text);
        assert_eq!(name.as_deref(), Some("Beta Reader"));
        assert_eq!(description.as_deref(), Some("a friend"));
        assert_eq!(persona_body, "Be blunt but kind.");
    }

    #[test]
    fn save_and_delete_role_round_trip_through_disk() {
        let dir = TempDir::new("roles-save");
        // roles_dir needs an AppHandle (can't build one in a unit test), so test
        // the disk shape directly: write via role_file_text + atomic_write, read
        // back via load_user_roles, delete via fs::remove_file.
        let roles_path = dir.path().join("roles");
        fs::create_dir_all(&roles_path).unwrap();
        let path = roles_path.join("Beta_Reader.md");
        let text = role_file_text("Beta Reader", "a friend", "Be blunt but kind.");
        crate::history::atomic_write(&path, &text).unwrap();

        let roles = load_user_roles(&roles_path);
        assert_eq!(roles.len(), 1);
        assert_eq!(roles[0].name, "Beta Reader");

        fs::remove_file(&path).unwrap();
        assert!(load_user_roles(&roles_path).is_empty());
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

    // --- Endpoint normalization (shared by chat, model-list, embed) --------

    #[test]
    fn normalize_base_leaves_a_bare_host_unchanged() {
        assert_eq!(normalize_base("https://ollama.com"), "https://ollama.com");
        assert_eq!(normalize_base("http://localhost:11434"), "http://localhost:11434");
    }

    #[test]
    fn normalize_base_strips_trailing_slashes() {
        // A run of trailing slashes collapses to the bare host (this is what
        // keeps `/api/api/tags` from forming when a user pastes a URL ending
        // in `/`).
        assert_eq!(normalize_base("https://ollama.com///"), "https://ollama.com");
    }

    #[test]
    fn normalize_base_strips_a_trailing_v1_or_api() {
        assert_eq!(normalize_base("https://ollama.com/v1"), "https://ollama.com");
        assert_eq!(normalize_base("https://ollama.com/api"), "https://ollama.com");
        // A trailing slash between host and suffix is handled too: the slash
        // is stripped first, then the exposed `/v1`/`/api`.
        assert_eq!(normalize_base("https://ollama.com/api/"), "https://ollama.com");
        assert_eq!(normalize_base("https://ollama.com/v1/"), "https://ollama.com");
    }

    #[test]
    fn normalize_base_does_not_strip_v1_or_api_in_the_middle() {
        // Only a *trailing* `/v1`/`/api` is stripped — a path segment that
        // merely contains those strings is left alone.
        assert_eq!(normalize_base("https://host.example/v1/api"), "https://host.example/v1");
        assert_eq!(normalize_base("https://host.example/ollama/api"), "https://host.example/ollama");
    }
}