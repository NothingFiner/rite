"""Choose which failures one build iteration works on.

The orchestrator still runs every test layer every iteration and still judges the
whole suite: a run is green only when *every* test passes. This module decides only
what the planner is *asked* to fix, which is a different question from what counts
as done.

Why it exists: an iteration that hands the planner eight failures across three
languages produces eight half-fixes and no green tests. Measured on this repo, a
planner given the whole set grouped it into two work units, both units "implemented
the full spec", and the iteration ended in a `needs_human` objection. The cost is
not the test run (all three layers together are ~94 s); it is the model calls per
iteration, which are ~86% of the wall clock.

Two rules, named in the design discussion as B3 and BL:

    BL  one layer per iteration. One language means one mental model, which means
        fewer work units, which means fewer coder calls.
    B3  at most `limits.failures_in_scope` failures from that layer.

Ranking is by cohesion, not by tractability. Three tests that share one helper are
one piece of work; three "easy" tests picked across three families are three
contexts, which is the original problem with a smaller number. The family is the
S-ID when the test name carries one, since that is how this project already groups
tests that share a fixture or a helper.

Three guards keep scoping from becoming a way to avoid work:

    starvation   a layer that is red and unselected for STARVE_AFTER iterations is
                 forced next, however many failures another layer has
    stall        an iteration that clears none of its in-scope tests drops the next
                 one to a single test (B1 as an escalation state, not a new mode)
    rotation     while stalled, tests that have already been attempted sink below
                 untried ones in the same family, so the same test is not picked
                 forever

Everything here is pure: no file reads, no logging, no globals. `select_scope` takes
the state dict, `update_state` returns the new one. That keeps it callable from a
one-off check without a test layer (the workflow has none, by design).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# A test id is "<layer>::<name>"; the S-ID is the project's own grouping of tests
# that exercise one sentence of the spec, which is also the set that tends to share
# a helper.
SPEC_ID = re.compile(r"\b[Ss]-(\d{3})\b")
TOKEN = re.compile(r"[a-z0-9]+")

STARVE_AFTER = 2      # iterations a red layer may go unselected before it is forced
STALL_AFTER = 1       # zero-clear iterations before the next scope drops to one test
ROTATE_AFTER = 2      # stalled iterations before tried tests sink below untried ones


@dataclass
class Scope:
    """What this iteration is asked to fix, and what it is told to leave alone."""

    in_scope: list[str] = field(default_factory=list)
    deferred: list[str] = field(default_factory=list)
    layer: str | None = None
    reason: str = ""
    limit: int = 0

    @property
    def enabled(self) -> bool:
        """True when a slice was actually chosen, i.e. the planner must be scoped."""
        return self.layer is not None

    def as_dict(self) -> dict:
        return {
            "layer": self.layer,
            "in_scope": list(self.in_scope),
            "deferred": list(self.deferred),
            "reason": self.reason,
            "limit": self.limit,
        }


def layer_of(test_id: str) -> str:
    return test_id.split("::", 1)[0]


def family_of(test_id: str) -> str:
    """The grouping key used for cohesion: the S-ID, else the leading words.

    A test named `s_018_a_user_role_overrides_the_built_in_of_the_same_name` groups
    with its siblings by S-018. Tests without an S-ID group by their first two words,
    which is the longest prefix that is still a property of the name rather than of
    the sentence it happens to assert.
    """
    found = SPEC_ID.search(test_id)
    if found:
        return f"s-{found.group(1)}"
    words = TOKEN.findall(test_id.split("::")[-1])
    return "-".join(words[:2]) or test_id


def _ranked_clusters(tests: list[str], attempts: dict[str, int], rotate: bool) -> list[str]:
    """Flatten tests so that the largest cohesive family comes first.

    Ties keep the input order, so the result is stable across iterations when nothing
    has changed. While stalled, tests already attempted sink below untried ones
    *within* their family, so rotation stays inside the coherent unit of work instead
    of jumping to an unrelated one.
    """
    clusters: dict[str, list[str]] = {}
    for tid in tests:
        clusters.setdefault(family_of(tid), []).append(tid)
    order = sorted(
        clusters,
        key=lambda f: (-len(clusters[f]), tests.index(clusters[f][0])),
    )
    flat: list[str] = []
    for name in order:
        members = clusters[name]
        if rotate:
            members = sorted(members, key=lambda t: attempts.get(t, 0))
        flat.extend(members)
    return flat


def select_scope(
    failing: list[str],
    limit: int,
    layer_order: list[str],
    depends_on: dict[str, list[str]] | None = None,
    state: dict | None = None,
    synthetic: tuple[str, ...] = ("__BUILD_OR_RUN_ERROR__", "__NO_TESTS_RAN__"),
) -> Scope:
    """Pick the layer and the failures this iteration should work on.

    `limit <= 0` disables slicing entirely, which is how a run gets the old
    behaviour back: the planner sees every failure, as it did before this existed.

    Fail-open cases, all deliberate: a build/setup error or a baseline test that no
    longer runs is not a failure the planner can be told to ignore, and an unknown
    layer name means the config and the test ids disagree. Each of those returns
    every failure in scope rather than hiding one behind a slice.
    """
    depends_on = depends_on or {}
    state = state or {}
    failing = list(dict.fromkeys(failing))          # keep order, drop duplicates
    if not failing:
        return Scope([], [], None, "nothing failing", limit)

    layers = {layer_of(t) for t in failing}
    unknown = layers - set(layer_order)
    if any(t.endswith(synthetic) for t in failing) or unknown:
        why = "build/setup failure" if any(t.endswith(synthetic) for t in failing) else f"unknown layer {sorted(unknown)}"
        return Scope(failing, [], None, f"scoping disabled: {why} must reach the planner", limit)

    if limit <= 0:
        return Scope(failing, [], None, "scoping disabled by configuration", limit)
    if len(failing) <= limit:
        return Scope(failing, [], None, f"all {len(failing)} failures fit in one iteration", limit)

    by_layer: dict[str, list[str]] = {}
    for tid in failing:
        by_layer.setdefault(layer_of(tid), []).append(tid)
    present = [name for name in layer_order if name in by_layer]
    present += sorted(layers - set(present))

    # A dependent layer (e2e) is not a coherent unit of work while the layer it
    # exercises is red: every failure there is a symptom, and it is the slowest
    # layer to boot. Excluding it removes a whole class of chasing-the-wrong-thing.
    #
    # The excluded layers are kept, not just dropped, so the reason can say why a
    # layer with more failures was passed over. Without that, a run with 1 unit
    # and 10 e2e failures logged "unit has the most failures (1)". That reads as
    # an arithmetic bug, but it is a dependency rule.
    excluded = [
        name for name in present
        if any(dep in by_layer and dep != name for dep in depends_on.get(name, []))
    ]
    eligible = [name for name in present if name not in excluded]
    if not eligible:
        # Every layer depends on another red layer. Working on all of them is
        # worse than working on the best slice, but better than refusing to plan.
        eligible, excluded = present, []

    unselected: dict[str, int] = state.get("unselected", {})
    starved = [name for name in eligible if unselected.get(name, 0) >= STARVE_AFTER]
    if starved:
        layer = sorted(starved, key=lambda n: (-unselected.get(n, 0), present.index(n)))[0]
        reason = f"{layer} was red and unselected for {unselected.get(layer, 0)} iterations"
    else:
        layer = sorted(eligible, key=lambda n: (-len(by_layer[n]), present.index(n)))[0]
        reason = f"{layer} has the most failures ({len(by_layer[layer])})"
        if excluded:
            why = "; ".join(
                f"{name} ({len(by_layer[name])}) excluded while "
                f"{'/'.join(d for d in depends_on.get(name, []) if d in by_layer and d != name)} is red"
                for name in excluded
            )
            reason = f"{layer} has the most eligible failures ({len(by_layer[layer])}); {why}"

    stall = state.get("stall", 0)
    effective = 1 if stall >= STALL_AFTER else limit
    if effective != limit:
        reason += f"; scope reduced to 1 after {stall} iteration(s) that cleared nothing"

    ordered = _ranked_clusters(by_layer[layer], state.get("attempts", {}), stall >= ROTATE_AFTER)
    in_scope = ordered[:effective]
    deferred = [t for t in failing if t not in in_scope]
    return Scope(in_scope, deferred, layer, reason, limit)


def update_state(
    state: dict,
    scope: Scope,
    failing_before: list[str],
    failing_after: list[str],
) -> int:
    """Fold one iteration's result into the scoping state. Returns cleared count."""
    after = set(failing_after)
    cleared = [t for t in scope.in_scope if t not in after]

    attempts: dict[str, int] = state.setdefault("attempts", {})
    for tid in scope.in_scope:
        attempts[tid] = attempts.get(tid, 0) + 1
    for tid in cleared:                     # nothing left to rotate around
        attempts.pop(tid, None)

    unselected: dict[str, int] = state.setdefault("unselected", {})
    red_layers = {layer_of(t) for t in failing_after}
    if scope.enabled:
        for name in red_layers:
            unselected[name] = 0 if name == scope.layer else unselected.get(name, 0) + 1
        for name in list(unselected):       # a green layer stops accumulating
            if name not in red_layers:
                unselected.pop(name, None)

    state["stall"] = 0 if cleared else state.get("stall", 0) + 1
    state["last"] = {"layer": scope.layer, "in_scope": list(scope.in_scope)}
    state["cleared"] = len(cleared)
    return len(cleared)


def scope_note(scope: Scope, total_failing: int) -> str:
    """The planner-facing header. Written into the failures file, which step 1 of
    the planner recipe tells it to read, so no extra recipe parameter is needed."""
    if not scope.enabled:
        return (
            f"## Scope — all {total_failing} failures are in scope\n"
            f"{scope.reason}.\n\n"
            "Group them into work units whose file sets do not overlap. If that is more\n"
            "work than one iteration can do well, do the smallest coherent unit and stop."
        )
    count = len(scope.in_scope)
    return (
        f"## Scope — {scope.layer} only, {count} of {total_failing} failures\n"
        f"Chosen because {scope.reason}.\n\n"
        f"Fix these {count} {'test' if count == 1 else 'tests'}, and nothing else. The other\n"
        f"{len(scope.deferred)} failures are listed under *Deferred* at the bottom of this file.\n"
        "They are out of scope for this iteration: do not plan work for them, and do not\n"
        "widen a work unit to reach them. The orchestrator judges the whole suite, so they\n"
        "still have to pass before this run is green — they will have their own iteration.\n\n"
        "If the honest fix is a shared helper that also repairs some deferred tests, write\n"
        "the helper. That is not scope creep; editing to make one deferred test pass is."
    )


def deferred_note(scope: Scope) -> str:
    """The footer. Kept in the file so a regression in a deferred layer is still
    visible to a human reading the iteration, while the planner is told to ignore it."""
    if not scope.enabled or not scope.deferred:
        return ""
    return (
        f"## Deferred — do not touch ({len(scope.deferred)} failures)\n"
        "Out of scope for this iteration. Listed so the full state of the suite stays\n"
        "visible in this file.\n\n"
        + "\n".join(f"- {t}" for t in scope.deferred)
    )
