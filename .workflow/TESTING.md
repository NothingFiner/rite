# Testing conventions

Read by the spec-to-tests agent when it writes tests and stubs.

## Traceability
Every approved sentence in `SPEC.md` gets an ID: `S-001`, `S-002`, ... (three digits).
Every test name starts with its ID so the orchestrator can verify nothing was dropped.

- Vitest / Playwright: `it('S-003: should display the error banner when save fails', ...)`
- Rust: `fn s_003_should_reject_empty_project_name()`

One sentence may have several tests; every sentence needs at least one.

## Where tests live (so they can be locked)
| Layer | Location | Command |
|---|---|---|
| unit (Vue components, composables, stores) | colocated: `src/**/*.test.js`, `src/components/**/*.spec.js` | `npx vitest run` |
| rust | `src-tauri/tests/*.rs` (integration tests only, never inline `#[cfg(test)]`) | `cargo test` |
| e2e | `e2e/**/*.spec.js` | `npx playwright test` |

The project is plain JavaScript (no `tsconfig.json`, no `typescript` dependency),
so new tests are `.js`. Vitest's include glob (`src/**`) already picks up both
`.test.js` and `.spec.js`, and both patterns are in `protected_paths`.

Do NOT put unit tests in a top-level `tests/unit/` directory: `vitest.config.js`
does not include it, so the suite would silently never run them.

Shared helpers, fixtures and setup files go inside those same directories.
Rust integration tests import from the crate's library target (`use <crate>_lib::...`), so logic under test must be exported from `src-tauri/src/lib.rs`.

## Playwright mode
Default: run the Vite dev server in a browser and mock Tauri IPC with `mockIPC`
from `@tauri-apps/api/mocks`. Do not use `tauri-driver` unless the sentence is
specifically about real native behaviour.

## Stubs: tests must fail for the right reason
Red means an assertion fails, never an import, compile or syntax error.

- Rust: add the function/struct with the right signature and a `todo!()` body.
- Vue: add the component file with declared props and emits and an empty template.
- TypeScript modules: export the function with the right signature, `throw new Error('not implemented')`.

Stubs live in normal source directories (they are the coding agent's to fill in).
Do not put real behaviour in stubs.

## Rules for test authors
- Test behaviour, not implementation details.
- No `.skip`, `.todo`, `test.fixme` or `#[ignore]`: the orchestrator counts these as failures.
- Deterministic only: no real network, no sleeps. Use fake timers and mocked IPC.
