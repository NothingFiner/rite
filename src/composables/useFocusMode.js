import { ref, watch } from 'vue'
import { getParagraphAtCursor } from './useEditorCursor.js'

/// Focus / typewriter mode (roadmap 5.3).
///
/// A single mode that hides the app chrome and keeps the caret's paragraph
/// vertically centred. Editor-only, never persisted, no visible exit control.
///
/// State contract (the tests depend on this shape):
///   in:  { viewMode, editorRef, leftDrawerOpen, rightDrawerOpen }
///   out: { active, toggle(), exit(), canOpenDrawer(), recentre() }
///
/// `active` starts false on every launch and is never written to localStorage:
/// focus mode is a per-session posture, not a preference (S-001).
export function useFocusMode({ viewMode, editorRef, leftDrawerOpen, rightDrawerOpen }) {
  const active = ref(false)

  function exit() {
    active.value = false
  }

  /// Whether the chrome (a drawer) may open right now. While focus mode is
  /// active it may not — a drawer opening would defeat the whole point — so
  /// App.vue's drawer-open paths consult this and defer while active (S-009).
  function canOpenDrawer() {
    return !active.value
  }

  /// Centre the caret's paragraph in the viewport. Deliberately instant
  /// ('auto', never 'smooth'): focus mode re-centres on every caret move, and
  /// a smooth scroll per keystroke fights the writer (and the e2e polling).
  /// Self-guards on inactive so stray selectionchange events are free.
  function recentre() {
    if (!active.value) return
    const para = getParagraphAtCursor()
    if (para) para.scrollIntoView({ behavior: 'auto', block: 'center' })
  }

  /// Resolve the editor's root sheet element the same way useFormat does:
  /// the ref may be a component whose `$el` IS the sheet, or a wrapper whose
  /// `$el` contains it.
  function getEditorSheet() {
    const el = editorRef.value?.$el
    if (!el) return null
    if (el.classList?.contains('editor-sheet')) return el
    return el.querySelector?.('.editor-sheet') || null
  }

  function toggle() {
    // Editor-only: no-op while the manuscript/history views are showing (S-004).
    if (viewMode.value !== 'editor') return

    if (active.value) {
      exit()
      return
    }

    active.value = true

    // Take the chrome down first (S-008): a drawer left open while the mode
    // hides everything else is a half-entered state.
    if (leftDrawerOpen.value) leftDrawerOpen.value = false
    if (rightDrawerOpen.value) rightDrawerOpen.value = false

    // Caret handoff: if the caret already sits in a paragraph, recentre it;
    // otherwise (e.g. nothing selected yet) move focus to the sheet so the
    // next keystroke lands in the text and the caret paragraph centres then.
    // Never synthesize a selection — just hand focus over.
    const para = getParagraphAtCursor()
    if (para) {
      recentre()
    } else {
      getEditorSheet()?.focus()
    }
  }

  // Leaving the editor view always drops the mode — focus mode is scoped to
  // the editor, and App.vue's history flow sets viewMode then synchronously
  // opens a drawer, so the watcher must flush 'sync' and exit BEFORE that
  // drawer open can be (rightly) refused.
  watch(viewMode, (mode) => {
    if (mode !== 'editor' && active.value) exit()
  }, { flush: 'sync' })

  return { active, toggle, exit, canOpenDrawer, recentre }
}