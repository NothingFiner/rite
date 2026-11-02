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

## Provider preflight (why a run stops before it starts)
The container starts with an empty `HOME`, so it cannot read `~/.config/goose`
(provider settings) or the macOS keychain (API keys). The provider name is
therefore defaulted from your host goose config and printed, but **the API key
must be exported in the shell that runs the launcher**:

```
export OLLAMA_CLOUD_API_KEY=...      # for provider ollama_cloud
export GOOSE_PROVIDER=ollama_cloud   # only if it is not your host default
```

The launcher checks this in the image before cloning and exits 5 with the reason
if it cannot reach a model. If one gets past it anyway, the orchestrator reads
the goose log, recognises "No provider configured" (and a bad key, a bad model
id, a missing recipe) and stops on the first iteration with that reason instead
of retrying three times, escalating to the strong model, and blaming the agent.

## When a run stops: resume it instead of rebuilding
A run that ends in `needs_human` keeps its work tree, and the launcher now also
preserves the work on `origin` as `wip/<branch>` and prints the exact command to
continue. Resuming reuses the existing tree, folds its uncommitted work into a
commit, and merges the amended tests from `origin/<branch>` — so a human-fixed
test does not cost a whole implementation pass.

```
.workflow/run-headless.sh <branch> <pr> --resume-dir <work-dir>   # or a path inside it
.workflow/run-headless.sh <branch> <pr> --resume                  # newest work dir
```

`--resume` changes the baseline gate: a resumed run does **not** have to start red,
because the implementation already exists. It only refuses to start if a test that
passed in the previous run now fails (`baseline.json` in `.workflow-out/` records
that). It also refuses a work tree on the wrong branch, or one left mid-merge.

## The pull-request description
When the suite goes green the orchestrator runs `.workflow/recipes/describe-changes.yaml`
once: a fresh agent reads the diff against the base branch and writes a PR title and a
body that explains the code change. It is a separate call, not the builder — the builder
works per iteration and never sees the finished state, so it would describe its intent
rather than the result.

The agent writes the prose; the orchestrator appends the measured facts (per-layer test
counts, the diffstat, and the approved spec in a collapsible block) so those cannot be
narrated. The container has no GitHub token, so it writes
`.workflow-out/pr-description.md` and `.workflow-out/pr-title.txt` and the host applies
them with `gh pr edit`.

It never fails a run. Disabled config, a missing recipe, missing goose, a timeout, or a
body under 200 characters all fall back to a measured summary of the diff, and an
exception in the step is caught. The agent is not allowed to change the code: its edits
are reverted, but only when the tree was clean before it ran, so nothing pre-existing is
ever destroyed. `--no-describe` skips the step to save one call on success. Tune it in
`config.yaml`:

```yaml
pr_description:
  enabled: true
  recipe: .workflow/recipes/describe-changes.yaml
  model: ""          # blank = models.default; this job does not need the strong model
  max_patch_kb: 120  # the diffstat is always complete, only the patch is capped
  style:
    standard: asd-ste100
    target_compliance: 0.8
    max_words_per_sentence: 25
    retry_below_target: true
```

### Style: ASD-STE100
The description and title follow ASD-STE100 Simplified Technical English: one fact per
sentence, active voice, simple present tense, at most 25 words per sentence, one word for
one thing, no contractions, no nominalisations, no filler. Technical names are exempt and
stay as the code writes them.

The target is about 80%, not 100%. STE is a controlled language with a restricted
dictionary, and prose bent all the way into it stops explaining the code, which is the
only reason the section exists.

The orchestrator measures the agent's prose and logs the score:

```
style: 82% STE of 31 sentences (meets the 80% target); 6 flagged
style: - 34 words: On green, the orchestrator runs `...` once: a fresh agent reads ...
style: - passive: Patch delivery is capped (`max_patch_kb`, default 120) ...
```

The checks are the mechanical part of STE — sentence length, a passive-voice pattern,
contractions, nominalisations and a banned-word list. They are a proxy, not a
certification: there is no dictionary check and no part-of-speech tagging.

A draft below the target gets **one** rewrite pass, with the flagged sentences passed back
as `style_notes`. The rewrite is accepted only when it scores better, so a rewrite cannot
silently lose detail. `retry_below_target: false` turns the pass off and keeps the
measurement.

## Progress and cost, per iteration
Every iteration logs one line and appends a JSON line to
`.workflow-out/progress.jsonl`:

```
[orchestrator 13:03:11] progress: 12/31 passing, 19 failing (+4 vs previous) | 6.4 min | 212k tokens this iteration | 4.81M total
```

Token counts come from goose's own `usage_ledger` table in
`~/.local/share/goose/sessions/sessions.db`. In the container `HOME` is
`/cache/home` and `/cache` is bind-mounted from the host, so the ledger survives
the run and the totals stay cumulative across runs. If the ledger is missing or
a goose build has no usage table, the line says `n/a` rather than failing.

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
