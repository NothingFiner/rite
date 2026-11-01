#!/usr/bin/env bash
# Host-side launcher for stage 2. Run from the repo root:
#   .workflow/run-headless.sh feature/my-branch [pr-number]
#
# The container never sees GitHub credentials. This script clones the branch on the host,
# runs the orchestrator in Docker, and only if it exits 0 pushes and marks the PR ready.
set -euo pipefail

BRANCH="${1:?usage: run-headless.sh <branch> [pr-number]}"
PR="${2:-}"
IMAGE="${IMAGE:-goose-headless}"
REPO_URL="$(git config --get remote.origin.url)"
WORK="$(mktemp -d)"
CACHE="$HOME/.cache/goose-workflow"
mkdir -p "$CACHE"/{cargo,npm,playwright,target,home}

docker build -q -t "$IMAGE" -f .workflow/Dockerfile .workflow >/dev/null

git clone --quiet --branch "$BRANCH" --single-branch "$REPO_URL" "$WORK/repo"

# Read-only mounts from config (needs python3 + pyyaml on the host)
mapfile -t RO < <(python3 -c '
import os, sys, yaml
root = sys.argv[1]
cfg = yaml.safe_load(open(os.path.join(root, ".workflow/config.yaml")))
for p in cfg.get("readonly_mounts", []):
    if os.path.exists(os.path.join(root, p)):
        print(p)
' "$WORK/repo")
RO_ARGS=()
for p in "${RO[@]+"${RO[@]}"}"; do
  RO_ARGS+=(-v "$WORK/repo/$p:/work/$p:ro")
done

set +e
docker run --rm --user "$(id -u):$(id -g)" \
  -e HOME=/cache/home \
  -e CARGO_HOME=/cache/cargo \
  -e CARGO_TARGET_DIR=/cache/target \
  -e PLAYWRIGHT_BROWSERS_PATH=/cache/playwright \
  -e ANTHROPIC_API_KEY -e GOOSE_PROVIDER -e GOOSE_MODEL \
  -v "$CACHE:/cache" \
  -v "$WORK/repo:/work" \
  "${RO_ARGS[@]+"${RO_ARGS[@]}"}" \
  -w /work "$IMAGE" \
  python3 /work/.workflow/orchestrator.py --config .workflow/config.yaml
RC=$?
set -e

echo "--- result ---"
cat "$WORK/repo/.workflow-out/result.json" 2>/dev/null || echo "(no result.json)"

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
