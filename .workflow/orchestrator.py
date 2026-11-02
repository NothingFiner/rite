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


# ---------- progress / token accounting ----------

# goose records per-request usage in its session database. In the container HOME
# is /cache/home and /cache is bind-mounted from the host, so the ledger
# survives the run and can be read after it too.
GOOSE_DB = Path(os.environ.get("HOME", "~")) / ".local/share/goose/sessions/sessions.db"


def goose_tokens_used():
    """Total tokens goose has recorded, or None when the ledger is unavailable.

    Returns None (never raises) so a goose build without a usage table degrades
    to "tokens: n/a" instead of breaking the run.
    """
    try:
        import sqlite3

        con = sqlite3.connect(f"file:{GOOSE_DB}?mode=ro", uri=True, timeout=2)
        try:
            row = con.execute("select coalesce(sum(total_tokens), 0) from usage_ledger").fetchone()
            return int(row[0]) if row else 0
        finally:
            con.close()
    except Exception:
        return None


def fmt_tokens(n):
    if n is None:
        return "n/a"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.2f}M"
    if n >= 1_000:
        return f"{n / 1_000:.0f}k"
    return str(n)


def progress(i, res, prev_failing, started, tokens_before, tokens_total):
    """One line per iteration: pass/fail counts, delta, wall clock, tokens."""
    total = len(res["tests"])
    failing = len(res["failing"])
    passed = total - failing
    delta = prev_failing - failing
    duration = time.time() - started
    now = goose_tokens_used()
    spent = (now - tokens_before) if (now is not None and tokens_before is not None) else None
    total_now = now if now is not None else tokens_total

    log(
        f"progress: {passed}/{total} passing, {failing} failing "
        f"({delta:+d} vs previous) | {duration / 60:.1f} min | "
        f"{fmt_tokens(spent)} tokens this iteration | {fmt_tokens(total_now)} total"
    )
    try:
        OUT.mkdir(exist_ok=True)
        with (OUT / "progress.jsonl").open("a") as fh:
            fh.write(json.dumps({
                "iteration": i, "total": total, "passing": passed, "failing": failing,
                "delta": delta, "seconds": round(duration, 1),
                "tokens_iteration": spent, "tokens_total": total_now,
            }) + "\n")
    except OSError:
        pass
    return total_now


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


# ---------- pull-request description ----------

# Files that are noise in a review diff: regenerated, or huge, or not the change.
DESCRIBE_SKIP = [":(exclude)package-lock.json", ":(exclude)Cargo.lock", ":(exclude).workflow-out"]
# A description shorter than this is a failed description, not a terse one.
DESCRIBE_MIN_CHARS = 200


def layer_counts(res):
    """{layer: (total, not_green)} from the parsed test ids."""
    total, bad = {}, {}
    for tid, st in res["tests"]:
        layer = tid.split("::", 1)[0]
        total[layer] = total.get(layer, 0) + 1
        if st != "passed":
            bad[layer] = bad.get(layer, 0) + 1
    return {k: (total[k], bad.get(k, 0)) for k in total}


def test_summary_line(res):
    counts = layer_counts(res)
    if not counts:
        return "no tests were reported"
    bits = []
    for layer, (total, bad) in counts.items():
        bits.append(f"{layer} {total - bad}/{total} passed" if bad else f"{layer} {total} passed")
    worst = sum(b for _, b in counts.values())
    return "; ".join(bits) + (f" ({worst} not passing)" if worst else "")


def spec_sentences():
    """The S-ID lines from SPEC.md, for the collapsible appendix."""
    try:
        text = Path("SPEC.md").read_text()
    except OSError:
        return ""
    return "\n".join(ln.strip() for ln in text.splitlines() if SPEC_ID.match(ln.lstrip("* -")))


def diff_for_review(base_branch, cap_kb):
    """Write .workflow-out/diff-for-review.md. Returns the diffstat text.

    The diffstat is always complete; only the patch is capped. An agent that needs a
    hunk the cap dropped is told to read the file, which is why the diffstat has to
    survive truncation.
    """
    # The run clones a single branch, so origin/<base> is often absent inside the
    # container; the host fetches the base in as a local ref for that reason. Try
    # both and say so loudly if neither resolves, rather than diffing against nothing.
    mb = ""
    for ref in (f"origin/{base_branch}", base_branch):
        mb = git("merge-base", ref, "HEAD", check=False).strip()
        if mb:
            break
    if not mb:
        raise RuntimeError(f"no merge base with {base_branch} (tried origin/{base_branch} and "
                           f"{base_branch}); was the base branch fetched into this clone?")
    stat = git("diff", "--stat", mb, "HEAD", "--", ".", *DESCRIBE_SKIP).strip()
    patch = git("diff", "--unified=3", mb, "HEAD", "--", ".", *DESCRIBE_SKIP)
    cap = max(1, int(cap_kb)) * 1024
    cut = len(patch) > cap
    parts = ["# Diff for review", "", "## Diffstat", "", "```", stat, "```", "", "## Patch", ""]
    if cut:
        parts += [
            f"Patch truncated: showing {cap_kb} KB of {len(patch) / 1024:.0f} KB. Every changed file is "
            "listed in the diffstat above; read the repository for hunks you cannot see here.", "",
        ]
    parts += ["```diff", patch[:cap] + ("\n... [truncated]" if cut else ""), "```", ""]
    (OUT / "diff-for-review.md").write_text("\n".join(parts))
    return stat


def description_footer(res, stat):
    """Facts the orchestrator owns, appended after the agent's prose.

    Kept separate on purpose: the agent writes the explanation, but the test counts
    and the diffstat are measured, not narrated, so they cannot be embellished.
    """
    out = ["", "---", "", f"**Tests:** {test_summary_line(res)}", ""]
    if stat:
        out += ["<details><summary>Changed files</summary>", "", "```", stat, "```", "", "</details>", ""]
    spec = spec_sentences()
    if spec:
        out += ["<details><summary>Approved spec (S-IDs)</summary>", "", spec, "", "</details>", ""]
    return "\n".join(out)


def fallback_description(reason, res, stat):
    """A body that is never wrong, used when the reviewer agent cannot write one."""
    lines = [
        "## Summary", "",
        "This branch makes the test suite pass. An automated description was not produced "
        f"({reason}), so this is the measured summary instead.",
        "", "## What changed", "",
    ]
    if stat:
        lines += ["```", stat, "```", ""]
    lines += ["## Tests", ""]
    lines += [f"- {layer}: {total - bad}/{total} passed"
              for layer, (total, bad) in layer_counts(res).items()]
    lines += ["", "Review the diff directly; the sections above are absent because the "
                  "reviewer agent did not run."]
    return "\n".join(lines)


def untracked_snapshot():
    out = git("ls-files", "--others", "--exclude-standard", check=False)
    return {ln for ln in out.splitlines() if ln}


def run_describe(cfg, models, res, timeout_s):
    """Ask a fresh agent to explain the finished diff. Returns the body path or None.

    Runs once, after the final green commit, in its own process: the builder never sees
    the finished state (it works per iteration, mid-flight), so asking it to describe
    the result would produce a description of its intent rather than of the code.
    """
    block = cfg.get("pr_description") or {}
    if not block.get("enabled", True):
        log("pr description: disabled by config")
        return None
    recipe = block.get("recipe", ".workflow/recipes/describe-changes.yaml")
    out_file, title_file = OUT / "pr-description.md", OUT / "pr-title.txt"
    for f in (out_file, title_file):
        if f.exists():
            f.unlink()

    try:
        stat = diff_for_review(cfg.get("base_branch", "development"), block.get("max_patch_kb", 120))
    except (RuntimeError, OSError) as e:
        stat = ""
        log(f"pr description: no diff available ({e})")

    if not Path(recipe).exists():
        log(f"pr description: {recipe} missing, using the fallback body")
        out_file.write_text(fallback_description(f"{recipe} not found", res, stat))
        return out_file

    env = dict(os.environ)
    model = block.get("model") or models.get("default")
    if model:
        env["GOOSE_MODEL"] = model
    params = []
    for k, v in (("diff_file", OUT / "diff-for-review.md"), ("spec_file", "SPEC.md"),
                 ("output_file", out_file), ("title_file", title_file),
                 ("base_branch", cfg.get("base_branch", "development")),
                 ("test_summary", test_summary_line(res))):
        params += ["--params", f"{k}={v}"]
    cmd = ["goose", "run", "--recipe", recipe, "--no-session", *params]

    # Snapshot before the agent runs so the revert below can tell "it made this" from
    # "this was already here". Reverting everything untracked would delete files that
    # have nothing to do with the agent.
    before_untracked = untracked_snapshot()
    started = time.time()
    log("pr description: reviewer agent is describing the change")
    try:
        with open(OUT / "goose-describe.log", "w") as fh:
            rc = subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT,
                                env=env, timeout=timeout_s).returncode
    except subprocess.TimeoutExpired:
        rc = 124
    except OSError as e:
        # goose missing or not executable. Degrade: a description is a nicety, not a gate.
        log(f"pr description: cannot run goose ({e})")
        rc = 127

    # The description step must not change the code. The tree is clean here (the final
    # iteration was just committed), so anything git reports is its doing.
    dirty = git("status", "--porcelain", "--", ".", check=False).strip()
    if dirty:
        touched = [ln[3:] for ln in dirty.splitlines()]
        log(f"pr description: reviewer agent modified the tree, reverting: {touched[:5]}")
        git("checkout", "--", ".", check=False)
        for path in untracked_snapshot() - before_untracked:
            try:
                Path(path).unlink()
            except OSError:
                pass

    body = out_file.read_text() if out_file.exists() else ""
    if rc != 0 or len(body.strip()) < DESCRIBE_MIN_CHARS or "## " not in body:
        why = f"goose exited {rc}, produced {len(body.strip())} characters"
        log(f"pr description: unusable ({why}), using the fallback body")
        out_file.write_text(fallback_description(why, res, stat))
        return out_file

    out_file.write_text(body.rstrip() + "\n" + description_footer(res, stat))
    log(f"pr description: {len(body)} characters in {time.time() - started:.0f}s -> {out_file}")

    # Title: one line, sane length, and not the placeholder the git log would give.
    raw = title_file.read_text().strip() if title_file.exists() else ""
    title = raw.splitlines()[0].strip().strip('"').rstrip(".") if raw else ""
    if 10 <= len(title) <= 90 and "wip" not in title.lower():
        title_file.write_text(title + "\n")
        log(f"pr description: title -> {title}")
    else:
        if title_file.exists():
            title_file.unlink()
        log(f"pr description: no usable title ({title!r}), leaving the PR title unchanged")
    return out_file


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
    ap.add_argument("--resume", action="store_true",
                    help="continue in a work tree that already holds implementation work: "
                         "previously-passing tests may not regress, but the suite is no longer "
                         "required to be red")
    ap.add_argument("--no-describe", action="store_true",
                    help="skip the pull-request description step (saves one goose call on success)")
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
        if args.resume:
            # A resume exists precisely to keep uncommitted work from a failed
            # run. Fold it into the start commit instead of refusing to run.
            log("resume: committing the work tree as the starting point")
            commit("wip: resume checkpoint")
            start_sha = git("rev-parse", "HEAD").strip()
        else:
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

    # Resume: the point is to keep work from a failed run, where the implementation
    # already exists and only the (human-fixed) tests changed. So instead of
    # demanding a red suite, demand that nothing that used to pass has broken.
    prev_baseline = None
    baseline_file = OUT / "baseline.json"
    if args.resume:
        try:
            prev_baseline = json.loads(baseline_file.read_text())
        except (OSError, json.JSONDecodeError):
            prev_baseline = None
        if prev_baseline is None:
            log("resume: no baseline.json from the previous run — falling back to the normal gate")
    if prev_baseline:
        before = prev_baseline.get("tests", {})
        regressions = sorted(
            t for t, st in base["tests"] if st != "passed" and before.get(t) == "passed"
        )
        if regressions:
            finish("error", f"resume regressed tests that previously passed: {regressions[:5]}", 1)
        log(f"resume: {len(prev_baseline.get('failing', []))} failed before, "
            f"{len(base['failing'])} fail now")

    missing_spec = spec_ids(Path("SPEC.md")) - covered_ids(base["tests"])
    if missing_spec:
        finish("error", f"SPEC.md sentences with no test: {sorted(missing_spec)}", 1)
    if not base["failing"]:
        finish("green", "all tests already pass at baseline, nothing to build", 0, iterations=0)
    base_ids = {t for t, _ in base["tests"]}
    log(f"baseline: {len(base_ids)} tests, {len(base['failing'])} failing")
    # Saved so a later --resume can tell "was failing" from "regressed".
    try:
        baseline_file.write_text(json.dumps(
            {"tests": base_status, "failing": sorted(base["failing"])}, indent=2))
    except OSError:
        pass
    tokens_total = goose_tokens_used()
    if tokens_total is not None:
        log(f"tokens so far this session: {fmt_tokens(tokens_total)}")

    if args.baseline_only:
        finish("ok", f"baseline is usable: {len(base_ids)} tests, "
                     f"{len(base['failing'])} failing for the right reason", 0,
               baseline_tests=len(base_ids), baseline_failing=sorted(base["failing"]))

    failures_file = OUT / "last_failures.md"
    write_failures(failures_file, base, ["Initial state. Every failure below is expected: make them pass."])

    prev_sig, same, violations, goose_fails = None, 0, 0, 0
    prev_failing = len(base["failing"])
    for i in range(1, lim["max_iterations"] + 1):
        escalated = same >= lim["escalate_after"]
        log(f"iteration {i}/{lim['max_iterations']}" + (" [ESCALATED to strong model]" if escalated else ""))
        notes = []
        iteration_started = time.time()
        tokens_before = goose_tokens_used()

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

        tokens_total = progress(i, res, prev_failing, iteration_started, tokens_before, tokens_total)
        prev_failing = len(res["failing"])

        if not res["failing"]:
            # Last step, once: describe the finished change for the reviewer. It is not
            # part of the loop, and a failure here must not fail the run — the branch is
            # already green and the host can still open the PR without a description.
            body = None
            if not args.no_describe:
                try:
                    body = run_describe(cfg, models, res, goose_to)
                except Exception as e:  # noqa: BLE001 - a description bug must not fail a green run
                    log(f"pr description: unexpected {type(e).__name__}: {e}")
            if body is None and not args.no_describe:
                log("pr description: unavailable; the host will leave the PR body alone")
            finish("green", "all tests pass", 0, iterations=i,
                   pr_description=str(body) if body else None)

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
