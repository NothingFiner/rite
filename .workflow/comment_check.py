"""Check the comments a change adds against the mechanical comment rules.

Why a script and not more prose: the coder reads `.workflow-out/standards/` in
full and still wrote four copies of one rule, sentences twice the length limit
and phrases the rules name as forbidden. The rules that held were the ones the
orchestrator checks (owned paths, protected tests). Prose loses to task pressure
unless something measures it, so the mechanical half of the comment rules lives
here instead of in a paragraph the model has to remember.

Checks, all from `universal.md` -> Comments:
    long sentence     over 25 words
    clause join       `;`, ` — ` or ` – ` inside one sentence (two ideas)
    change history    "no longer", "now", "previously", "used to", "today's", "pre-<n>"
    emphasis          an ALL CAPS word of 4+ letters
    duplicate         a block that restates another added block (>= 0.8 similar)

Deliberately NOT checked: why-vs-what, evidence and consequence, term definition.
Those need judgement, and a gate that guesses would train the coder to game it.

Usage:
    python3 .workflow/comment_check.py --base origin/development
    python3 .workflow/comment_check.py --base origin/development --at ffe70dc
    python3 .workflow/comment_check.py --base HEAD --json

`--json` always exits 0 and prints `{"violations": [...], "blocks": n}` so a
caller can treat a checker bug as "no opinion" rather than as a failing build.
Without `--json` it exits 1 when anything is found.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from difflib import SequenceMatcher

MAX_WORDS = 25
# A restated rule is the costly failure mode: the copies drift, then disagree.
DUPLICATE_RATIO = 0.7
DUPLICATE_MIN_WORDS = 8

# Prefixes that start a comment line, by file suffix. Markdown is excluded: its
# prose is not code, and SPEC.md is governed by the spec rules instead.
COMMENT_PREFIXES = {
    ".js": ("///", "//!", "//", "/*", "*"),
    ".ts": ("///", "//!", "//", "/*", "*"),
    ".vue": ("///", "//!", "//", "/*", "*"),
    ".css": ("/*", "*"),
    ".rs": ("///", "//!", "//", "/*", "*"),
    ".py": ("#",),
    ".sh": ("#",),
    ".yaml": ("#",),
    ".yml": ("#",),
    ".toml": ("#",),
}
SKIP_SUFFIXES = {".md", ".lock", ".json", ".br", ".png", ".jpg", ".webp", ".ico"}

HISTORY = re.compile(
    r"\b(no longer|previously|used to|was changed|today's|now|pre-\d[\w.]*)\b",
    re.IGNORECASE,
)
CAPS = re.compile(r"\b[A-Z]{4,}\b")
# Identifiers and acronyms the project treats as words. Everything else in
# caps is emphasis, which the rules forbid.
CAPS_ALLOWED = {
    "SPEC", "HTML", "DOM", "IPC", "CSS", "JSON", "HTTP", "HTTPS", "API", "URL",
    "SVG", "PNG", "PDF", "WAV", "UTF", "LLM", "TESTING", "TODO", "RUST", "TAURI",
}
BACKTICKED = re.compile(r"`[^`]*`")


@dataclass
class Block:
    file: str
    line: int
    text: str


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=False
    ).stdout


def added_comment_blocks(base: str, at: str | None) -> list[Block]:
    """Collect the comment lines a diff adds, grouped into contiguous blocks.

    `--unified=0` keeps the hunks to added/removed lines, so the `+c` offset in
    each hunk header is the line number of the first added line and can be
    counted forward exactly.
    """
    args = ["diff", "--unified=0", "--no-color", base]
    if at:
        args.append(at)
    diff = git(*args)
    if not diff:
        return []

    blocks: list[Block] = []
    current: list[str] = []
    current_file, current_line, new_line = "", 0, 0

    def flush() -> None:
        nonlocal current
        if current:
            blocks.append(Block(current_file, current_line, " ".join(current)))
        current = []

    for raw in diff.splitlines():
        if raw.startswith("+++ b/"):
            flush()
            current_file = raw[6:]
            continue
        if raw.startswith("---") or raw.startswith("+++"):
            flush()
            continue
        if raw.startswith("@@"):
            flush()
            m = re.search(r"\+(\d+)", raw)
            new_line = int(m.group(1)) if m else 0
            continue
        if raw.startswith("+") and not raw.startswith("+++"):
            stripped = raw[1:].strip()
            suffix = "." + current_file.rsplit(".", 1)[-1] if "." in current_file else ""
            prefixes = COMMENT_PREFIXES.get(suffix, ())
            if suffix not in SKIP_SUFFIXES and stripped.startswith(prefixes):
                if not current:
                    current_line = new_line
                current.append(clean(stripped, prefixes))
            else:
                flush()
            new_line += 1
            continue
        if raw.startswith(" "):
            flush()
            new_line += 1
            continue
        # A removed line, or diff metadata. It does not advance the new-file count.
        flush()
    flush()
    return [b for b in blocks if b.text.strip()]


def clean(stripped: str, prefixes: tuple[str, ...]) -> str:
    # Longest first: `///` must win over `//` or a doc comment keeps a stray `/`.
    for prefix in sorted(prefixes, key=len, reverse=True):
        if stripped.startswith(prefix):
            stripped = stripped[len(prefix):]
            break
    return stripped.lstrip("!").strip().rstrip("*/").strip()


def prose(text: str) -> str:
    """The block with code spans removed, so identifiers never count as prose."""
    return BACKTICKED.sub(" ", text)


def sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


def violations(blocks: list[Block]) -> list[str]:
    found: list[str] = []
    for block in blocks:
        where = f"{block.file}:{block.line}"
        words = prose(block.text)
        for sentence in sentences(words):
            count = len(sentence.split())
            if count > MAX_WORDS:
                found.append(f"{where}: {count}-word sentence (limit {MAX_WORDS}): {sentence[:90]}")
            if ";" in sentence:
                found.append(f"{where}: semicolon joins two ideas; use a full stop: {sentence[:90]}")
            if " — " in sentence or " – " in sentence:
                found.append(f"{where}: dash joins two ideas; use a full stop: {sentence[:90]}")
        history = HISTORY.search(words)
        if history:
            found.append(f"{where}: change history ('{history.group(0)}'); describe the rule, not the change")
        caps = [w for w in CAPS.findall(words) if w not in CAPS_ALLOWED]
        if caps:
            found.append(f"{where}: emphasis in caps ({', '.join(sorted(set(caps)))}); rewrite the sentence")

    # Duplicates are compared sentence by sentence, not block by block: the same
    # rule gets restated inside otherwise different paragraphs, which a block
    # comparison never sees. Only substantial sentences count, so short ones
    # ("Returns 0.5 otherwise.") cannot trigger it.
    lines: list[tuple[str, int, str]] = []
    for block in blocks:
        for sentence in sentences(prose(block.text)):
            if len(sentence.split()) >= DUPLICATE_MIN_WORDS:
                lines.append((block.file, block.line, re.sub(r"\s+", " ", sentence)))

    for i, (file_a, line_a, text_a) in enumerate(lines):
        for file_b, line_b, text_b in lines[i + 1:]:
            if (file_a, line_a) == (file_b, line_b):
                continue
            ratio = SequenceMatcher(None, text_a.lower(), text_b.lower()).ratio()
            if ratio >= DUPLICATE_RATIO:
                found.append(
                    f"{file_b}:{line_b}: restates the comment at "
                    f"{file_a}:{line_a} ({ratio:.0%} similar); name that definition instead"
                )
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--base", default="HEAD", help="revision the diff starts from")
    parser.add_argument("--at", default=None, help="revision to check (default: the working tree)")
    parser.add_argument("--json", action="store_true", help="machine-readable output; always exit 0")
    args = parser.parse_args()

    try:
        blocks = added_comment_blocks(args.base, args.at)
        found = violations(blocks)
    except Exception as exc:  # noqa: BLE001 - a checker bug must not break a caller
        if args.json:
            print(json.dumps({"violations": [], "blocks": 0, "error": f"{type(exc).__name__}: {exc}"}))
            return 0
        raise

    if args.json:
        print(json.dumps({"violations": found, "blocks": len(blocks)}, indent=2))
        return 0

    print(f"comment rules: {len(blocks)} added block(s), {len(found)} violation(s)")
    for line in found:
        print(f"  {line}")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
