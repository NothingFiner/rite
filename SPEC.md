# 5.7a — Editor, toolbar and activity-bar semantics

Approved sentence list for the spec-to-tests stage. The tests are written and red;
they define what "done" means. This file is the implementer's whole context.

## Context

### Where this sits in 5.7

The accessibility pass began with non-mouse navigation, because every
screen-reader user on macOS drives VoiceOver from the keyboard, so a keyboard
gap is also a screen-reader gap. That half is done: drawer and history rows are
real controls with a roving tabindex, opening a drawer focuses its active row,
Escape returns focus to the opener, and Tab deliberately leaves an open drawer.

This item is the naming and semantics half for three surfaces. The CSS and
structure half (reduced motion, `:focus-visible`, landmarks, a skip link, and the
`Ruler.vue` decision) is 5.7b and is not touched here.

### The editor sheet

`src/components/editor/editorDisplay.vue` renders a bare
`contenteditable="true"` div. WKWebView's accessibility tree therefore has no
text field in it: VoiceOver reads the text as static content and cannot tell the
writer where typing goes. The sheet needs `role="textbox"` with
`aria-multiline="true"` and an accessible name, and it keeps
`contenteditable="true"` because that is what makes it editable.

The name is the fixed word **Manuscript**, not the document title. A fixed name
is stable while the writer types, so VoiceOver does not re-announce the field
every time the title changes, and it matches the view's own vocabulary.

### The view tablist

`src/components/Toolbar.vue` declares `role="tablist"` with three `role="tab"`
buttons. It has no keyboard behaviour at all: all three tabs are separate tab
stops, and arrow keys do nothing. A tablist should be one tab stop, with the
arrows moving between tabs, which is the pattern VoiceOver announces.

Decisions, so the implementer does not have to invent them:

- **One tab stop**: the selected tab is `tabindex="0"` and the others
  `tabindex="-1"`. Tab therefore enters the tablist once and leaves it once.
- **Automatic activation**: an arrow key moves focus *and* selects, so the view
  changes as the writer moves. This is the standard behaviour for view tabs
  whose content is already loaded, and it avoids a second keystroke.
- **Wrapping**: ArrowRight on the last tab selects the first, ArrowLeft on the
  first selects the last.
- **Home and End** select the first and last tab.
- The component is stateless (it takes `mode` as a prop and emits `setMode`), so
  it must move focus itself. The parent's re-render then updates which tab is
  `tabindex="0"`.

### The format buttons and the activity icons

The B/I/U buttons in `ActivityBar.vue` carry `tabindex="-1"` on purpose, so a
keyboard writer keeps the caret in the editor and uses Cmd+B/I/U instead. That
stays. What they lack is a name and a state: the visible glyph is `B`, and a
glyph is not an accessible name, nor does anything report whether bold is on.
They get `aria-label` (Bold, Italic, Underline) and `aria-pressed` from the live
`formats` prop.

The four drawer buttons in the same file rely on the `title` attribute alone. A
tooltip is not an accessible name, so each gets `aria-label` equal to its drawer
label. Because each button opens a drawer, each also reports `aria-expanded`,
true for the one whose drawer is open and false for the rest.

`title` stays on both groups: it is the visible tooltip, and removing it would
cost mouse users information.

### Files in play

| File | What changes |
|---|---|
| `src/components/editor/editorDisplay.vue` | sheet role, `aria-multiline`, `aria-label` |
| `src/components/Toolbar.vue` | roving tabindex and the arrow/Home/End keys |
| `src/components/ActivityBar.vue` | format-button names and pressed state, icon names and expanded state |

No other component reads these attributes, so nothing downstream needs to
change. `Toolbar.spec.js` and `ActivityBar.spec.js` keep every existing case;
the new tests are appended.

## Decisions

- **Editor name**: fixed `Manuscript`.
- **Section headings**: deferred to 5.7b. Nothing here touches the rendered
  block structure.
- **Tab activation**: automatic, focus follows selection.
- **Format buttons**: stay out of the tab order at `tabindex="-1"`.
- **`Ruler.vue`**: deferred to 5.7b, where the choice is delete or mount.
- **`title` attributes**: kept everywhere they already exist.

## Sentences

| ID | Layer | Sentence |
|---|---|---|
| S-001 | e2e | it should expose the editor sheet as a multiline textbox |
| S-002 | e2e | it should name the editor sheet Manuscript |
| S-004 | unit | it should keep one tab stop in the view tablist, on the selected tab |
| S-005 | unit | it should move the selection and focus between view tabs with ArrowRight and ArrowLeft, wrapping at the ends |
| S-006 | unit | it should move to the first and last view tab with Home and End |
| S-007 | e2e | it should reach the tablist once by Tab and switch the visible view with the arrow keys |
| S-008 | unit | it should name each format button Bold, Italic or Underline |
| S-009 | unit | it should report each format button's pressed state from the live format |
| S-010 | unit | it should name each activity icon with its drawer label |
| S-011 | unit | it should report which activity icon's drawer is open |

S-003 is unused: it was reserved for section titles as headings, which moved to
5.7b. The gap stays so the numbering does not shift.

## Out of scope

- No landmarks, skip link, `prefers-reduced-motion` or `:focus-visible` work.
- No change to the editor's rendering, its block structure or its section titles.
- No change to the format buttons' tab order, and no new shortcut.
- No ARIA live region for the word count or the save status.
- No testing with a real screen reader. These sentences cover the attributes and
  key presses that VoiceOver reads, not what it says.
