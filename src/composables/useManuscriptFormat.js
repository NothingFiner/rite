import { ref, computed } from 'vue'
import {
  MANUSCRIPT_FORMATS,
  DEFAULT_MANUSCRIPT_FORMAT_ID,
  findManuscriptFormat,
} from '../constants/manuscriptFormat.js'

/// Manuscript page-format selection: which preset (Standard / Shunn / A4) the
/// manuscript view renders and pagination measures against.
///
/// This is a module-level SINGLETON (mirrors `useSectionFormat`): the manuscript
/// view (`manuscriptPage.vue`), the pagination measure (`usePagination`), and
/// the options drawer all call `useManuscriptFormat()` and see the SAME active
/// format. If each spun up its own instance, the rendered page size and the
/// measured page breaks could drift — exactly the render-vs-measure divergence
/// this composable exists to prevent. The active preset id is persisted to
/// localStorage so a writer's chosen format survives reload.
///
/// Why a reactive `format` computed (not a static import of `constants/page.js`):
/// the format is user-switchable at runtime. `usePagination` watches `format`
/// and re-measures when it changes (every cached section height was measured at
/// the old content width / font, so the whole cache is invalid on a switch).
/// A static const import couldn't drive that reactivity.

let formatIdRef = null
function sharedFormatId() {
  if (!formatIdRef) formatIdRef = ref(DEFAULT_MANUSCRIPT_FORMAT_ID)
  return formatIdRef
}

// Test-only: reset the shared ref so a mutation in one test doesn't leak into
// the next. Not called in production.
export function resetManuscriptFormatForTests() {
  formatIdRef = ref(DEFAULT_MANUSCRIPT_FORMAT_ID)
}

export function useManuscriptFormat() {
  const formatId = sharedFormatId()
  // The full preset object for the active id. Falls back to the first preset
  // (standard) if the stored id is ever unrecognized (e.g. a preset removed in a
  // future version) so the app never renders with a missing format.
  const format = computed(() => findManuscriptFormat(formatId.value))

  function loadPrefs() {
    try {
      const raw = localStorage.getItem('rite-manuscript-format')
      if (raw && MANUSCRIPT_FORMATS.some((f) => f.id === raw)) {
        formatId.value = raw
      }
    } catch {
      // localStorage can be unavailable (private mode, disabled site data) —
      // fall back to the default format silently rather than crashing the view.
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem('rite-manuscript-format', formatId.value)
    } catch {
      // Same as loadPrefs: a failed write is non-fatal.
    }
  }

  function selectFormat(id) {
    if (MANUSCRIPT_FORMATS.some((f) => f.id === id)) {
      formatId.value = id
      savePrefs()
    }
  }

  return {
    formatId,
    format,
    formats: MANUSCRIPT_FORMATS,
    loadPrefs,
    savePrefs,
    selectFormat,
  }
}