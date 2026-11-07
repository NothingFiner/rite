# 5.7b — Reduced motion, focus rings, landmarks and headings

Approved sentence list for the spec-to-tests stage. The tests are written and red;
they define what "done" means. This file is the implementer's whole context.

## Context

### Where this sits in 5.7

5.7a gave the editor, toolbar and activity bar their names and states, and 5.7
began with the keyboard pass. This is the last slab: what a screen reader reads
(structural navigation), what a keyboard user sees (a focus ring), and what a
motion-sensitive writer experiences (less movement). Reachability and naming are
done; nothing here adds a control.

### Headings, so VoiceOver can jump between sections

Both views build their title markup in `src/composables/useParagraphHTML.js`.
`sectionTitleToHTML` emits one shape for the editor
(`<div class="section-title chapter">`) and another for the manuscript
(`<p class="ms-para chapter">`), so one change reaches both.

A chapter title becomes a level 1 heading and a freeform section title a level 2
heading, which matches the nesting: chapters are the top unit, and a section sits
inside one. The title page's own `<h1>` lives in `manuscriptDisplay.vue` front
matter and is not part of this.

Both heading levels go in as `role="heading"` with `aria-level`, because these
elements are `div` and `p` and their class names already carry the styling.

### Skip link

The first focusable thing in the document becomes a skip link, so a keyboard
user lands somewhere useful instead of walking the whole chrome. It reads "Skip
to manuscript", stays out of sight until it takes focus, and moves focus into
the editor sheet when activated.

It lives in `App.vue` so it precedes every other control in the tab order, and it
targets the editor sheet rather than adding a new wrapper. Because it is first,
one Tab from a freshly loaded window must land on it. The link carries the class
`skip-link`, which is the handle the test uses before it is on screen.

### Landmarks, by role

The four large regions get landmark roles, and every one is a `role` attribute
rather than a new element, because the existing markup and CSS are built around
the current tags:

| Region | Element today | Role |
|---|---|---|
| toolbar | `.toolbar` in `Toolbar.vue` | `banner` |
| activity bar | `.activity-bar` in `ActivityBar.vue` | `navigation` |
| editing area | `.scroll-layer` in `App.vue` | `main` |
| status bar | `.statusbar` in `StatusBar.vue` | `contentinfo` |

The activity bar's navigation landmark needs a name, or VoiceOver says
"navigation" with nothing to distinguish it. Drawers are not landmarks: they are
transient panels, and four complementary regions would add noise rather than
structure.

### Reduced motion, everywhere

When the system asks for reduced motion, every transition and animation in the
app must finish in effectively no time. "Everywhere" is the requirement, so the
rule belongs in the global stylesheet as one media query rather than per
component, and the test measures several unrelated elements rather than one.

The check is a computed duration at or below `0.01s`. The same elements must have
a real duration without the preference, which is what stops the assertion from
being vacuous.

### Focus rings

Keyboard focus must be visible on every control, and mouse clicks must not leave
a ring behind. Rite currently sets a border colour on `:focus` and several rules
remove the outline, which gives the keyboard no consistent indicator.

The rule is `:focus-visible`: an accent ring around any control focused from the
keyboard, no ring for a control focused by clicking. Inputs and selects keep
their border change and gain the ring, because the ring is the only indicator
that works on a 16px swatch.

### Deleted in this change

`src/components/Ruler.vue` and `src/components/Ruler.spec.js` are removed. No
component imports `Ruler.vue`, so the strip cannot be reached and its spec guards
dead code.

## Decisions

- **Heading levels**: chapter 1, section 2, in both the editor and the manuscript
  markup.
- **Heading attribute order**: `role="heading"` then `aria-level` sit immediately
  after the `class` attribute, before the `data-*` attributes and
  `contenteditable`. The reconciler's byte-identity tests pin this exact order.
- **Hidden manuscript titles**: a hidden section's manuscript title
  (`p.ms-para.section-hidden`) keeps its current markup and gains no heading
  attributes, because it is not rendered as a visible title.
- **Skip link**: one, "Skip to manuscript", first in the tab order, hidden until
  focused, moving focus to the editor sheet.
- **Landmarks**: `role` attributes on the four existing containers, with a name on
  the navigation landmark.
- **Reduced motion**: one global media query covering every transition and
  animation.
- **Focus rings**: `:focus-visible` everywhere, inputs and selects included.
- **`Ruler.vue`**: deleted with its spec.

## Sentences

| ID | Layer | Sentence |
|---|---|---|
| S-001 | unit | it should render a chapter title as a level 1 heading and a section title as a level 2 heading, in both the editor and the manuscript markup |
| S-002 | e2e | it should expose the rendered titles to the accessibility tree as headings in the editor and in the manuscript view |
| S-003 | e2e | it should put the skip link first in the tab order, out of sight until it takes focus |
| S-004 | e2e | it should move focus into the manuscript when the skip link is activated |
| S-005 | unit | it should mark the toolbar, the activity bar and the status bar with the banner, navigation and contentinfo roles |
| S-006 | e2e | it should mark the editing area as the main landmark |
| S-007 | e2e | it should cut every transition and animation to effectively no time when the system asks for reduced motion |
| S-008 | e2e | it should show a focus ring on a control focused with the keyboard |
| S-009 | e2e | it should leave no focus ring on a control focused by clicking it |

## Out of scope

- No contrast changes and no new palette values.
- No change to what the editor announces while typing.
- No landmarks for drawers, dialogs or panels.
- No roving tabindex or new shortcut.
- No headings in the manuscript's title page or table of contents, which already
  use real `h1` and list markup.
