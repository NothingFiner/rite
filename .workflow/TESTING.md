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

### The one IPC mock
`addInitScript` cannot import ESM, so `mockIPC` itself is not usable from an
injected page script. The repo therefore vendors its envelope once, in
`e2e/helpers/tauri-ipc.mock.js`, with a Node-side wrapper in
`e2e/helpers/tauri-ipc.js`.

The envelope is **Tauri v2**: `invoke` is a promise-returning
`window.__TAURI_INTERNALS__.invoke(cmd, args, options)`, `listen()` is
`invoke('plugin:event|listen', …)` with a `transformCallback` handler id, and
dialogs are `plugin:dialog|save` / `|open` / `|message`. The v1 callback
protocol (`window['_<id>']` replies) is gone.

- Never write `window.__TAURI_INTERNALS__` in a spec. `e2e/conventions.spec.js`
  fails the suite if you do, and it also fails if any spec or helper keeps a v1
  envelope reference.
- Seed defaults with
  `installTauriIpc(page, { doc, docFails, dialogPaths, openPaths, messageAnswer })`.
- Register command behaviour with `window.__tauriMock.route(cmd, (args) => …)`
  inside a normal `page.addInitScript`, and return
  `window.__tauriMock.fail(message)` to reject.
- Dispatch menu events with `emitMenu(page, id)`; inspect what the app sent with
  `ipcCalls(page)` / `invoked(page, cmd, predicate)`; check which envelope the
  page is speaking with `envelope(page)`.

The helper owns the parts every hand-rolled copy used to get wrong: the promise
return, the plugin command names, the `transformCallback`/`listen` capture, and
the `ask()` → `message` + `buttons: 'YesNo'` mapping (the mock's
`messageAnswer` is the pressed label, so `'Yes'` makes `ask()` true).

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

### Satisfiability: a test the implementation cannot pass is a broken test

A red test looks honest before the implementation exists — it fails at the first
guard, so an assertion below that guard is never reached. Three defects hid in
that blind spot in one feature, each costing an implementer iteration and a human
in the loop. Check these before handing tests over:

- **Fixtures mirror the real contract.** Every method a test spies on
  (`expect(store.commitNote).toHaveBeenCalled()`) must exist on the real object,
  not only on the test double. Vitest throws `undefined is not a spy` — which is
  a *setup* error, not a red test, and no application change can fix it. Grep the
  store/composable for the method before asserting on it.
- **A page-level assertion needs a page.** Playwright init scripts run on every
  navigation, so seed localStorage only when it is empty, or `page.reload()`
  rewinds the record the test is proving survives. Any scroll-alignment
  assertion needs a seeded document taller than the viewport: a short document
  has `maxScroll === 0`, and then no landing can satisfy it.
- **An init script is serialized: only its argument is in scope.** Playwright ships
  `page.addInitScript(fn, arg)` as source text and runs it in the page, so a
  module-scope constant (`const RECAP = '…'`) referenced inside `fn` throws
  `ReferenceError` at click time, inside a mock route, where nothing reaches the
  console — the DOM simply never updates and the test reads as an app bug. Pass
  every fixture value the routes use through the argument object alongside `doc`
  and `notes`.
- **Nothing else in the suite is allowed to be flaky on the way in.** A width or
  position read once, right after an action, races the reflow that follows it.
  Poll (`expect.poll`) rather than sample, and check the test is green three runs
  in a row before calling an unrelated failure "pre-existing".

## Comments in test and stub code

Test files are code, so the comment rules apply to them without exception. Read
`universal.md` in `standards.dir` (section Comments) before writing a test or
a stub. The rules that bite here are the ones a test invites: a comment that
restates its assertion, a fixture explained by inventory instead of by the
failure it provokes, and a header that points at "the specs next door" instead of
naming the file.

The mechanical half is enforced, not advisory. `.workflow/comment_check.py` reads
every comment a run adds, including `<!-- … -->` blocks inside Vue templates, and
the orchestrator hands each violation to the next coder iteration.
