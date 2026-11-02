<template>
  <div class="app-container"
    :class="{ 'focus-mode': focusActive }"
    :style="{
      '--text-primary': theme.uiTextPrimary,
      '--text-secondary': theme.uiTextSecondary,
      '--accent': theme.uiAccent,
      '--accent-bg': theme.uiAccentBg,
      '--accent-hover': theme.uiAccentHover,
      '--bg-glass-border': theme.uiGlassBorder,
      '--glass-bg': theme.uiGlassBg,
      '--hover-bg': theme.uiHoverBg,
      '--hover-bg-strong': theme.uiHoverBgStrong,
      '--input-bg': theme.uiInputBg,
      '--popup-bg': theme.uiPopupBg,
      '--editor-font': format.editorFont,
    }"
  >
    <ActivityBar
      :active-id="leftDrawerMode"
      :drawer-open="leftDrawerOpen"
      :view-mode="viewMode"
      :formats="format.formats"
      @select="onActivitySelect"
      @toggle-format="format.toggleFormat($event)"
    />

    <NavigationDrawer
      :open="leftDrawerOpen && leftDrawerMode === 'chapters'"
      v-model:expanded="addExpanded"
      :toc-items="nav.tocItems"
      :active-id="nav.selectedNavId"
      @scroll-to="onScrollTo"
      @insert-section="onInsertSection"
      @rename-section="nav.renameSection"
      @change-section-type="nav.changeSectionType"
      @toggle-hidden="nav.setSectionHidden"
      @move-section="nav.moveSection"
      @delete-item="nav.deleteSection"
      @select="nav.selectedNavId = $event"
    />

    <GeneralOptionsDrawer
      :open="leftDrawerOpen && leftDrawerMode === 'general-options'"
      :store="store"
      :section-format="sectionFormat"
      :llm-settings="llmSettings"
      :retrieval="retrieval"
      :summaries="summaries"
      :chat-manager="chatManager"
    />
    <TextOptionsDrawer
      :open="leftDrawerOpen && leftDrawerMode === 'text-options'"
      :theme="theme"
      :format="format"
      :manuscript-format="manuscriptFormat"
    />
    <HistoryListDrawer
      :open="leftDrawerOpen && leftDrawerMode === 'history'"
      :history="history"
      :has-last-path="!!store.lastPath"
    />

    <!-- Right drawer: the Assistant panel (chat/analysis surface). The LLM is
         an analytical collaborator — responses live here, never in the doc. -->
    <div class="drawer right" :class="{ open: rightDrawerOpen }">
      <div class="drawer-content right-drawer">
        <LlmPanel
          :chat="chatManager.activeSession"
          :settings="llmSettings"
          :manager="chatManager"
          :roles="chatManager.roles"
          :busy="chatManager.anyBusy || summaries.summariesBusy"
          @open-settings="openGeneralOptions"
        />
      </div>
    </div>

    <div class="scroll-layer" ref="scrollLayerRef" :class="['mode-' + viewMode, { 'right-pad': rightDrawerOpen }]" @click="nav.selectedNavId = null">
      <div class="editor-wrapper" :class="'mode-' + viewMode">
        <HistoryView
          v-if="viewMode === 'history'"
          :history="history"
          :versions-open="leftDrawerOpen && leftDrawerMode === 'history'"
          @back="onSetMode('editor')"
          @toggle-versions="onToggleVersions"
        />
        <DocumentRenderer
          ref="editorRef"
          :modelValue="store.doc"
          :mode="viewMode"
          :page-breaks="pagination.pageBreaks"
          :word-count="wordCount"
          :theme="theme.editorTheme"
          :zoom="theme.editorZoom"
          :margin="theme.editorMargin"
          :toc-items="nav.tocItems"
          @sync-sections="store.syncSections"
          @sync-section="store.syncSection"
          @delete-section="store.deleteSection"
          @update="store.markModified()"
          v-else-if="store.doc"
        />
      </div>
    </div>

    <Toolbar
      :mode="viewMode"
      :right-open="rightDrawerOpen"
      @toggle-right="toggleRightDrawer"
      @set-mode="onSetMode($event)"
      @go-to-top="onGoToTop"
    />

    <SearchPanel
      :visible="search.searchVisible"
      v-model:query="search.searchQuery"
      v-model:replace-text="search.searchReplace"
      v-model:show-replace="search.searchShowReplace"
      :match-count="search.searchMatchCount"
      :current-index="search.searchCurrentIndex"
      @find-next="search.onSearchNext"
      @find-prev="search.onSearchPrev"
      @replace="onSearchReplace"
      @replace-all="onSearchReplaceAll"
      @close="search.closeSearch"
    />

    <StatusBar
      :title="store.doc?.title || 'Untitled'"
      :save-status="saveStatus"
      :theme="theme.editorTheme"
      :themes="theme.themes"
      :show-theme-picker="theme.showThemePicker"
      :word-count="wordCount"
      :selected-word-count="format.selectedWordCount"
      @open-file="fileIO.openFile"
      @save-file="fileIO.saveFile"
      @save-file-as="fileIO.saveFileAs"
      @new-file="onNewFile"
      @import-file="fileIO.importFile"
      @export-plain-text="exportComposable.exportPlainText"
      @export-markdown="exportComposable.exportMarkdown"
      @export-docx="exportComposable.exportDocx"
      @toggle-theme-picker="theme.showThemePicker = !theme.showThemePicker"
      @select-theme="theme.selectTheme"
    />

    <!-- Toast notifications overlay. Mounted once at the root so it sits above
         every drawer, panel, and the status bar. -->
    <Toaster />

    <!-- Name-on-creation prompt (1.8). Custom modal: Tauri v1 has no native
         text-input prompt and window.prompt is blocked in the WKWebView. -->
    <PromptModal
      :visible="showNewDocPrompt"
      title="New Document"
      message="Name your document. This becomes the filename on first save."
      placeholder="Untitled"
      confirm-label="Create"
      @confirm="onConfirmNewDocument"
      @cancel="showNewDocPrompt = false"
    />

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, reactive, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useDocumentStore } from './stores/document.js'
import { useTheme } from './composables/useTheme.js'
import { useSearchPanel } from './composables/useSearchPanel.js'
import { useNavigation } from './composables/useNavigation.js'
import { useFileIO } from './composables/useFileIO.js'
import { useExport } from './composables/useExport.js'
import { useFormat } from './composables/useFormat.js'
import { useSectionFormat } from './composables/useSectionFormat.js'
import { useFocusMode } from './composables/useFocusMode.js'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts.js'
import { useVersionHistory } from './composables/useVersionHistory.js'
import { useLlmSettings } from './composables/useLlmSettings.js'
import { useChatManager } from './composables/useChat.js'
import { useRetrieval } from './composables/useRetrieval.js'
import { useSummaries } from './composables/useSummaries.js'
import { useWordCount } from './composables/useWordCount.js'
import { usePagination } from './composables/usePagination.js'
import { useManuscriptFormat } from './composables/useManuscriptFormat.js'
import { isDrawerModeAllowedIn } from './constants/drawerVisibility.js'
import DocumentRenderer from './components/DocumentRenderer.vue'
import Toolbar from './components/Toolbar.vue'
import StatusBar from './components/StatusBar.vue'
import SearchPanel from './components/SearchPanel.vue'
import NavigationDrawer from './components/NavigationDrawer.vue'
import GeneralOptionsDrawer from './components/GeneralOptionsDrawer.vue'
import TextOptionsDrawer from './components/TextOptionsDrawer.vue'
import HistoryListDrawer from './components/HistoryListDrawer.vue'
import HistoryView from './components/HistoryView.vue'
import ActivityBar from './components/ActivityBar.vue'
import LlmPanel from './components/LlmPanel.vue'
import Toaster from './components/Toaster.vue'
import PromptModal from './components/PromptModal.vue'

const store = useDocumentStore()
const { doc } = storeToRefs(store)

const editorRef = ref(null)
// The scroll container that wraps the editor/manuscript (it scrolls, not the
// views themselves — see the .scroll-layer CSS). Used by onGoToTop to jump the
// manuscript back to its title page.
const scrollLayerRef = ref(null)
const viewMode = ref('editor')
const leftDrawerOpen = ref(false)
const leftDrawerMode = ref('chapters')
const rightDrawerOpen = ref(false)
const addExpanded = ref(false)
// Name-on-creation (1.8): the New action opens this prompt modal so a document
// is named before its first save. Tauri v1 has no native text-input prompt and
// `window.prompt` is blocked in the WKWebView, so this is a custom modal.
const showNewDocPrompt = ref(false)

// How often autosave journals a delta to the on-disk history sidecar. The
// store's autosaveDocument bails when there's no lastPath or nothing modified,
// so this fires harmlessly while idle. Explicit save writes the .rite; this
// interval only feeds the crash-recovery history between saves.
const AUTOSAVE_INTERVAL_MS = 30_000
let autosaveTimer = null

const theme = reactive(useTheme(viewMode))
const search = reactive(useSearchPanel(editorRef, viewMode))
// Keep the RAW composable results for factories that need to read refs via
// `.value` (useChat reads llmSettings.settings.value.* and
// nav.selectedNavId.value). The reactive-wrapped versions go to the
// templates/components, which see auto-unwrapped values (no `.value`).
// Both share the same underlying object — `reactive()` returns a proxy of the
// same object, not a copy — so edits via the reactive proxy (e.g. the drawer's
// setSettings, or the nav drawer setting selectedNavId) are seen by useChat's
// raw refs, and vice versa.

// Manuscript page format (Standard / Shunn / A4). Loaded from prefs HERE, in
// setup and BEFORE the shared pagination instance below runs its first
// (immediate) measure — otherwise the first measure would use the default
// format and re-measure a moment later once the pref loaded. useManuscriptFormat
// is a module-level singleton, so usePagination (called next) and manuscriptPage
// read the same already-loaded instance. Wrapped in reactive() so the options
// drawer prop sees auto-unwrapped values (e.g. `manuscriptFormat.format` is the
// preset object, not a computed ref) — same pattern as `nav`/`theme`.
const manuscriptFormat = reactive(useManuscriptFormat())
manuscriptFormat.loadPrefs()

// THE single shared pagination instance (roadmap 2.5). Previously
// usePagination ran in THREE places — the editor, the manuscript, AND
// useNavigation — each with its own cold per-section measurement cache, so
// every view switch remounted a view whose cache was empty and re-measured the
// whole document offscreen (the multi-second "calculating pages" lag), and the
// three could disagree on timing. Now one instance lives here, watches the
// store doc once, and its `pageBreaks` / `getPageForBlock` are passed down to
// the views and nav. A view switch no longer triggers any measurement — the
// shared cache is already warm — and page numbers agree by construction.
const paginationRaw = usePagination(doc)
const pagination = reactive(paginationRaw)

const navRaw = useNavigation(doc, editorRef, paginationRaw)
const nav = reactive(navRaw)
const fileIO = useFileIO()
const exportComposable = useExport()
const format = reactive(useFormat(editorRef, store.markModified.bind(store)))
const sectionFormat = reactive(useSectionFormat())
const history = reactive(useVersionHistory(store))
const llmSettingsRaw = useLlmSettings()
const llmSettings = reactive(llmSettingsRaw)
// Multi-chat: the manager owns the tab list + roles + the one-at-a-time
// `anyBusy`. Each tab is its own `useChat` session; `activeSession` is the
// selected one, passed to LlmPanel exactly as the single `chat` used to be.
const chatManager = reactive(useChatManager(doc, llmSettingsRaw, navRaw, editorRef))
// Manuscript index for RAG (Phase 4.3): keeps Rust's in-memory vector store
// current by watching `store.docVersion` (debounced 1500ms) when the index is
// enabled. Takes the RAW llm-settings composable (reads `settings.value.*`,
// like useChatManager) and the Pinia store (for `docVersion`). Wrapped in
// reactive() so the drawer's status readout auto-unwraps its ref members. The
// status is passed to GeneralOptionsDrawer; retrieval itself is wired into the
// chat context in 4.4.
const retrieval = reactive(useRetrieval(store, llmSettingsRaw))

// Phase 4.8 semantic-summary generation. Mirrors `retrieval` (the 4.3
// embeddings trigger): the composable owns generation state + the status
// readout, wired into GeneralOptionsDrawer. `summariesBusy` is OR'd into the
// LLM panel's busy gate below so Send is disabled during generation. Uses the
// RAW llm-settings composable (reads `settings.value.*`, like useChat/
// useRetrieval). Wrapped in `reactive()` so the drawer readout auto-unwraps.
const summaries = reactive(useSummaries(store, llmSettingsRaw))

// Whole-document word count. THE single instance (mirrors the shared-
// pagination lift): the status bar reads it here, and the manuscript title
// page reads the SAME count passed down as a prop (via DocumentRenderer), so
// there is no per-view recompute and no "0 words" blink on view switch. The
// initial count is computed synchronously (no 0→real blink on first paint);
// subsequent typing bursts are debounced (see useWordCount) so a keystroke
// burst coalesces into one O(document) tally ~300ms after typing stops.
const { wordCount } = useWordCount(doc)

// Save indicator for the status bar. The underlying state (saveState /
// lastSavedAt) lives in the document store and is driven by BOTH file-write
// paths — explicit save and the background autosave (which rewrites the whole
// .rite, not just journals history). Here we only format it into a label.
//
// `now` is a ref bumped on a coarse 15s ticker so the "Saved 2m ago" relative
// label drifts forward without re-running anything in the store. The computed
// only reads `now.value` in the branch that shows a relative time, so while
// the doc is Edited / Saving / Save-failed the ticker does NOT retrigger the
// computed — no wasted recomputes while idle-but-unsaved. (This is Vue's
// reactive dependency tracking: a computed only depends on the refs it
// actually accesses during evaluation, so untaken branches cost nothing.)
const now = ref(Date.now())
let clockTimer = null

function relativeTime(timestamp, currentMilliseconds) {
  const seconds = Math.floor((currentMilliseconds - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const saveStatus = computed(() => {
  if (store.saveState === 'saving') return 'Saving…'
  if (store.saveState === 'error') return 'Save failed'
  // Pending edits take priority over the "Saved Xm ago" label — the writer
  // cares that their latest typing is NOT yet on disk. Replaces the old binary
  // `*` modifier on the title.
  if (store.isModified) return 'Edited'
  if (store.lastSavedAt) return `Saved ${relativeTime(store.lastSavedAt, now.value)}`
  // A doc opened from disk matches memory but was never written this session:
  // bare "Saved" with no relative time.
  if (store.lastPath) return 'Saved'
  return ''
})


// Chrome gate (S-009 / SPEC drawer rule): while focus / typewriter mode is
// active no drawer may open — a drawer coming up would defeat the whole mode.
// Every drawer-OPEN path routes through one of these two helpers; CLOSING
// stays unconditional everywhere (only opening is refused while active).
function openLeftDrawer(mode) {
  if (!focusMode.canOpenDrawer()) return
  leftDrawerMode.value = mode
  leftDrawerOpen.value = true
}

function toggleRightDrawer() {
  if (rightDrawerOpen.value) { rightDrawerOpen.value = false; return }
  if (!focusMode.canOpenDrawer()) return
  rightDrawerOpen.value = true
}

function onActivitySelect(mode) {
  if (leftDrawerOpen.value && leftDrawerMode.value === mode) {
    leftDrawerOpen.value = false
  } else {
    openLeftDrawer(mode)
  }
}

// Toolbar view-mode switch (Editor / Manuscript / History). History is a full
// view, not a drawer mode: entering it opens the version-list drawer and loads
// the history sidecar; clicking History while already in the view toggles the
// list drawer. Leaving History closes the list drawer so it does not linger
// over the editor.
//
// Editor ↔ Manuscript switches PRESERVE THE PAGE NUMBER, not the scroll pixel
// (5.1b). The old behavior just flipped viewMode and let the shared
// `.scroll-layer` keep its scrollTop in pixels — but a dense contenteditable
// and a 960px-page manuscript disagree about how far a pixel travels, so the
// same pixel offset landed the manuscript on a different page than the editor
// (the user's "pg 20 → pg 29" drift). Now the outgoing view reports the page
// it's currently showing (getCurrentPage), and after the flip + a nextTick the
// incoming view scrolls to that same number. Because pagination is ONE shared
// instance (Fix 1, roadmap 2.5), the same number is the same content in both
// views. We capture the page BEFORE flipping so we read it from the outgoing
// view's DOM; reading after the flip would query the half-mounted incoming
// view and get garbage. nextTick waits for the incoming view to mount before
// we scroll it.
function onSetMode(mode) {
  if (mode === 'history') {
    if (viewMode.value === 'history') {
      // Already in the History view: the tab is view-switch-only (Scheme A).
      // The version-list drawer is toggled by the in-header Versions button
      // (onToggleVersions) and closed by Escape — not by re-clicking the tab.
      return
    }
    viewMode.value = 'history'
    // The gate is consulted AFTER the viewMode assignment: useFocusMode's
    // sync-flush watcher exits the mode as this assignment lands, so the
    // history versions drawer still opens on the way into the History view.
    openLeftDrawer('history')
    history.loadHistory()
    return
  }
  // Close an open drawer whose button vanishes in the target view (Scheme A:
  // ActivityBar buttons are view-aware via isDrawerModeAllowedIn). Without
  // this, switching Editor→Manuscript with Text Options open would leave the
  // drawer open with no handle to close it. 'history' is never in the allowed
  // map, so this also closes the version list when leaving the History view —
  // replacing the old history-specific close. leftDrawerMode is left as-is:
  // harmless once the drawer is closed, and the button reappears on return to
  // a view where it applies.
  if (leftDrawerOpen.value && !isDrawerModeAllowedIn(leftDrawerMode.value, mode)) {
    leftDrawerOpen.value = false
  }

  // Only editor ↔ manuscript needs page preservation. History has no page
  // scroll to preserve, and anything → editor from history should just land
  // where the editor last was (the editor never unmounted during a pure
  // editor→manuscript→editor round-trip when history wasn't involved, but it
  // does unmount for history; restoring its page from history's page makes no
  // sense). So capture/restore only when BOTH the outgoing and incoming views
  // are one of {editor, manuscript}.
  const pageable = new Set(['editor', 'manuscript'])
  const isPageableSwitch =
    pageable.has(viewMode.value) && pageable.has(mode) && viewMode.value !== mode

  let pendingPage = 1
  if (isPageableSwitch) {
    pendingPage = editorRef.value?.getCurrentPage?.() ?? 1
  }

  viewMode.value = mode

  if (isPageableSwitch) {
    nextTick(() => {
      editorRef.value?.scrollToPage?.(pendingPage)
    })
  }
}

// Toggle the version-list drawer from the History view's in-header Versions
// button (Scheme A). Mirrors onActivitySelect's logic for a hypothetical
// 'history' ActivityBar item: if the list is the current drawer, flip it; if
// another drawer displaced it (e.g. General Options opened from History),
// switch back to the version list + open it.
function onToggleVersions() {
  if (leftDrawerMode.value === 'history' && leftDrawerOpen.value) {
    // The list is up: unconditional close (the gate never blocks a close).
    leftDrawerOpen.value = false
    return
  }
  // Opening the list — the drawer is shut, or another drawer displaced it —
  // goes through the focus-mode gate (S-009).
  openLeftDrawer('history')
}

// Nav-link scroll. View-aware (5.1): stay in the CURRENT view when a chapter is
// clicked — clicking Chapter 4 in the manuscript keeps you in the manuscript
// at Chapter 4 instead of yanking you to the editor. The one exception is
// History: it has no editor/manuscript to scroll within, so a nav click from
// History forces the editor (the original behavior) so the section is
// actually visible.
function onScrollTo(id) {
  const forceEditor = viewMode.value === 'history'
  nav.scrollToSection(id, forceEditor ? () => { viewMode.value = 'editor' } : undefined)
}

// Manuscript "Go to top" button (5.1b). The manuscript's first page is the
// title page (front matter), which sits at the very top of the scroll-layer —
// so going to the top is just scrolling the layer back to scrollTop 0, not
// scrolling to "content page 1" (which would skip the title/TOC). The
// button only shows in manuscript mode (Toolbar.vue), but the handler is safe
// in any mode.
function onGoToTop() {
  const layer = scrollLayerRef.value
  if (!layer) return
  layer.scrollTo({ top: 0, behavior: 'smooth' })
}

// Insert is local to the editor (decision 2): force editor view, then ask the
// editor to splice a new section after the nav-selected section (or the cursor's
// section) and focus its title for inline editing. No async round-trip.
function onInsertSection(sectionType) {
  viewMode.value = 'editor'
  nextTick(() => {
    editorRef.value?.insertSection?.(sectionType, nav.selectedNavId)
  })
  addExpanded.value = false
}

function onSearchReplace() {
  search.onSearchReplace()
}

function onSearchReplaceAll() {
  search.onSearchReplaceAll()
}

// Open the General Options drawer to the AI Assistant section (called by the
// LlmPanel empty state when no model is configured).
function openGeneralOptions() {
  openLeftDrawer('general-options')
}

// Start a new document (1.8). First the save-before guard (useFileIO.newFile
// offers to save real unsaved content, identical check to importFile), then the
// name-prompt modal. The name is collected AFTER the guard so we don't prompt
// for a name and then throw it away if the user cancels the save dialog.
async function onNewFile() {
  await fileIO.newFile()
  showNewDocPrompt.value = true
}

// User confirmed a name in the prompt modal → build the fresh named document.
async function onConfirmNewDocument(name) {
  showNewDocPrompt.value = false
  await store.newDocument(name)
}

// Focus / typewriter mode (5.3). One shared shell instance: the keyboard
// shortcuts toggle/exit/recentre through it, the root element's focus-mode
// class reads `active` (destructured as focusActive so the template
// auto-unwraps the ref), and every drawer-open path consults canOpenDrawer()
// (S-009). State contract: { viewMode, editorRef, leftDrawerOpen,
// rightDrawerOpen } in; { active, toggle, exit, canOpenDrawer, recentre } out.
const focusMode = useFocusMode({ viewMode, editorRef, leftDrawerOpen, rightDrawerOpen })
const { active: focusActive } = focusMode

useKeyboardShortcuts({
  store,
  fileIO,
  format,
  search,
  viewMode,
  leftDrawerOpen,
  leftDrawerMode,
  addExpanded,
  editorRef,
  onInsertSection,
  focusMode,
})

onMounted(async () => {
  theme.loadPrefs()
  sectionFormat.loadPrefs()
  format.loadPrefs()
  llmSettings.loadPrefs()
  document.execCommand('styleWithCSS', false, true)
  await store.loadInitialDocument()

  autosaveTimer = setInterval(() => { store.autosaveDocument() }, AUTOSAVE_INTERVAL_MS)
  // Coarse tick so the "Saved Xm ago" label refreshes. 15s is well below the
  // smallest displayed unit ("Xs ago" only shows for the first minute), so the
  // label never feels stale during active writing without re-running per
  // keystroke.
  clockTimer = setInterval(() => { now.value = Date.now() }, 15_000)
})

onUnmounted(() => {
  if (autosaveTimer) clearInterval(autosaveTimer)
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<style scoped>
.app-container {
  position: relative;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

/* Drawers — App.vue owns the right drawer (the Assistant panel). The two left
   option drawers each own their own scoped copy of the .drawer base styles
   (see GeneralOptionsDrawer.vue / TextOptionsDrawer.vue, following the
   NavigationDrawer.vue precedent). The right drawer is wider (400px) to give
   the chat/analysis surface room to breathe. */
.drawer {
  position: fixed;
  top: 38px;
  bottom: 36px;
  width: 400px;
  transition: transform 0.25s ease;
  z-index: 25;
}

.drawer.right {
  /* Slide via `right` (a layout property), NOT `transform`. The right drawer
     is the only drawer that also shifts the editor's right padding (so the
     text stays selectable for chat context). Animating the drawer with a GPU
     `transform` while the padding reflows on the main thread makes the two
     drift by a few frames — the dark editor gutter flashes in the gap, which
     reads as a black trail as the drawer closes. `right` and `padding-right`
     are both layout transitions, so the browser updates them atomically in one
     layout pass: the drawer's left edge and the paper's right edge stay
     touching frame-for-frame, no gap, no trail. (The left drawers keep
     `transform` — they have no padding to sync against.) */
  right: -400px;
  transition: right 0.25s ease;
}

.drawer.right.open {
  right: 0;
}

.drawer-content {
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  background: var(--glass-bg);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border-right: 1px solid var(--bg-glass-border);
}

.drawer-content.right-drawer {
  border-right: none;
  border-left: 1px solid var(--bg-glass-border);
  /* The LlmPanel manages its own internal scroll (message list) + a pinned
     input row, so the drawer itself should not also scroll — it fills height. */
  display: flex;
  flex-direction: column;
}

.drawer-section {
  margin-bottom: 20px;
}

.drawer-empty {
  font-size: 13px;
  color: var(--text-secondary);
  opacity: 0.6;
}

/* Scroll layer */
.scroll-layer {
  height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  padding-top: 38px;
  padding-bottom: 36px;
  padding-left: 48px;
  /* Animate the right padding so the editor slides with the Assistant drawer
     instead of snapping when it opens/closes (matches the drawer's 0.25s). */
  transition: padding-right 0.25s ease;
}

/* When the Assistant (right) drawer is open, pull the editor content in so the
   right edge of the text stays visible and selectable for chat context — the
   drawer would otherwise overlay it. The left drawer is intentionally left
   unpadded (it overlays the editor). */
.scroll-layer.right-pad {
  padding-right: 400px;
}

.scroll-layer.mode-editor {
  background: v-bind(theme.uiScrollBg);
}

.scroll-layer.mode-manuscript {
  background: var(--bg-base);
}

.editor-wrapper {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.editor-wrapper.mode-editor {
  padding: 0;
}

.editor-wrapper.mode-manuscript {
  align-items: center;
  padding: 20px 0 40px;
}

/* Focus / typewriter mode (5.3) — hide the chrome and let the sheet span
   the full width. The bars vanish entirely (display none, not opacity, so
   the e2e layer sees them hidden); the scroll layer loses its left-rail
   offset, which is what left the text indented with the activity bar gone. */
.app-container.focus-mode :deep(.toolbar),
.app-container.focus-mode :deep(.statusbar),
.app-container.focus-mode :deep(.activity-bar) {
  display: none;
}
.app-container.focus-mode .scroll-layer {
  padding-left: 0;
}
.app-container.focus-mode .scroll-layer.right-pad {
  padding-right: 0;
}

</style>

<style>
.search-highlight {
  background: rgba(255, 215, 0, 0.35);
  border-radius: 2px;
}

.search-current {
  background: rgba(255, 165, 0, 0.55);
  border-radius: 2px;
}

.mode-manuscript .search-highlight {
  background: rgba(255, 180, 0, 0.35);
}

.mode-manuscript .search-current {
  background: rgba(255, 120, 0, 0.55);
}
</style>
