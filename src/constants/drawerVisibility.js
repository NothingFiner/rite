// Which left-drawer modes may appear in each view. The single source of truth
// for two consumers that must agree:
//   - ActivityBar.vue filters its drawer buttons by `isDrawerModeAllowedIn` so a
//     button that doesn't apply to the current view is hidden (e.g. Text Options
//     is editor-only — the editor's text appearance has no meaning in the
//     manuscript or history views).
//   - App.vue's view-switch handler closes an open drawer whose button would
//     vanish in the target view (e.g. Text Options open in Editor → switch to
//     Manuscript: without this rule the drawer would stay open with no handle to
//     close it).
// Keeping the rule here means the filter and the close-on-switch can't drift
// apart — the kind of bug that would leave an open drawer with no button.
//
// 'chapters' (the Sections nav) stays a valid leftDrawerMode value in editor +
// manuscript; it is dropped in history (you browse versions there, not the live
// document's sections). 'general-options' is always available — its settings
// (AI, roles, export, format, retrieval, summaries) are global, not
// editor-specific. 'text-options' is editor-only. 'history' (the version list)
// is reached via the History view's in-header Versions toggle, NOT an
// ActivityBar button, so it is intentionally absent from this map — the map
// governs ActivityBar button visibility, and there is no ActivityBar button for
// history.

export const DRAWER_MODES_ALLOWED_IN_VIEW = {
  editor: ['chapters', 'general-options', 'text-options'],
  manuscript: ['chapters', 'general-options'],
  history: ['general-options'],
}

/// True if `mode` is a left-drawer mode whose ActivityBar button should be
/// reachable in `view`. Unknown modes (e.g. 'history', which has no
/// ActivityBar button) and unknown views resolve to false — never accidentally
/// show a button for an unlisted combination.
export function isDrawerModeAllowedIn(mode, view) {
  const allowed = DRAWER_MODES_ALLOWED_IN_VIEW[view]
  return Array.isArray(allowed) && allowed.includes(mode)
}