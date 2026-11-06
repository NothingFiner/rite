#!/usr/bin/env python3
"""Headless build loop. goose writes the code; this script is the judge.

Runs inside the container with the repo checked out on the feature branch (cwd = repo root).
It has no GitHub credentials and never pushes. On success it exits 0 and the host script
(run-headless.sh) pushes the branch and marks the PR ready.

Exit codes: 0 green | 1 setup/config error | 2 needs a human | 3 protected-path tampering

Per iteration:
  1. brief the planner on ONE layer's most cohesive failures (scoping.py) — the
     planner's focus only; every layer still runs and every test still has to pass
  2. goose plans and codes (plan-and-code.yaml + coder sub-recipes)
  3. revert any edits to protected paths (second offence aborts)
  4. revert any edits to `test_regions` inside otherwise-editable files (second offence aborts)
  5. run every test layer, parse results
  6. fail if any baseline test disappeared, was skipped, or became skipped
  7. commit the work, then decide: green / continue / escalate model / give up
"""
import argparse
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import yaml

# `.workflow/` is sys.path[0] when this file runs as a script, but not when it is
# imported, so make the sibling import explicit rather than order-dependent.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import scoping  # noqa: E402 - sibling module, path set up on the line above

OUT = Path(".workflow-out")
GIT_ID = ["-c", "user.name=goose-bot", "-c", "user.email=goose-bot@localhost"]
SYNTHETIC = ("__BUILD_OR_RUN_ERROR__", "__NO_TESTS_RAN__")
SPEC_ID = re.compile(r"(?<![A-Za-z0-9])[Ss][-_ ]?(\d{3})(?!\d)")

# The platform the app ships for (`target_platform:` in config.yaml), and whether
# a green verdict elsewhere is allowed anyway. Set from the config in `main`.
TARGET_PLATFORM = None
ALLOW_OFFPLATFORM_GREEN = False


def platform_state():
    """Which platform this run is actually measuring.

    `platform.system()` says "Darwin" and "Linux"; config.yaml says "macos" and
    "linux" (what a person would write, and what `target_platform` uses). The two
    vocabularies are mapped here once, so the gate compares like with like —
    otherwise a macOS run rejects itself, which is exactly what it did the first
    time this was tried.
    """
    system = platform.system().lower()
    return {
        "system": "macos" if system == "darwin" else system,
        "machine": platform.machine(),
    }


def log(msg):
    print(f"[orchestrator {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def plural(n, word):
    return word if n == 1 else word + "s"


def finish(status, reason, code, **extra):
    """Write the verdict and exit. The one place a run states what it proved."""
    OUT.mkdir(exist_ok=True)
    here = platform_state()
    # A green verdict is a claim about the shipping build. Measured anywhere else
    # it is not that claim: the whole `#[cfg(target_os = "macos")]` half of the
    # crate is not compiled, so it can neither pass nor fail. 5.15 shipped exactly
    # that — "0 failing" from a Linux container, and the macOS spell-check module
    # did not compile. Fail closed instead of quietly grading a build nobody ships.
    if (
        status == "green"
        and TARGET_PLATFORM
        and here["system"] != TARGET_PLATFORM
        and not ALLOW_OFFPLATFORM_GREEN
    ):
        reason = (
            f"tests pass on {here['system']}/{here['machine']}, but the app ships for "
            f"{TARGET_PLATFORM}: this build never compiled the {TARGET_PLATFORM}-only code, "
            f"so the suite cannot vouch for it. Re-run on {TARGET_PLATFORM} "
            f"(.workflow/run-headless.sh runs natively there by default), or set "
            f"allow_offplatform_green: true in config.yaml if all you wanted was a smoke test"
        )
        status, code = "wrong_platform", 6
    (OUT / "result.json").write_text(
        json.dumps({"status": status, "reason": reason, "platform": here, **extra}, indent=2)
    )
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


def progress(i, res, prev_failing, started, tokens_before, tokens_total, scope=None, cleared=None):
    """One line per iteration: pass/fail counts, delta, wall clock, tokens.

    The scope fields are the measurement that makes runs comparable to each other:
    minutes per failure *cleared* is the only rate that survives a feature being
    harder than the last one.
    """
    total = len(res["tests"])
    failing = len(res["failing"])
    passed = total - failing
    delta = prev_failing - failing
    duration = time.time() - started
    now = goose_tokens_used()
    spent = (now - tokens_before) if (now is not None and tokens_before is not None) else None
    total_now = now if now is not None else tokens_total
    scoped = f" | scope: {scope.layer} {len(scope.in_scope)}/{prev_failing}, cleared {cleared}" \
        if (scope is not None and scope.enabled) else ""

    log(
        f"progress: {passed}/{total} passing, {failing} failing "
        f"({delta:+d} vs previous) | {duration / 60:.1f} min | "
        f"{fmt_tokens(spent)} tokens this iteration | {fmt_tokens(total_now)} total{scoped}"
    )
    try:
        OUT.mkdir(exist_ok=True)
        with (OUT / "progress.jsonl").open("a") as fh:
            fh.write(json.dumps({
                "iteration": i, "total": total, "passing": passed, "failing": failing,
                "delta": delta, "seconds": round(duration, 1),
                "tokens_iteration": spent, "tokens_total": total_now,
                "scope_layer": scope.layer if scope is not None else None,
                "scope_in": len(scope.in_scope) if scope is not None else None,
                "scope_deferred": len(scope.deferred) if scope is not None else None,
                "scope_cleared": cleared,
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


# ---------- comment rules ----------

def comment_violations(start_sha):
    """Run the comment gate over everything this run added, since `start_sha`.

    Non-fatal on purpose. A wording nit must not turn a green build red, and the
    coder cannot fix it by making another test pass, so the violations become
    notes for the next iteration instead of a verdict. A checker that crashes
    reports nothing: the gate must never be the reason a run stops.
    """
    script = Path(__file__).with_name("comment_check.py")
    proc = subprocess.run(
        [sys.executable, str(script), "--base", start_sha, "--json"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        log(f"comment rules: check exited {proc.returncode}; skipped this iteration")
        return []
    try:
        payload = json.loads(proc.stdout or "{}")
    except ValueError:
        log("comment rules: unreadable output; skipped this iteration")
        return []
    if payload.get("error"):
        log(f"comment rules: {payload['error']}")
        return []
    return payload.get("violations") or []


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


def write_failures(path, res, notes, scope=None, tail_lines=60, cap=8000):
    """Write the planner's brief: the failures, plus what is out of scope this time.

    A scope is a *focus* instruction, not a filter. The deferred failures stay in the
    file under their own heading, because the run is still judged on the whole suite
    and a regression in a deferred layer has to be visible to whoever reads the
    iteration — while the planner is told, in the same file, not to work on them.
    """
    parts = [f"## NOTE\n{n}" for n in notes]
    if scope is not None:
        parts.append(scoping.scope_note(scope, len(res["failing"])))
    in_scope = set(scope.in_scope) if (scope is not None and scope.enabled) else None
    for name, info in res["per_layer"].items():
        shown = [f for f in info["failing"] if in_scope is None or f in in_scope]
        if not shown:
            continue
        parts.append(f"## Layer {name} (exit code {info['rc']})\nFailing:\n"
                     + "\n".join(f"- {f}" for f in shown[:50]))
        tail = "\n".join(Path(info["log"]).read_text().splitlines()[-tail_lines:])
        parts.append(f"```\n{tail}\n```")
    if scope is not None:
        deferred = scoping.deferred_note(scope)
        if deferred:
            parts.append(deferred)
    path.write_text(("\n\n".join(parts))[:cap] or "No failures recorded.")


def spec_ids(path):
    return set(re.findall(r"\bS-(\d{3})\b", path.read_text())) if path.exists() else set()


def covered_ids(tests):
    return {m for tid, _ in tests for m in SPEC_ID.findall(tid)}


# ---------- goose ----------

def run_goose(recipe, i, escalated, failures_file, models, timeout_s, attempt=""):
    env = dict(os.environ)
    model = models.get("strong") if escalated else models.get("default")
    if model:
        env["GOOSE_MODEL"] = model
    cmd = ["goose", "run", "--recipe", recipe, "--no-session",
           "--params", f"iteration={i}",
           "--params", f"escalated={'true' if escalated else 'false'}",
           "--params", f"failures_file={failures_file}"]
    try:
        with open(OUT / f"goose-iter{i}{attempt}.log", "w") as fh:
            return subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT, env=env, timeout=timeout_s).returncode
    except subprocess.TimeoutExpired:
        return 124


def goose_log_path(i, attempt=""):
    return OUT / f"goose-iter{i}{attempt}.log"


# ---------- style: ASD-STE100 (Simplified Technical English) ----------
#
# The PR description targets ~80% STE compliance, not 100%. STE is a controlled
# language with a 900-word dictionary; a description written by a coding agent will
# not satisfy the dictionary, and forcing it would produce stilted prose that hides
# the code change. The mechanical rules below are the ones that carry the style and
# that a script can count: sentence length, active voice, no contractions, no
# nominalisations, no filler.
#
# This measures the agent's prose only. The footer the orchestrator appends is facts
# and identifiers, which STE does not govern.

STE_FENCE = re.compile(r"```.*?```", re.S)
STE_HEADING = re.compile(r"^#{1,6}\s.*$", re.M)
STE_HTML = re.compile(r"<[^>]+>")
STE_WORD = re.compile(r"[A-Za-z][A-Za-z'\-]*")
STE_CONTRACTION = re.compile(
    r"\b(?:\w+n't|\w+'re|\w+'ve|\w+'ll|\w+'d|it's|that's|there's|let's)\b", re.I)
# "is/are/was/were/be/been + past participle". A proxy: the common participles this
# codebase actually writes, because a general detector needs a POS tagger.
STE_PASSIVE = re.compile(
    r"\b(?:is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?"
    r"(?:done|made|used|added|called|set|written|read|given|taken|kept|left|shown|"
    r"changed|built|created|stored|removed|run|sent|held|found|seen|known|put|"
    r"brought|chosen|drawn|lost|meant|paid|spent|told|thought|won|produced|exported|"
    r"imported|generated|required|allowed|expected|checked|validated|opened|closed|"
    r"loaded|saved|mounted|skipped|counted|parsed|emitted|appended|written|rejected|"
    r"accepted|reverted|committed|pushed|applied|wired|registered|rendered|tested)\b", re.I)
# "perform validation", "make a decision": STE prefers the verb itself.
STE_NOMINAL = re.compile(
    r"\b(?:perform|performs|performed|performing|make|makes|made|make|do|does|did|"
    r"doing|carry out|carries out|carried out|provide|provides|provided)\s+"
    r"(?:a|an|the)?\s*\w+(?:tion|sion|ment|ance|ence|ure)\b", re.I)
STE_BANNED = re.compile(
    r"\b(?:comprehensive|robust|seamless|seamlessly|powerful|elegant|delightful|"
    r"effortless|effortlessly|cutting-edge|state-of-the-art|world-class|"
    r"basically|simply|just|really|quite|obviously|clearly|actually|essentially|"
    r"utilize|utilizes|utilized|utilizing|leverage|leverages|leveraged|utilise|"
    r"ensure|ensures|ensured|ensuring|numerous|various|facilitate|facilitates)\b", re.I)


def ste_sentences(text):
    """Prose sentences only: no code, headings or HTML."""
    body = STE_FENCE.sub(" ", text)
    body = STE_HEADING.sub(" ", body)
    body = STE_HTML.sub(" ", body)
    # Technical names are exempt from STE: count an inline identifier as one word
    # rather than as the several English words its path happens to contain.
    body = re.sub(r"`[^`]*`", "CODE", body)
    body = body.replace("**", "").replace("__", "")
    out = []
    for raw in re.split(r"(?<=[.!?])\s+", body):
        s = raw.strip().lstrip("-*0123456789. ").strip()
        if len(STE_WORD.findall(s)) >= 4:  # too short to judge
            out.append(s)
    return out


def ste_report(text, target=0.8, max_words=25):
    """(compliance, sentences_checked, [flagged examples])."""
    sentences = ste_sentences(text)
    if not sentences:
        return 1.0, 0, []
    flagged = []
    for s in sentences:
        problems = []
        n = len(STE_WORD.findall(s))
        if n > max_words:
            problems.append(f"{n} words")
        if STE_CONTRACTION.search(s):
            problems.append("contraction")
        if STE_PASSIVE.search(s):
            problems.append("passive")
        if STE_NOMINAL.search(s):
            problems.append("nominalisation")
        hit = STE_BANNED.search(s)
        if hit:
            problems.append(f"'{hit.group(0)}'")
        if problems:
            flagged.append({"sentence": s[:110], "problems": problems})
    return (len(sentences) - len(flagged)) / len(sentences), len(sentences), flagged


def log_style(score, total, flagged, target):
    verdict = "meets" if score >= target else "below"
    log(f"style: {score * 100:.0f}% STE of {total} {plural(total, 'sentence')} "
        f"({verdict} the {target * 100:.0f}% target); {len(flagged)} flagged")
    for f in flagged[:3]:
        log(f"style: - {'; '.join(f['problems'])}: {f['sentence']}")


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


def _invoke_describe(recipe, params, env, timeout_s, log_name):
    """One goose call. Never raises for a missing binary; returns an exit code."""
    cmd = ["goose", "run", "--recipe", recipe, "--no-session", *params]
    try:
        with open(OUT / log_name, "w") as fh:
            return subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT,
                                  env=env, timeout=timeout_s).returncode
    except subprocess.TimeoutExpired:
        return 124
    except OSError as e:
        # goose missing or not executable. Degrade: a description is a nicety, not a gate.
        log(f"pr description: cannot run goose ({e})")
        return 127


def usable_body(path):
    body = path.read_text() if path.exists() else ""
    if len(body.strip()) < DESCRIBE_MIN_CHARS or "## " not in body:
        return None
    return body


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
    style = block.get("style") or {}
    target = float(style.get("target_compliance", 0.8))
    max_words = int(style.get("max_words_per_sentence", 25))
    retry = bool(style.get("retry_below_target", True))

    recipe = block.get("recipe", ".workflow/recipes/describe-changes.yaml")
    out_file, title_file = OUT / "pr-description.md", OUT / "pr-title.txt"

    def is_output(path):
        """True for this step's own artifacts, which are never the agent's edits."""
        norm = path.rstrip("/")
        return norm == str(OUT).rstrip("/") or norm.startswith(str(OUT).rstrip("/") + "/")

    def touched_paths():
        # porcelain v1 is exactly "XY PATH": two status columns and a space.
        return [p for p in (ln[3:] for ln in git("status", "--porcelain", "--", ".",
                                                 check=False).splitlines())
                if not is_output(p)]

    # Measured before the stale outputs are removed: whether the tree was dirty for
    # reasons that have nothing to do with this step. If it was, the revert below must
    # not run, because it could not tell the agent's edits from pre-existing ones.
    clean_before = not touched_paths()
    for f in (out_file, title_file):
        if f.exists():
            f.unlink()

    try:
        stat = diff_for_review(cfg.get("base_branch", "development"),
                               block.get("max_patch_kb", 120))
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

    common = [
        f"diff_file={OUT / 'diff-for-review.md'}",
        "spec_file=SPEC.md",
        f"output_file={out_file}",
        f"title_file={title_file}",
        f"base_branch={cfg.get('base_branch', 'development')}",
        f"test_summary={test_summary_line(res)}",
    ]

    def params(style_notes=""):
        out = []
        for kv in common:
            out += ["--params", kv]
        if style_notes:
            # One argument per line would need quoting; the recipe treats " | " as a
            # separator, which keeps the notes on a single --params value.
            out += ["--params", "style_notes=" + style_notes.replace("\n", " | ")]
        return out

    # Snapshot before the agent runs so the revert below can tell "it made this" from
    # "this was already here". Reverting everything untracked would delete files that
    # have nothing to do with the agent.
    before_untracked = untracked_snapshot()
    started = time.time()
    log("pr description: reviewer agent is describing the change")
    rc = _invoke_describe(recipe, params(), env, timeout_s, "goose-describe.log")
    body = usable_body(out_file)

    score = total = 0
    flagged = []
    if body is not None:
        score, total, flagged = ste_report(body, target, max_words)
        log_style(score, total, flagged, target)

    # One rewrite only, and only when the draft missed the target. Bounded on purpose:
    # style is a polish pass, and a second description costs a full call.
    if body is not None and retry and score < target and flagged:
        notes = "; ".join(f"{'/'.join(f['problems'])}: {f['sentence']}" for f in flagged[:8])
        log(f"style: below target, asking for one rewrite "
            f"({len(flagged)} {plural(len(flagged), 'sentence')} flagged)")
        rc2 = _invoke_describe(recipe, params(notes), env, timeout_s, "goose-describe-2.log")
        rewritten = usable_body(out_file)
        if rc2 == 0 and rewritten is not None:
            s2, t2, f2 = ste_report(rewritten, target, max_words)
            log_style(s2, t2, f2, target)
            # Only take the rewrite if it is actually better; a rewrite can lose detail.
            if s2 > score:
                body, score, total, flagged = rewritten, s2, t2, f2
                log(f"style: rewrite accepted ({score * 100:.0f}%)")
            else:
                log(f"style: kept the first draft ({score * 100:.0f}% beats "
                    f"{s2 * 100:.0f}%)")

    # The description step must not change the code. Only enforceable when the tree was
    # clean before it ran — otherwise its edits cannot be told apart from pre-existing
    # ones, and the honest move is to leave everything alone.
    touched = touched_paths()
    if not clean_before:
        if touched:
            log(f"pr description: tree was already dirty before the agent ran, so these are "
                f"not attributed to it and were left alone: {touched[:5]}")
    elif touched:
        log(f"pr description: reviewer agent modified the tree, reverting: {touched[:5]}")
        git("checkout", "--", ".", check=False)
        for path in untracked_snapshot() - before_untracked:
            if is_output(path):
                continue
            try:
                Path(path).unlink()
            except OSError:
                pass

    if body is None:
        why = f"goose exited {rc}, produced {len(out_file.read_text().strip()) if out_file.exists() else 0} characters"
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

# ---------- goose failures ----------

# A non-zero goose exit does not say WHY. Retrying a broken toolchain three
# times, escalating to a stronger model that cannot help, and then reporting
# "goose failed 3 iterations in a row" blames the agent for an operator error.
# These patterns are failures the agent cannot fix, so the first one stops the
# run with a message that names the fix.
GOOSE_FATAL = [
    ("env", r"No provider configured",
     "no provider is configured inside the container. The container starts with "
     "an empty HOME, so it cannot read ~/.config/goose/ config. Export "
     "GOOSE_PROVIDER and the provider's API key in the shell that runs "
     ".workflow/run-headless.sh, then run it again"),
    ("env", r"(?i)invalid api key|incorrect api key|401 unauthorized|\bunauthorized\b",
     "the provider rejected the API key"),
    ("env", r"(?i)failed to load recipe|recipe .{0,80}not found|no recipe",
     "the recipe could not be loaded"),
    ("env", r"(?i)command not found|: goose: not found",
     "the goose binary is not on PATH inside the image"),
    ("model", r"(?i)model .{0,60}(not found|not available|does not exist)|unknown model",
     "the model id in .workflow/config.yaml is not available to the provider"),
]


def goose_failure_reason(log_path, rc):
    """Classify a failed goose run as ("env"|"model", reason), or (None, None).

    "env": the toolchain cannot run at all (no provider, bad key, missing recipe
    or binary). "model": a model id the account cannot serve — which is worth
    distinguishing, because the DEFAULT model being missing is fatal while the
    STRONG one being missing only means escalation is unavailable.

    Returns (None, None) for rc == 0 and for failures worth retrying (a timeout,
    a crash mid-run), so the caller keeps its retry budget for those.
    """
    if rc == 0 or rc == 124:          # 124 is our own timeout marker
        return None, None
    try:
        text = Path(log_path).read_text()[-8000:]
    except OSError:
        return None, None
    for kind, pattern, reason in GOOSE_FATAL:
        if re.search(pattern, text):
            return kind, reason
    return None, None


def goose_log_tail(log_path, n=3):
    """The last non-blank lines of a goose log, so the operator sees the error
    on the console instead of having to open the file."""
    try:
        lines = [l.strip() for l in Path(log_path).read_text().splitlines() if l.strip()]
    except OSError:
        return ""
    return " | ".join(lines[-n:])


# ---------- main ----------

def log_scope(iteration, scope, total):
    """One line saying what the planner is about to be asked to do, and why."""
    if not scope.enabled:
        log(f"iteration {iteration} scope: all {total} failures — {scope.reason}")
        return
    log(f"iteration {iteration} scope: {scope.layer} only, "
        f"{len(scope.in_scope)} of {total} failures, {len(scope.deferred)} deferred "
        f"— {scope.reason}")


def scope_limit_from(value):
    """Validate `limits.failures_in_scope`. A bad value must never end a run.

    0 disables scoping and is the supported way to get the pre-scoping behaviour
    back. A typo is not a request to disable it, so it falls back to the default
    rather than being read as 0 — silence here would quietly change how every
    iteration is briefed.
    """
    try:
        limit = int(value)
    except (TypeError, ValueError):
        log(f"failures_in_scope={value!r} is not an integer; using 3")
        return 3
    if limit < 0:
        log(f"failures_in_scope={limit} is negative; using 3 (set 0 to disable)")
        return 3
    return limit


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
    # A previous run's verdict must not outlive it. If this process dies before
    # writing one (a traceback, an OOM, a killed container), the launcher prints
    # result.json — and a stale file makes it announce the PREVIOUS run's reason.
    # "goose failed 3 iterations in a row" for a run that never reached goose is
    # exactly that mistake, so clear it up front and let the absence speak.
    # progress.jsonl goes too: it is a per-run record, and leftover iterations
    # would be read as this run's history.
    for stale in ("result.json", "progress.jsonl"):
        try:
            (OUT / stale).unlink()
        except OSError:
            pass
    cfg = yaml.safe_load(Path(args.config).read_text())
    global TARGET_PLATFORM, ALLOW_OFFPLATFORM_GREEN
    TARGET_PLATFORM = (cfg.get("target_platform") or "").strip().lower() or None
    ALLOW_OFFPLATFORM_GREEN = bool(cfg.get("allow_offplatform_green", False))
    lim = {"max_iterations": 8, "goose_timeout_min": 45, "test_timeout_min": 15,
           "escalate_after": 2, "strong_attempts": 2, **(cfg.get("limits") or {})}
    models = cfg.get("models") or {}
    # What the planner is asked to fix per iteration. The verdict is unaffected: every
    # layer still runs and every test still has to pass for green.
    scope_limit = scope_limit_from(lim.get("failures_in_scope", 3))
    layer_order = [layer["name"] for layer in cfg["test_layers"]]
    scope_depends_on = cfg.get("scope_depends_on") or {"e2e": ["unit", "rust"]}
    if scope_limit:
        log(f"iteration scoping: one layer, at most {plural(scope_limit, 'failure')} "
            f"per iteration (limits.failures_in_scope)")
    else:
        log("iteration scoping: off (limits.failures_in_scope = 0) — "
            "the planner sees every failure, as before")
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
    # Scoping state lives for the whole run: which layer was skipped how often, how
    # many tests have been tried, and whether the last iteration cleared anything.
    scope_state = {}
    scope = scoping.select_scope(base["failing"], scope_limit, layer_order,
                                 scope_depends_on, scope_state)
    log_scope(1, scope, len(base["failing"]))
    write_failures(failures_file, base,
                   ["Initial state. Every failure below is expected: make them pass."], scope)

    prev_sig, same, violations, goose_fails = None, 0, 0, 0
    prev_failing = len(base["failing"])
    # The ids, not just the count, so scoping can tell which in-scope tests cleared.
    prev_failing_ids = list(base["failing"])
    # Sibling of `same`: how many iterations in a row produced no reduction at all.
    # Scoping narrows the work, so the failing *set* legitimately changes every
    # iteration — the sha1 signature below then never repeats and stuck-detection
    # would go quiet exactly when it is needed. This counter is what keeps the
    # strong-model escalation reachable once the set starts churning.
    no_gain = 0
    # Whether the previous iteration's goose run actually completed. A run that
    # never started must not count towards escalation: an unchanged failing set
    # after a no-op is not evidence that the model needs a stronger one.
    goose_ok = True
    # Escalation is a bonus, never a requirement. An empty `models.strong` turns it
    # off, and a strong model the account cannot serve turns it off the first time
    # it is tried (see the model-fallback branch below) instead of ending the run.
    strong_ok = bool(models.get("strong"))
    if not strong_ok:
        log("no strong model configured: this run will not escalate")
    for i in range(1, lim["max_iterations"] + 1):
        escalated = goose_ok and strong_ok and (
            same >= lim["escalate_after"] or no_gain >= lim["escalate_after"])
        log(f"iteration {i}/{lim['max_iterations']}" + (" [ESCALATED to strong model]" if escalated else ""))
        notes = []
        iteration_started = time.time()
        tokens_before = goose_tokens_used()

        log_path = goose_log_path(i)
        rc = run_goose(args.recipe, i, escalated, failures_file, models, goose_to)
        kind, fatal = goose_failure_reason(log_path, rc)
        if kind == "model" and escalated:
            # The strong model can be missing from the account (a plan change, a
            # weekly limit). That is not a reason to stop: the default model still
            # works, so repeat this iteration on it and never escalate again.
            log(f"escalation unavailable: {fatal}")
            log(f"staying on the default model ({models.get('default')}); "
                f"set models.strong in .workflow/config.yaml to a model the account has")
            strong_ok = False
            escalated = False
            log_path = goose_log_path(i, "-fallback")
            rc = run_goose(args.recipe, i, escalated, failures_file, models, goose_to,
                           attempt="-fallback")
        goose_ok = rc == 0
        if rc != 0:
            goose_fails += 1
            kind, fatal = goose_failure_reason(log_path, rc)
            tail = goose_log_tail(log_path)
            log(f"goose exited {rc}" + (f": {fatal}" if fatal else (f": {tail}" if tail else "")))
            if fatal:
                # Nothing is wrong with the tests or the work tree. Stop now:
                # another iteration would repeat the same failure and cost the
                # operator another model round trip to learn nothing.
                finish("error", f"goose cannot run: {fatal}", 1, iterations=i, goose_exit=rc)
            notes.append(f"goose exited with code {rc} on the previous iteration. {tail}".strip())
            if goose_fails >= 3:
                finish("error", f"goose failed 3 iterations in a row (exit {rc}): {tail or 'see goose-iter*.log'}",
                       1, iterations=i, goose_exit=rc)
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

        comment_bad = comment_violations(start_sha)
        if comment_bad:
            log(f"comment rules: {len(comment_bad)} violation(s) in the comments this run added")
            notes.append(
                "Comments you added break the project's comment rules. Fix the prose; "
                "do not touch the tests:\n" + "\n".join(f"- {v}" for v in comment_bad[:10])
            )

        # Fold the outcome into the scoping state before the next scope is chosen:
        # which tests cleared, which layers went unselected, whether this iteration
        # gained anything. `no_gain` is evaluated against the count from *before*
        # this iteration's work.
        reduced = len(res["failing"]) < prev_failing
        no_gain = 0 if (reduced or not goose_ok) else no_gain + 1
        cleared = scoping.update_state(scope_state, scope, prev_failing_ids, res["failing"])
        prev_failing_ids = list(res["failing"])

        tokens_total = progress(i, res, prev_failing, iteration_started, tokens_before,
                                tokens_total, scope, cleared)
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
        same = same + 1 if (sig == prev_sig and goose_ok) else 1
        prev_sig = sig
        log(f"{len(res['failing'])} failing, same failing set for {same} iteration(s), "
            f"no reduction for {no_gain} iteration(s)")
        if same >= lim["escalate_after"] + lim["strong_attempts"]:
            finish("needs_human", f"stuck on the same {len(res['failing'])} failures", 2,
                   iterations=i, failing=res["failing"][:50])
        if no_gain >= lim["escalate_after"] + lim["strong_attempts"]:
            # The set churns (scoping narrows it) but the total does not fall: the
            # model is making changes that do not land. Same verdict as an identical
            # set, reached by the other signature.
            finish("needs_human",
                   f"no reduction in failures for {no_gain} iterations "
                   f"({len(res['failing'])} still failing)", 2,
                   iterations=i, failing=res["failing"][:50])
        scope = scoping.select_scope(res["failing"], scope_limit, layer_order,
                                     scope_depends_on, scope_state)
        log_scope(i + 1, scope, len(res["failing"]))
        write_failures(failures_file, res, notes, scope)

    finish("needs_human", "max iterations reached", 2, iterations=lim["max_iterations"])


if __name__ == "__main__":
    main()
