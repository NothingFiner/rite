#!/usr/bin/env python3
"""Explain a finished headless run without re-running it.

    .workflow/why.py                       # newest work tree on this machine
    .workflow/why.py path/to/repo          # a specific checkout
    .workflow/why.py --tail 40             # also show the end of the coder log

The orchestrator's verdict is one sentence in `result.json`. This prints the
neighbours of that sentence: the per-iteration scoreboard, the last plan, the
tests that were still failing, and the tail of the agent's own log. Read-only,
no tokens.
"""
import argparse
import json
import sys
from pathlib import Path


def newest_work_tree():
    root = Path.home() / ".cache/goose-workflow"
    trees = sorted(root.glob("work.*/repo"), key=lambda p: p.stat().st_mtime, reverse=True)
    return trees[0] if trees else None


def read_json(path, default=None):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def read_text(path):
    try:
        return path.read_text()
    except OSError:
        return ""


def newest(directory, pattern):
    matches = sorted(directory.glob(pattern), key=lambda p: p.stat().st_mtime)
    return matches[-1] if matches else None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("repo", nargs="?", help="checkout to inspect (default: newest work tree)")
    ap.add_argument("--out", default=".workflow-out", help="where the orchestrator wrote (default: .workflow-out)")
    ap.add_argument("--tail", type=int, default=0, metavar="N",
                    help="also print the last N lines of the newest agent log")
    args = ap.parse_args()

    repo = Path(args.repo) if args.repo else newest_work_tree()
    if repo is None:
        sys.exit("no work tree found under ~/.cache/goose-workflow; pass a path")
    out = repo / args.out
    if not out.is_dir():
        sys.exit(f"{out} does not exist — this checkout has no orchestrator output")

    result = read_json(out / "result.json", {}) or {}
    print(f"repo      {repo}")
    print(f"status    {result.get('status', 'unknown')}")
    print(f"reason    {result.get('reason', '(no result.json reason)')}")
    if result.get("iterations") is not None:
        print(f"iterations {result['iterations']}")

    rows = [json.loads(ln) for ln in read_text(out / "progress.jsonl").splitlines() if ln.strip()]
    if rows:
        print("\niteration  passing/total  failing  delta   seconds  tokens    Mtok/fail  scope")
        for r in rows:
            rate = r.get("tokens_per_cleared")
            rate_s = f"{rate / 1e6:.1f}" if rate else "-"
            # `!` marks an iteration the spin guard would count: more than the
            # usual ~0.7 M per cleared failure.
            hot = "!" if rate and rate > 2_000_000 else " "
            print(
                f"{r.get('iteration', '?'):>9}  "
                f"{r.get('passing', '?')}/{r.get('total', '?')}".ljust(23)
                + f"{r.get('failing', '?'):>7}  {r.get('delta', 0):>+5}  "
                f"{r.get('seconds', 0):>7.0f}  {r.get('tokens_iteration') or 0:>9,}  "
                f"{rate_s:>8}{hot}  "
                f"{r.get('scope_layer') or '-'} {r.get('scope_in') or ''}"
            )

    plan = newest(out, "plan-iter-*.md")
    if plan:
        heads = [ln.strip()[3:] for ln in read_text(plan).splitlines() if ln.startswith("## ")]
        print(f"\nlast plan  {plan.name}")
        for h in heads:
            print(f"  - {h}")

    failures = read_text(out / "last_failures.md")
    if failures:
        listed = [ln for ln in failures.splitlines() if ln.startswith("- ") and "::" in ln]
        print(f"\nstill failing ({len(listed)}):")
        for ln in listed[:12]:
            print(f"  {ln[2:]}")
        if len(listed) > 12:
            print(f"  … {len(listed) - 12} more in last_failures.md")

    objection = read_text(out / "test-objection.md")
    if objection:
        print("\nagent objection (test-objection.md):")
        for ln in objection.splitlines()[:20]:
            print(f"  {ln}")

    print("\nevidence  " + ", ".join(f".workflow-out/{p.name}" for p in filter(None, [
        out / "result.json", out / "last_failures.md",
        plan, newest(out, "goose-iter*.log"),
    ])))
    if args.tail:
        log = newest(out, "goose-iter*.log")
        if log:
            print(f"\n--- last {args.tail} lines of {log.name} ---")
            for ln in read_text(log).splitlines()[-args.tail:]:
                print(ln)


if __name__ == "__main__":
    main()
