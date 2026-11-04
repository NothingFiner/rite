# Rite — Roadmap

Status as of **2026-11-04**, `development` at `c57b4c9` (word menu #17 and iteration scoping #18 merged).

Tauri v1 → v2 migration landed as PR #15 — a prerequisite for 5.11's context menu, not a roadmap item of its own.

**Numbering rule:** IDs are stable. A moved item keeps a pointer at its old ID instead of being renumbered, so commit messages, branch names and old notes stay resolvable. New work takes the next free number in its phase.

---

## Phase 5 — pre-release features

The last feature phase. When this is done, Rite is feature-complete for a first release.

| ID | Item | Status |
|---|---|---|
| 5.1 | View-aware navigation / page preservation | done |
| 5.2 | Drawer / view IA restructure | done |
| 5.3 | Focus / typewriter mode | done (#1) |
| **5.4** | **Writing stats: per-session word target + progress graph in a sidebar item** | **open — spec in progress, `feature/5.4-writing-stats`** |
| 5.5 | Outline drag-reorder + `MoveSection` | done |
| 5.6 | Editor extraction (cursor → page-nav → readback → render) | done (PR1–4) |
| **5.7** | **Accessibility pass** | **open** |
| 5.8 / 5.8a | Spellcheck (native squiggles + context menu) | done |
| 5.9 | Subtitle-less chapters | done |
| 5.10 | Hidden sections replace epigrams | done |
| 5.11 | Thesaurus | done (#16) |
| **5.12** | **History diff next/previous change navigation** | **open — moved from 6.1** |
| **5.13** | **Move the colour/theme picker into Text Options (with font, zoom, margins)** | **open — new, 2026-11-03** |
| 5.14 | `NSSpellChecker` spelling actions | absorbed into 5.15 |
| 5.15 | Restored word menu: Cut / Copy / Paste / Select All + Learn / Ignore Spelling | done (#17) |

### 5.15 — Restored word menu (done, #17)

5.11 replaced WKWebView's right-click menu over a single word with a one-item
`Thesaurus…` menu, which removed the standard editing items and the spell-check
actions from the place writers use them most. This restores them on the same
menu: `Thesaurus…`, a rule, native Cut / Copy / Paste / Select All, a rule, then
Learn (or Unlearn) and Ignore Spelling. Cut/Copy/Paste must stay *native* items —
`onPaste` only runs because the browser raises the paste event, and JS cannot
synthesise a paste with clipboard contents. Spelling is app-owned via
`NSSpellChecker`: learn is global, ignore is per spell-document tag and uses
WKWebView's own `_spellCheckerDocumentTag`. Look Up and Change Spelling are
WebKit's own and have no API, so they stay lost; this item absorbs 5.14.

### 5.4 — Writing stats (was "word-count goals / session target")

A left-drawer "Stats" item: the writer sets a words-per-session target, and sees
a simple progress graph of how the current session is going against it.
`useWordCount` already exists but is pure counting; the session axis is new.

Open questions before its spec: what counts as a *session* (launch → quit?
calendar day?), where the target persists (localStorage vs the `.rite` file),
and what the graph plots (cumulative words over the session, vs per-day bars).

### 5.13 — Colour picker consolidation

The theme swatches currently live in the StatusBar (`StatusBar.vue` owns the
picker and its open/closed state), while font, zoom, margin and manuscript
format live in `TextOptionsDrawer.vue`. Move the picker into that drawer so all
text-appearance controls are in one place, and remove the status-bar copy.
Not a feature — a UI consolidation, but it touches `StatusBar.vue`,
`TextOptionsDrawer.vue`, `App.vue` and `StatusBar.spec.js`.

---

## Phase 6 — release polish

Fine-tuning for an initial release. No new product features here; if something
in this phase turns out to be a feature, it belongs in Phase 5 instead.

| ID | Item | Status |
|---|---|---|
| 6.1 | ~~History diff next/previous change~~ | **moved to 5.12** |
| 6.2 | History flow redesign (change counts, compare-then-restore) | open |
| 6.3 | PDF export | open — **blocked on a decision**: webview print vs `export_pdf.rs` in Rust |
| 6.4 | Error-handling sweep (`console.error` → user-visible reporting) | open — 14 sites remain |
| 6.5 | Release / build packaging (icons, signing, notarization, updater) | partly — `identifier: com.rite.app` set |
| 6.6 | Manuscript view unification (use the 5.6 composables) | open |
| 6.7 | Final accessibility + manual QA | blocked on 5.7 |

---

## Not on the roadmap

- **Per-change revert** — deferred when version history landed; pairs naturally
  with 5.12/6.2 if it is ever revived.
- **Segmented editor** — dropped, not deferred. 2.5 + 5.6 solved the problem a
  different way.
