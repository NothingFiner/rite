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
# Anything past the first two args goes straight to the orchestrator, e.g.
#   .workflow/run-headless.sh feature/x <pr> --baseline-only
if [ "$#" -gt 2 ]; then shift 2; else shift "$#"; fi
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
WORK="$(mktemp -d "$WORK_BASE/work.XXXXXXXX")"

# Keep the logs of the last few runs and drop the rest; each one is a full clone
# plus node_modules, so they add up fast. This run's dir is the newest, so it is
# never the one pruned, and a failed run's evidence survives until it ages out.
# WORKFLOW_KEEP_WORK=0 disables pruning.
KEEP_WORK="${WORKFLOW_KEEP_WORK:-3}"
if [ "$KEEP_WORK" -gt 0 ] 2>/dev/null; then
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

git clone --quiet --branch "$BRANCH" --single-branch "$REPO_URL" "$WORK/repo"

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

set +e
docker run --rm --user "$(id -u):$(id -g)" \
  -e HOME=/cache/home \
  -e CARGO_HOME=/cache/cargo \
  -e CARGO_TARGET_DIR=/cache/target \
  -e PLAYWRIGHT_BROWSERS_PATH=/cache/playwright \
  -e ANTHROPIC_API_KEY -e GOOSE_PROVIDER -e GOOSE_MODEL \
  -e OLLAMA_API_KEY -e OLLAMA_CLOUD_API_KEY -e OLLAMA_HOST \
  -v "$CACHE:/cache" \
  -v "$WORK/repo:/work" \
  "${RO_ARGS[@]+"${RO_ARGS[@]}"}" \
  -w /work "$IMAGE" \
  python3 /work/.workflow/orchestrator.py --config .workflow/config.yaml "$@"
RC=$?
set -e

echo "--- result ---"
cat "$WORK/repo/.workflow-out/result.json" 2>/dev/null || echo "(no result.json)"

if [ "$RC" -eq 0 ] && [ "$PUSH" -eq 0 ]; then
  echo "Baseline-only run: nothing to push. Work tree: $WORK/repo"
  exit 0
fi

if [ "$RC" -eq 0 ]; then
  git -C "$WORK/repo" push origin "$BRANCH"
  if command -v gh >/dev/null 2>&1; then
    if [ -n "$PR" ]; then
      gh pr ready "$PR"
    else
      gh pr create --base development --head "$BRANCH" --fill
    fi
    echo "Done: branch pushed and PR ready."
  else
    echo "Done: branch pushed. gh is not installed, so the PR was not updated."
  fi
else
  echo "Not pushing (exit code $RC). Logs and the work so far are in: $WORK/repo"
  exit "$RC"
fi
