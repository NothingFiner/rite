#!/usr/bin/env python3
"""Headless build loop. goose writes the code; this script is the judge.

Runs inside the container with the repo checked out on the feature branch (cwd = repo root).
It has no GitHub credentials and never pushes. On success it exits 0 and the host script
(run-headless.sh) pushes the branch and marks the PR ready.

Exit codes: 0 green | 1 setup/config error | 2 needs a human | 3 protected-path tampering

Per iteration:
  1. goose plans and codes (plan-and-code.yaml + coder sub-recipes)
  2. revert any edits to protected paths (second offence aborts)
  3. revert any edits to `test_regions` inside otherwise-editable files (second offence aborts)
  4. run every test layer, parse results
  5. fail if any baseline test disappeared, was skipped, or became skipped
  6. commit the work, then decide: green / continue / escalate model / give up
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import yaml

OUT = Path(".workflow-out")
GIT_ID = ["-c", "user.name=goose-bot", "-c", "user.email=goose-bot@localhost"]
SYNTHETIC = ("__BUILD_OR_RUN_ERROR__", "__NO_TESTS_RAN__")
SPEC_ID = re.compile(r"(?<![A-Za-z0-9])[Ss][-_ ]?(\d{3})(?!\d)")


def log(msg):
    print(f"[orchestrator {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def finish(status, reason, code, **extra):
    OUT.mkdir(exist_ok=True)
    (OUT / "result.json").write_text(json.dumps({"status": status, "reason": reason, **extra}, indent=2))
    log(f"{status}: {reason}")
    sys.exit(code)


# ---------- git helpers ----------

def git(*args, check=True):
    p = subprocess.run(["git", *GIT_ID, *args], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {p.stderr.strip()}")
    return p.stdout


def commit(msg):
    git("add", "-A")
    if git("status", "--porcelain").strip():
        git("commit", "-q", "-m", msg)


# ---------- protected paths ----------

def glob_to_regex(g):
    i, out = 0, ""
    while i < len(g):
        if g.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
        elif g.startswith("**", i):
            out += ".*"
            i += 2
        elif g[i] == "*":
            out += "[^/]*"
            i += 1
        elif g[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(g[i])
            i += 1
    return re.compile("^" + out + "$")


def protected_violations(start_sha, patterns):
    changed = set(git("diff", "--name-only", start_sha).splitlines())
    changed |= set(git("ls-files", "--others", "--exclude-standard").splitlines())
    return sorted(f for f in changed if any(p.match(f) for p in patterns))


def restore(start_sha, files):
    for f in files:
        existed = subprocess.run(
            ["git", "cat-file", "-e", f"{start_sha}:{f}"], capture_output=True
        ).returncode == 0
        if existed:
            git("checkout", start_sha, "--", f)
        else:
            Path(f).unlink(missing_ok=True)
            git("rm", "--cached", "--quiet", "--ignore-unmatch", f, check=False)


# ---------- test regions ----------
#
# `protected_paths` locks whole files, which only works when the test file is
# never the implementation file. Rust's idiom is the opposite: regression tests
# live in a `#[cfg(test)] mod tests` block at the bottom of the very module they
# test, so the coder MUST edit that file to do the work.
#
# Leaving the file open leaves one hole the other two guards cannot see. The
# baseline-name diff below catches a test being deleted, renamed or filtered
# (its id disappears), and `skipped` counting as red catches it being silenced.
# Neither catches an assertion being *weakened in place* while the name and the
# pass state stay put: `assert_eq!(n, 3)` -> `assert!(n > 0)` is invisible to
# both. That is the tamper route this section closes.
#
# A "region" is everything from `marker` to end of file (where the inline test
# module always is). Its hash is taken from the start commit and re-checked
# every iteration. Code above the marker — the actual implementation — is
# untouched and free to change. A legitimate need to change a test is exactly
# the case the coder recipe already routes to `.workflow-out/test-objection.md`.

def region_span(text, marker):
    m = re.search(r"^" + re.escape(marker), text, re.M)
    return None if m is None else m.start()


def region_digest(text, marker):
    start = region_span(text, marker)
    return None if start is None else hashlib.sha256(text[start:].encode()).hexdigest()


def region_pairs(start_sha, spec):
    """(file, marker) for every tracked file matching a `test_regions` entry."""
    tracked = git("ls-tree", "-r", "--name-only", start_sha).splitlines()
    for entry in spec or []:
        pattern = glob_to_regex(entry["glob"])
        marker = entry.get("marker", "#[cfg(test)]")
        for f in tracked:
            if pattern.match(f):
                yield f, marker


def read_text(f):
    try:
        return Path(f).read_text()
    except (OSError, UnicodeDecodeError):
        return ""


def region_violations(start_sha, spec):
    """(file, marker) pairs whose test region no longer matches the baseline."""
    bad = []
    for f, marker in region_pairs(start_sha, spec):
        before = region_digest(git("show", f"{start_sha}:{f}"), marker)
        if before is None:
            continue  # no test region at baseline — nothing to protect here
        if region_digest(read_text(f), marker) != before:
            bad.append((f, marker))
    return bad


def restore_regions(start_sha, pairs):
    """Splice the baseline test region back in, leaving the implementation alone.

    Deliberately NOT `restore()`: checking the whole file out of `start_sha`
    would throw away the implementation the agent just wrote into it, so the
    iteration's real work would vanish along with the tampering. Only the text
    from the marker to EOF is replaced, so the suite goes back to failing on the
    tests it was supposed to satisfy.
    """
    for f, marker in pairs:
        base = git("show", f"{start_sha}:{f}")
        base_start = region_span(base, marker)
        if base_start is None:
            continue
        current = read_text(f)
        cur_start = region_span(current, marker)
        if cur_start is None:
            # The agent deleted the whole test block; re-append the baseline one.
            head = current.rstrip() + "\n\n" if current.strip() else ""
            Path(f).write_text(head + base[base_start:])
        else:
            Path(f).write_text(current[:cur_start] + base[base_start:])


# ---------- test running and parsing ----------

def parse_junit(path):
    if not path.exists():
        return []
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError:
        return []
    out = []
    for tc in root.iter("testcase"):
        name, cls = tc.get("name", "?"), tc.get("classname", "")
        tid = f"{cls}::{name}" if cls else name
        if tc.find("failure") is not None or tc.find("error") is not None:
            status = "failed"
        elif tc.find("skipped") is not None:
            status = "skipped"
        else:
            status = "passed"
        out.append((tid, status))
    return out


CARGO_LINE = re.compile(r"^test (\S+) \.\.\. (ok|FAILED|ignored)", re.M)


def parse_cargo(text):
    status = {"ok": "passed", "FAILED": "failed", "ignored": "skipped"}
    return [(name, status[s]) for name, s in CARGO_LINE.findall(text)]


def run_layers(cfg, timeout_s):
    tests, failing, per_layer = [], [], {}
    for layer in cfg["test_layers"]:
        name = layer["name"]
        report = Path(layer["report"]) if layer.get("report") else None
        if report:
            report.unlink(missing_ok=True)  # never trust a stale report
        log(f"running layer {name}")
        try:
            p = subprocess.run(layer["cmd"], shell=True, cwd=layer.get("cwd", "."),
                               capture_output=True, text=True, timeout=timeout_s)
            text, rc = p.stdout + "\n" + p.stderr, p.returncode
        except subprocess.TimeoutExpired:
            text, rc = f"TIMEOUT after {timeout_s}s", 124
        logfile = OUT / f"{name}.log"
        logfile.write_text(text)

        parsed = parse_junit(report) if layer.get("parser", "junit") == "junit" else parse_cargo(text)
        tests += [(f"{name}::{tid}", st) for tid, st in parsed]
        bad = [f"{name}::{tid}" for tid, st in parsed if st != "passed"]  # skipped counts as not green
        if rc != 0 and not bad:
            bad.append(f"{name}::{SYNTHETIC[0]}")
        if rc == 0 and not parsed:
            bad.append(f"{name}::{SYNTHETIC[1]}")
        failing += bad
        per_layer[name] = {"rc": rc, "failing": bad, "log": str(logfile)}
    return {"tests": tests, "failing": failing, "per_layer": per_layer}


def failing_excluding_baseline_skips(res, base_status):
    """Drop failures that are just "still skipped, exactly as it already was".

    `run_layers` treats every non-`passed` status as failing, and that is load
    bearing: it is what stops an agent from silencing a test with `#[ignore]`,
    `.skip`, `.todo` or `test.fixme` instead of making it pass.

    But the blanket rule also condemns tests that were ALREADY ignored when the
    run started — this repo ships three `#[ignore]`d live-Ollama round-trips that
    need a running server, and `cargo test` reports them as `ignored` forever.
    Under the blanket rule they sit in `failing` for the whole run, so
    `if not res["failing"]` can never fire and the loop always burns every
    iteration and returns `needs_human`, however good the implementation is.

    The rule that keeps both properties is the *transition*, not the status:
    a test may stay skipped if it was skipped at baseline; the moment it goes
    passed -> skipped (silenced during the run) it is a failure again. A
    baseline-skipped test that now FAILS also counts, since `st != "skipped"`.

    Keys in both dicts are the layer-prefixed ids (`rust::commands::tests::foo`),
    so this is layer-agnostic: a vitest `skipped` behaves identically.
    """
    now = dict(res["tests"])
    return [
        f for f in res["failing"]
        if not (base_status.get(f) == "skipped" and now.get(f) == "skipped")
    ]


def write_failures(path, res, notes, tail_lines=60, cap=8000):
    parts = [f"## NOTE\n{n}" for n in notes]
    for name, info in res["per_layer"].items():
        if not info["failing"]:
            continue
        parts.append(f"## Layer {name} (exit code {info['rc']})\nFailing:\n"
                     + "\n".join(f"- {f}" for f in info["failing"][:50]))
        tail = "\n".join(Path(info["log"]).read_text().splitlines()[-tail_lines:])
        parts.append(f"```\n{tail}\n```")
    path.write_text(("\n\n".join(parts))[:cap] or "No failures recorded.")


def spec_ids(path):
    return set(re.findall(r"\bS-(\d{3})\b", path.read_text())) if path.exists() else set()


def covered_ids(tests):
    return {m for tid, _ in tests for m in SPEC_ID.findall(tid)}


# ---------- goose ----------

def run_goose(recipe, i, escalated, failures_file, models, timeout_s):
    env = dict(os.environ)
    model = models.get("strong") if escalated else models.get("default")
    if model:
        env["GOOSE_MODEL"] = model
    cmd = ["goose", "run", "--recipe", recipe, "--no-session",
           "--params", f"iteration={i}",
           "--params", f"escalated={'true' if escalated else 'false'}",
           "--params", f"failures_file={failures_file}"]
    try:
        with open(OUT / f"goose-iter{i}.log", "w") as fh:
            return subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT, env=env, timeout=timeout_s).returncode
    except subprocess.TimeoutExpired:
        return 124


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=".workflow/config.yaml")
    ap.add_argument("--recipe", default=".workflow/recipes/plan-and-code.yaml")
    # Validate the harness (config, setup, test layers, protected paths, SPEC/test
    # coverage, baseline is red-for-the-right-reason) without invoking goose at all.
    # Costs no tokens, so a broken toolchain shows up as a harness error instead of
    # an agent failure.
    ap.add_argument("--baseline-only", action="store_true",
                    help="run setup + baseline checks, then stop before any goose call")
    args = ap.parse_args()

    OUT.mkdir(exist_ok=True)
    cfg = yaml.safe_load(Path(args.config).read_text())
    lim = {"max_iterations": 8, "goose_timeout_min": 45, "test_timeout_min": 15,
           "escalate_after": 2, "strong_attempts": 2, **(cfg.get("limits") or {})}
    models = cfg.get("models") or {}
    patterns = [glob_to_regex(g) for g in cfg["protected_paths"]]
    test_to, goose_to = lim["test_timeout_min"] * 60, lim["goose_timeout_min"] * 60

    exclude = Path(".git/info/exclude")
    if ".workflow-out/" not in (exclude.read_text() if exclude.exists() else ""):
        with exclude.open("a") as fh:
            fh.write("\n.workflow-out/\n")

    start_sha = git("rev-parse", "HEAD").strip()
    if git("status", "--porcelain").strip():
        finish("error", "working tree not clean at start", 1)

    # Announce what the sub-file lock actually covers. A file that matches a
    # `test_regions` glob but has no marker (e.g. `#[cfg(test)] mod tests` written
    # inline rather than starting its own line) would otherwise be silently
    # unprotected — and silent protection is the same as none.
    region_spec = cfg.get("test_regions") or []
    if region_spec:
        pairs = list(region_pairs(start_sha, region_spec))
        locked = {f for f, m in pairs if region_digest(git("show", f"{start_sha}:{f}"), m) is not None}
        matched = {f for f, _ in pairs}
        log(f"test regions locked: {len(locked)}/{len(matched)} matching file(s)")
        # A file with no test code at all has nothing to protect, so the marker
        # being absent is not a problem there — only warn when test code exists
        # without a marker, which is the case that is silently unprotected.
        for f in sorted(matched - locked):
            if re.search(r"^\s*#\[test\]", git("show", f"{start_sha}:{f}"), re.M):
                log(f"  WARNING: {f} has #[test] but no marker -> its tests are NOT protected")

    if cfg.get("setup"):
        log("running setup")
        with open(OUT / "setup.log", "w") as fh:
            if subprocess.run(cfg["setup"], shell=True, stdout=fh, stderr=subprocess.STDOUT).returncode != 0:
                finish("error", "setup command failed (see .workflow-out/setup.log)", 1)

    # Baseline: tests must be red for the right reason, and every SPEC.md sentence must have a test.
    base = run_layers(cfg, test_to)
    base_status = dict(base["tests"])
    base["failing"] = failing_excluding_baseline_skips(base, base_status)
    broken = [f for f in base["failing"] if f.endswith(SYNTHETIC)]
    if broken:
        finish("error", f"baseline tests are broken (errors, not assertion failures): {broken}", 1)
    missing_spec = spec_ids(Path("SPEC.md")) - covered_ids(base["tests"])
    if missing_spec:
        finish("error", f"SPEC.md sentences with no test: {sorted(missing_spec)}", 1)
    if not base["failing"]:
        finish("green", "all tests already pass at baseline, nothing to build", 0, iterations=0)
    base_ids = {t for t, _ in base["tests"]}
    log(f"baseline: {len(base_ids)} tests, {len(base['failing'])} failing")

    if args.baseline_only:
        finish("ok", f"baseline is usable: {len(base_ids)} tests, "
                     f"{len(base['failing'])} failing for the right reason", 0,
               baseline_tests=len(base_ids), baseline_failing=sorted(base["failing"]))

    failures_file = OUT / "last_failures.md"
    write_failures(failures_file, base, ["Initial state. Every failure below is expected: make them pass."])

    prev_sig, same, violations, goose_fails = None, 0, 0, 0
    for i in range(1, lim["max_iterations"] + 1):
        escalated = same >= lim["escalate_after"]
        log(f"iteration {i}/{lim['max_iterations']}" + (" [ESCALATED to strong model]" if escalated else ""))
        notes = []

        rc = run_goose(args.recipe, i, escalated, failures_file, models, goose_to)
        if rc != 0:
            goose_fails += 1
            notes.append(f"goose exited with code {rc} on the previous iteration.")
            if goose_fails >= 3:
                finish("error", "goose failed 3 iterations in a row (see goose-iter*.log)", 1, iterations=i)
        else:
            goose_fails = 0

        objection = OUT / "test-objection.md"
        if objection.exists():
            finish("needs_human", "agent objected to the tests: " + objection.read_text()[:500], 2, iterations=i)

        bad = protected_violations(start_sha, patterns)
        if bad:
            violations += 1
            restore(start_sha, bad)
            notes.append(f"You modified protected files and they were reverted: {bad}. Do not touch them.")
            log(f"protected-path violation #{violations}: {bad}")
            if violations >= 2:
                commit(f"wip: iteration {i} (aborted, tampering)")
                finish("tampering", f"protected files modified twice: {bad}", 3, iterations=i)

        region_bad = region_violations(start_sha, cfg.get("test_regions"))
        if region_bad:
            violations += 1
            restore_regions(start_sha, region_bad)
            touched = sorted({f for f, _ in region_bad})
            notes.append(
                f"You changed the test blocks inside {touched} and they were reverted. "
                "Implement the behaviour; do not edit, weaken or delete tests."
            )
            log(f"test-region violation #{violations}: {touched}")
            if violations >= 2:
                commit(f"wip: iteration {i} (aborted, test tampering)")
                finish("tampering", f"test regions modified twice: {touched}", 3, iterations=i)

        res = run_layers(cfg, test_to)
        res["failing"] = failing_excluding_baseline_skips(res, base_status)
        gone = sorted(base_ids - {t for t, _ in res["tests"]})
        if gone:
            res["failing"] += [f"MISSING::{t}" for t in gone]
            notes.append(f"{len(gone)} baseline tests no longer run (deleted or filtered). Example: {gone[0]}")

        commit(f"wip: iteration {i}, {len(res['failing'])} failing")

        if not res["failing"]:
            finish("green", "all tests pass", 0, iterations=i)

        sig = hashlib.sha1("\n".join(sorted(res["failing"])).encode()).hexdigest()
        same = same + 1 if sig == prev_sig else 1
        prev_sig = sig
        log(f"{len(res['failing'])} failing, same failing set for {same} iteration(s)")
        if same >= lim["escalate_after"] + lim["strong_attempts"]:
            finish("needs_human", f"stuck on the same {len(res['failing'])} failures", 2,
                   iterations=i, failing=res["failing"][:50])
        write_failures(failures_file, res, notes)

    finish("needs_human", "max iterations reached", 2, iterations=lim["max_iterations"])


if __name__ == "__main__":
    main()
