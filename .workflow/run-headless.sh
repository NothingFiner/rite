#!/usr/bin/env bash
# Host-side launcher for stage 2. Run from the repo root:
#   .workflow/run-headless.sh feature/my-branch [pr-number]
#
# The container never sees GitHub credentials. This script clones the branch on the host,
# runs the orchestrator in Docker, and only if it exits 0 pushes and marks the PR ready.
#
# Provider credentials must be exported in the calling shell: the container has an empty
# HOME, so it cannot read ~/.config/goose (provider/model) or the macOS keychain (API keys).
#   GOOSE_PROVIDER=ollama_cloud  OLLAMA_CLOUD_API_KEY=...  (or OLLAMA_API_KEY)
# The model ids come from .workflow/config.yaml (`models:`), so GOOSE_MODEL is optional.
set -euo pipefail

BRANCH="${1:?usage: run-headless.sh <branch> [pr-number] [orchestrator-args...]}"
PR="${2:-}"
# Must match base_branch in .workflow/config.yaml. The orchestrator needs the base
# branch inside the container to diff the change for the PR description, and the
# single-branch clone does not carry it, so it is fetched in below.
BASE="${BASE_BRANCH:-development}"
# Anything past the first two args goes straight to the orchestrator, e.g.
#   .workflow/run-headless.sh feature/x <pr> --baseline-only
if [ "$#" -gt 2 ]; then shift 2; else shift "$#"; fi

# --resume continues in the work tree from a previous (stopped or failed) run
# instead of re-cloning and re-implementing from scratch. --resume-dir names that
# work dir explicitly; bare --resume picks the newest one. Only --resume is passed
# on to the orchestrator (it changes the baseline gate); --resume-dir is launcher
# business and is consumed here.
RESUME=0
RESUME_DIR=""
ORCH_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --resume) RESUME=1; ORCH_ARGS+=("$1"); shift ;;
    --resume-dir) RESUME=1; RESUME_DIR="${2:-}"; shift 2 ;;
    *) ORCH_ARGS+=("$1"); shift ;;
  esac
done
set -- ${ORCH_ARGS[@]+"${ORCH_ARGS[@]}"}
GIT_ID_ARGS=(-c user.name=goose-bot -c user.email=goose-bot@localhost)
PUSH=1
for a in "$@"; do [ "$a" = "--baseline-only" ] && PUSH=0; done
IMAGE="${IMAGE:-goose-headless}"
# Overridable so a broken ssh-agent (or an ssh remote you can only reach over
# https) does not block the run: REPO_URL=https://github.com/owner/repo.git
REPO_URL="${REPO_URL:-$(git config --get remote.origin.url)}"
CACHE="$HOME/.cache/goose-workflow"
mkdir -p "$CACHE"/{cargo,npm,playwright,target,home}

# The work tree MUST live on a host path the Docker VM actually shares, or the
# bind mount silently materialises as an empty directory (Docker creates the
# missing path instead of erroring) and the container sees no repo at all.
# Colima shares $HOME only by default; `mktemp -d` hands back /var/folders/...,
# which is NOT shared. Keep the work dir under $CACHE, which is under $HOME.
WORK_BASE="${WORKFLOW_WORKDIR:-$CACHE}"
mkdir -p "$WORK_BASE"

if [ "$RESUME" -eq 1 ]; then
  if [ -n "$RESUME_DIR" ]; then
    CAND="$(cd "$RESUME_DIR" 2>/dev/null && pwd)" || { echo "resume: no such work dir: $RESUME_DIR" >&2; exit 4; }
    # Accept either the work dir or the clone inside it — the failure message
    # prints the work dir, but people paste whatever path they last saw.
    if [ "$(basename "$CAND")" = "repo" ] && [ -d "$CAND/.git" ]; then
      CAND="$(dirname "$CAND")"
    fi
    WORK="$CAND"
  else
    WORK="$(ls -1dt "$WORK_BASE"/work.* 2>/dev/null | head -1)"
  fi
  [ -n "${WORK:-}" ] && [ -d "$WORK/repo/.git" ] \
    || { echo "resume: no work dir with a clone under $WORK_BASE" >&2; exit 4; }
  # Resuming the wrong branch would push its work onto this one, so check rather
  # than trust the path. Detached HEAD is refused too: it means a half-finished
  # merge or rebase was left behind and nothing about it is resumable.
  HAVE_BRANCH="$(git -C "$WORK/repo" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if [ "$HAVE_BRANCH" != "$BRANCH" ]; then
    echo "resume: $WORK/repo is on '${HAVE_BRANCH:-detached HEAD}', not '$BRANCH'" >&2
    echo "resume: check it out on the right branch, or start a fresh run" >&2
    exit 4
  fi
  if [ -d "$WORK/repo/.git/rebase-merge" ] || [ -d "$WORK/repo/.git/rebase-apply" ] \
     || [ -f "$WORK/repo/.git/MERGE_HEAD" ]; then
    echo "resume: $WORK/repo is mid-merge/rebase — finish or abort it first" >&2
    exit 4
  fi
  echo "resuming in $WORK ($BRANCH)"
else
  WORK="$(mktemp -d "$WORK_BASE/work.XXXXXXXX")"
fi

# Keep the logs of the last few runs and drop the rest; each one is a full clone
# plus node_modules, so they add up fast. This run's dir is the newest, so it is
# never the one pruned, and a failed run's evidence survives until it ages out.
# WORKFLOW_KEEP_WORK=0 disables pruning.
KEEP_WORK="${WORKFLOW_KEEP_WORK:-3}"
if [ "$KEEP_WORK" -gt 0 ] 2>/dev/null && [ "$RESUME" -eq 0 ]; then
  OLD_WORK="$(ls -1dt "$WORK_BASE"/work.* 2>/dev/null | tail -n +$((KEEP_WORK + 1)))"
  if [ -n "$OLD_WORK" ]; then
    echo "pruning old work dirs (keeping the newest $KEEP_WORK):"
    while IFS= read -r d; do
      case "$d" in
        "$WORK_BASE"/work.*) echo "  $d"; rm -rf "$d" ;;
      esac
    done <<< "$OLD_WORK"
  fi
fi

docker build -q -t "$IMAGE" -f .workflow/Dockerfile .workflow >/dev/null

# Preflight: goose is useless without a provider, and the container starts with
# an empty HOME by design — it can NOT read ~/.config/goose (provider settings)
# or the macOS keychain (API keys). The provider therefore has to be exported in
# the calling shell. Catching that here costs about a second; catching it three
# goose iterations later costs the whole run (clone, npm ci, every test layer)
# and reports it as an agent failure.
#
# The provider NAME is not a secret and the host already knows it (goose's own
# config), so default it from there. The API KEY is a secret and lives in the
# macOS keychain, which the container cannot read — that one is still manual.
if [ -z "${GOOSE_PROVIDER:-}" ] && [ -f "$HOME/.config/goose/config.yaml" ]; then
  HOST_PROVIDER="$(python3 -c '
import sys, yaml
cfg = yaml.safe_load(open(sys.argv[1])) or {}
print(cfg.get("active_provider") or "")
' "$HOME/.config/goose/config.yaml" 2>/dev/null || true)"
  if [ -n "$HOST_PROVIDER" ]; then
    export GOOSE_PROVIDER="$HOST_PROVIDER"
    echo "provider: '$GOOSE_PROVIDER' (from ~/.config/goose/config.yaml)"
  fi
fi

# goose stores its secrets in the login keychain (service "goose", account
# "secrets") as a JSON map — that is where `goose configure` put them. Reuse that
# entry instead of asking you to keep the key in ~/.zshrc: it is read for this one
# run, passed to the container as an environment variable, and written nowhere.
# macOS may ask once for permission; choose "Always Allow".
#
# Nothing is printed but the variable NAME. The key itself must not appear in a
# terminal scrollback or in the workflow logs.
KEY_VAR=""
case "${GOOSE_PROVIDER:-}" in
  ollama_cloud) KEY_VAR=OLLAMA_CLOUD_API_KEY ;;
  ollama)       KEY_VAR=OLLAMA_API_KEY ;;
  anthropic)    KEY_VAR=ANTHROPIC_API_KEY ;;
  openai)       KEY_VAR=OPENAI_API_KEY ;;
esac
if [ -n "$KEY_VAR" ] && [ -z "${!KEY_VAR:-}" ]; then
  KEYCHAIN_BLOB="$(security find-generic-password -s goose -a secrets -w 2>/dev/null || true)"
  if [ -n "$KEYCHAIN_BLOB" ]; then
    KEYCHAIN_VALUE="$(printf '%s' "$KEYCHAIN_BLOB" | python3 -c '
import json, sys
try:
    secrets = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if isinstance(secrets, dict) and isinstance(secrets.get(sys.argv[1]), str):
    print(secrets[sys.argv[1]])
' "$KEY_VAR" 2>/dev/null || true)"
    if [ -n "$KEYCHAIN_VALUE" ]; then
      export "$KEY_VAR=$KEYCHAIN_VALUE"
      echo "provider key: $KEY_VAR read from the login keychain (goose's own entry)"
    fi
  fi
fi

PREFLIGHT_OUT="$(docker run --rm -e HOME=/cache/home \
      -e GOOSE_PROVIDER -e ANTHROPIC_API_KEY -e OPENAI_API_KEY \
      -e OLLAMA_API_KEY -e OLLAMA_CLOUD_API_KEY \
      -v "$CACHE:/cache" "$IMAGE" sh -c '
        prov="${GOOSE_PROVIDER:-$(grep -m1 "^active_provider:" "$HOME/.config/goose/config.yaml" 2>/dev/null | cut -d" " -f2)}"
        if [ -z "$prov" ]; then echo "no provider is configured (GOOSE_PROVIDER is empty)"; exit 1; fi
        case "$prov" in
          ollama_cloud) [ -n "${OLLAMA_CLOUD_API_KEY:-}${OLLAMA_API_KEY:-}" ] || { echo "provider $prov is set but neither OLLAMA_CLOUD_API_KEY nor OLLAMA_API_KEY is exported"; exit 1; } ;;
          anthropic)    [ -n "${ANTHROPIC_API_KEY:-}" ] || { echo "provider anthropic is set but ANTHROPIC_API_KEY is not exported"; exit 1; } ;;
          openai)       [ -n "${OPENAI_API_KEY:-}" ]    || { echo "provider openai is set but OPENAI_API_KEY is not exported"; exit 1; } ;;
        esac
        echo "ok: provider $prov"' 2>&1 </dev/null)" || {
  echo "FATAL: goose would not be able to reach a model." >&2
  echo "  $PREFLIGHT_OUT" >&2
  echo "The container gets an empty HOME, so it cannot read ~/.config/goose or the" >&2
  echo "macOS keychain. Export the provider's API key in THIS shell, then re-run:" >&2
  echo "  export OLLAMA_CLOUD_API_KEY=...     # for provider ollama_cloud" >&2
  echo "  export GOOSE_PROVIDER=ollama_cloud  # only if it is not the host default" >&2
  echo "(.workflow/config.yaml sets the MODEL ids, not the provider or the key.)" >&2
  exit 5
}
echo "provider preflight: $PREFLIGHT_OUT"

if [ "$RESUME" -eq 0 ]; then
  git clone --quiet --branch "$BRANCH" --single-branch "$REPO_URL" "$WORK/repo"
fi

if [ "$RESUME" -eq 1 ]; then
  # Fold the stopped run's uncommitted work into a commit, then take the amended
  # tests from origin. Implementation files and test files never overlap (tests
  # are path-locked), so this merge is expected to be clean.
  git -C "$WORK/repo" add -A
  git -C "$WORK/repo" "${GIT_ID_ARGS[@]}" commit -q -m "wip: work preserved from the stopped run" 2>/dev/null || true
  echo "resume: fetching origin/$BRANCH to pick up the amended tests"
  git -C "$WORK/repo" fetch -q origin "$BRANCH"
  if ! git -C "$WORK/repo" merge --no-edit -q FETCH_HEAD; then
    echo "resume: merge conflict with origin/$BRANCH — resolve it in $WORK/repo and re-run" >&2
    exit 4
  fi
fi

# The base branch must exist inside the container: the PR description is written by
# diffing the finished change against it. Non-fatal — without it the description
# falls back to a summary with no diff.
git -C "$WORK/repo" fetch --quiet origin "+refs/heads/$BASE:refs/heads/$BASE" 2>/dev/null \
  || echo "warning: could not fetch $BASE into the clone; the PR description will lack the diff" >&2

# Coding standards for the coder. The rules live in a separate repo (see
# `standards:` in config.yaml); they are COPIED into the work tree on every run
# rather than vendored into this one, so the coder always reads the current
# rules and there is nothing here to drift out of date. STANDARDS_DIR overrides
# the path. A missing tree is not fatal — it is reported and the run continues.
python3 - "$WORK/repo" <<'STANDARDS_COPY'
import os, shutil, sys
from pathlib import Path
import yaml

repo = Path(sys.argv[1])
# Clear unconditionally: a stale copy must not survive a run that ships no
# standards, or the coder would read last run's rules.
out = repo / ".workflow-out" / "standards"
if out.exists():
    shutil.rmtree(out)

cfg = (yaml.safe_load((repo / ".workflow/config.yaml").read_text()) or {}).get("standards") or {}
if not cfg.get("enabled", False):
    print("standards: disabled by config")
    raise SystemExit(0)

source = Path(os.path.expanduser(os.environ.get("STANDARDS_DIR") or cfg.get("dir") or ""))
if not source.is_dir():
    print(f"standards: {source} is not a directory — the coder runs without them")
    raise SystemExit(0)

out.mkdir(parents=True)
copied, missing = [], []
for index, name in enumerate(cfg.get("files") or [], start=1):
    candidate = source / name
    if candidate.is_file():
        # Numbered so that filename order IS composition order: the coder is told
        # "later file wins", and alphabetical order would not deliver that
        # (universal.md would sort last instead of first).
        shutil.copy2(candidate, out / f"{index:02d}-{Path(name).name}")
        copied.append(name)
    else:
        missing.append(name)
print(f"standards: {len(copied)} file(s) into {out.relative_to(repo)}: {', '.join(copied) or 'none'}")
if missing:
    print(f"standards: NOT FOUND in {source}: {', '.join(missing)}")
STANDARDS_COPY

# Preflight: prove the bind mount really crosses into the VM before spending
# minutes on clone/setup/goose. Costs ~1s and turns a silent empty mount into a
# one-line explanation.
if ! docker run --rm -v "$WORK/repo:/preflight:ro" -w / "$IMAGE" \
      test -f /preflight/.workflow/orchestrator.py >/dev/null 2>&1; then
  echo "FATAL: $WORK/repo is not visible inside the container." >&2
  echo "The Docker VM is not sharing that host path, so /work would be empty." >&2
  echo "Colima shares \$HOME by default; set WORKFLOW_WORKDIR to a shared dir" >&2
  echo "(e.g. WORKFLOW_WORKDIR=\$HOME/tmp) or add a mount to ~/.colima/default/colima.yaml:" >&2
  echo "  mounts:" >&2
  echo "    - location: /private/var/folders" >&2
  echo "      writable: true" >&2
  echo "  then: colima restart" >&2
  exit 3
fi

# Read-only mounts from config (needs python3 + pyyaml on the host).
# No `mapfile` here: macOS ships bash 3.2, which does not have it.
RO_LIST="$(python3 -c '
import os, sys, yaml
root = sys.argv[1]
cfg = yaml.safe_load(open(os.path.join(root, ".workflow/config.yaml")))
for p in cfg.get("readonly_mounts", []):
    if os.path.exists(os.path.join(root, p)):
        print(p)
' "$WORK/repo")"
RO_ARGS=()
while IFS= read -r p; do
  if [ -n "$p" ]; then
    RO_ARGS+=(-v "$WORK/repo/$p:/work/$p:ro")
  fi
done <<< "$RO_LIST"

# The bind mount's root reaches the container as root-owned (a virtiofs/sshfs
# uid remap under Colima) while every file inside keeps the host uid, so git
# rejects the worktree as "dubious ownership" even though the container runs as
# that same host uid. Trust it: this is a throwaway clone the script made
# itself, not somebody else's repository.
set +e
docker run --rm --user "$(id -u):$(id -g)" \
  -e HOME=/cache/home \
  -e CARGO_HOME=/cache/cargo \
  -e CARGO_TARGET_DIR=/cache/target \
  -e PLAYWRIGHT_BROWSERS_PATH=/cache/playwright \
  -e ANTHROPIC_API_KEY -e OPENAI_API_KEY -e GOOSE_PROVIDER -e GOOSE_MODEL \
  -e OLLAMA_API_KEY -e OLLAMA_CLOUD_API_KEY -e OLLAMA_HOST \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
  -v "$CACHE:/cache" \
  -v "$WORK/repo:/work" \
  "${RO_ARGS[@]+"${RO_ARGS[@]}"}" \
  -w /work "$IMAGE" \
  python3 /work/.workflow/orchestrator.py --config .workflow/config.yaml "$@"
RC=$?
set -e

echo "--- result ---"
if [ -f "$WORK/repo/.workflow-out/result.json" ]; then
  cat "$WORK/repo/.workflow-out/result.json"
else
  echo "(no result.json: the orchestrator exited $RC without reaching a verdict)"
  echo "(read the error above — a traceback is the cause, not the test suite)"
fi

if [ "$RC" -eq 0 ] && [ "$PUSH" -eq 0 ]; then
  echo "Baseline-only run: nothing to push. Work tree: $WORK/repo"
  exit 0
fi

if [ "$RC" -eq 0 ]; then
  git -C "$WORK/repo" push origin "$BRANCH"
  # The reviewer agent's description of the code change, written inside the container
  # (which has no GitHub token) and applied here.
  BODY="$WORK/repo/.workflow-out/pr-description.md"
  TITLE_FILE="$WORK/repo/.workflow-out/pr-title.txt"
  TITLE=""
  if [ -f "$TITLE_FILE" ]; then TITLE="$(head -1 "$TITLE_FILE")"; fi
  if command -v gh >/dev/null 2>&1; then
    if [ -n "$PR" ]; then
      if [ -f "$BODY" ]; then
        gh pr edit "$PR" --body-file "$BODY" ${TITLE:+--title "$TITLE"}
        echo "PR updated from the reviewer agent's description of the change."
      else
        echo "No change description was written; the PR body was left as it was."
      fi
      gh pr ready "$PR"
    else
      if [ -f "$BODY" ]; then
        gh pr create --base "$BASE" --head "$BRANCH" \
          ${TITLE:+--title "$TITLE"} --body-file "$BODY"
      else
        gh pr create --base "$BASE" --head "$BRANCH" --fill
      fi
    fi
    echo "Done: branch pushed and PR ready."
  else
    echo "Done: branch pushed. gh is not installed, so the PR was not updated."
  fi
else
  echo "Not pushing (exit code $RC). Logs and the work so far are in: $WORK/repo"
  # Never throw the implementation away. A stopped run's work is worth more than
  # the tokens it would take to reproduce it, so preserve it on a side ref; a
  # later --resume-dir <this dir> continues from it.
  if [ "$PUSH" -eq 1 ]; then
    git -C "$WORK/repo" add -A
    git -C "$WORK/repo" "${GIT_ID_ARGS[@]}" commit -q -m "wip: work preserved (run exited $RC)" 2>/dev/null || true
    if git -C "$WORK/repo" push -q origin "HEAD:refs/heads/wip/$BRANCH" 2>/dev/null; then
      echo "Work preserved on origin as wip/$BRANCH"
    else
      echo "Could not push wip/$BRANCH (the work tree still holds it)."
    fi
  fi
  echo "Resume this run with:"
  echo "  .workflow/run-headless.sh $BRANCH ${PR:-<pr>} --resume-dir $WORK"
  exit "$RC"
fi
