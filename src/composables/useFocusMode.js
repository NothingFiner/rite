import { ref } from 'vue'

/// Focus / typewriter mode (roadmap 5.3).
///
/// A single mode that hides the app chrome and keeps the caret's paragraph
/// vertically centred. Editor-only, never persisted, no visible exit control.
///
/// STUB — signatures only, no behaviour. The implementation belongs here; the
/// tests in `useFocusMode.test.js` and `e2e/focus-mode.spec.js` describe what it
/// must do. See SPEC.md.
///
/// Wiring contract (the tests depend on this shape):
///   in:  { viewMode, editorRef, leftDrawerOpen, rightDrawerOpen }
///   out: { active, toggle(), exit(), canOpenDrawer() }
export function useFocusMode({ viewMode, editorRef, leftDrawerOpen, rightDrawerOpen }) {
  const active = ref(false)

  function toggle() {}

  function exit() {}

  function canOpenDrawer() {
    return true
  }

  return { active, toggle, exit, canOpenDrawer }
}
