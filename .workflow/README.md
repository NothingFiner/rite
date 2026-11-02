# Goose spec-to-PR workflow

Two stages, with a deterministic script (not an LLM) judging the results.

```
Stage 1 (interactive, your machine)      Stage 2 (headless, Docker)
goose recipe: spec-to-tests              run-headless.sh -> orchestrator.py
  mempalace + repomix                      loop: goose plans + coders -> run tests -> judge
  approve "it should..." sentences         tests locked (read-only mounts + diff check)
  branch, SPEC.md, stubs, failing tests    green -> host pushes and marks PR ready
  draft PR                                 stuck -> escalate model, then stop for a human
```

## Run it
1. Copy `.workflow/` into your repo root and commit it to your base branch.
2. Stage 1: `goose run --recipe .workflow/recipes/spec-to-tests.yaml --interactive`
3. Stage 2: `.workflow/run-headless.sh feature/<branch> <draft-pr-number>`
   Needs on the host: docker, git, gh (authenticated), python3 with pyyaml, and
   ANTHROPIC_API_KEY (or your provider's key) plus GOOSE_PROVIDER / GOOSE_MODEL exported.
   The work tree is created under `~/.cache/goose-workflow` and must stay on a
   host path your Docker VM shares (Colima shares `$HOME` only). Override with
   `WORKFLOW_WORKDIR=<path>`. The launcher preflights the mount and exits 3 if
   the container cannot see the repo.
   The newest 3 work dirs are kept as failure evidence; older ones are pruned
   (`WORKFLOW_KEEP_WORK=0` disables, `N` keeps N).

   **Check the harness before spending tokens:** appending `--baseline-only` runs
   setup, every test layer, the SPEC/coverage check and the red-for-the-right-reason
   check, then stops before the first goose call (~90s, no API cost):
   `.workflow/run-headless.sh feature/<branch> <pr> --baseline-only`

## Host preconditions that will bite you
- **npm 11 or newer.** The lockfile here is only installable by npm >= 11: npm 10
  reports `EUSAGE` / "Missing: esbuild@0.28.2 from lock file" and, when it tries to
  re-resolve, crashes in arborist. The image pins npm@11 for this reason; keep the
  host in step or `npm ci` will disagree between the two.
- **The container clones from `origin`.** Edits to `.workflow/` (orchestrator,
  config, recipes) do not take effect until they are committed *and pushed* — the
  run uses the branch as it exists on the remote, not your working tree. The image
  is the only thing built from local files (`docker build ... .workflow`).
- Work dirs are pruned by mtime, so a run keeps its own logs; the path is printed on
  both success and failure.

## Before first use (things I could not verify)
- `cmd` for the mempalace MCP server in spec-to-tests.yaml (placeholder).
- goose flags: `--interactive`, `--no-session`, `--params`. Check `goose run --help`.
- That `GOOSE_MODEL` is not overridden by anything in your goose config, since the orchestrator
  uses it to switch to the strong model. Set `models.strong` in config.yaml.
- Goose install line and `GOOSE_BIN_DIR` in the Dockerfile.
- That relative `path:` for sub_recipes resolves from the recipe file's directory.
- Tauri 2 default crate has a lib target (`<name>_lib`) so Rust integration tests can import it.

## Design notes
- The orchestrator, not an agent, runs tests, detects "stuck" (same failing set repeated),
  switches model, enforces limits and decides green. The container has no GitHub token.
- Tests are protected two ways: read-only mounts and a post-iteration check against the start commit
  (violations are reverted; a second one aborts).
- Every SPEC.md sentence has an ID (S-001...) that must appear in a test name. The baseline test
  set is recorded, and any test that disappears or gets skipped counts as a failure.
- Coders run one at a time because they share one working tree. Sub-recipes cannot nest, so the
  "bigger model" lives in the orchestrator.
- Skipped tests count as failing. Tests that make real network calls will make the loop flaky.

## Adapting to another stack
Edit `config.yaml` (commands, parsers, protected paths), `TESTING.md` (conventions, stub style)
and the Dockerfile toolchain. The recipes, orchestrator and launcher do not change.
For test runners that emit JUnit XML use `parser: junit`; otherwise add a small parser function
to `orchestrator.py` (see `parse_cargo`).
