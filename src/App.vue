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
    <a
      href="#editor-sheet"
      class="skip-link"
      @click.prevent="onSkipLinkActivate"
    >Skip to manuscript</a>

    <ActivityBar
      ref="activityBarRef"
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
    <!-- Stats drawer (5.4): App.vue owns the chrome because the StatsDrawer
         component is the bare view (its props/emit are pinned by
         StatsDrawer.spec.js). Shares the .drawer / .drawer-content base styles
         already in this file. -->
    <div class="drawer stats" :class="{ open: leftDrawerOpen && leftDrawerMode === 'stats' }">
      <div class="drawer-content">
        <StatsDrawer
          :written="stats.writtenToday"
          :target="stats.target"
          @set-target="stats.setTarget($event)"
        />
      </div>
    </div>
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

    <div class="scroll-layer" role="main" ref="scrollLayerRef" :class="['mode-' + viewMode, { 'right-pad': rightDrawerOpen }]" @click="nav.selectedNavId = null">
      <div class="editor-wrapper" :class="'mode-' + viewMode">
        <HistoryView
          v-if="viewMode === 'history'"
          :history="history"
          :versions-open="leftDrawerOpen && leftDrawerMode === 'history'"
          @back="onSetMode('editor')"
          @toggle-versions="onToggleVersions"
        />
        <!-- References is a working view: its surface paints from the same
             currentTheme the editor sheet binds, not the glass chrome
             (S-022). -->
        <ReferencesView
          v-else-if="viewMode === 'references'"
          :store="store"
          :theme="theme.currentTheme"
          :tab="referencesTab"
          :summaries="summaries"
          :settings="llmSettings"
          :notes-entry-id="notesEntryId"
          :notes-origin-view="notesOriginView"
          @update:tab="referencesTab = $event"
          @jump="onReferencesJump"
        />
        <DocumentRenderer
          ref="editorRef"
          :modelValue="store.doc"
          :mode="viewMode"
          :page-breaks="pagination.pageBreaks"
          :word-count="wordCount"
          :theme="theme.currentTheme"
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
      :file-name="fileName"
      :save-status="saveStatus"
      :word-count="wordCount"
      :selected-word-count="format.selectedWordCount"
    />

    <!-- Thesaurus popover (5.11). Anchored at the right-click point; mounted
         once, outside the editor, because the takeover listener lives on
         `document` — the editor sheet itself is untouched. -->
    <ThesaurusPopover
      :visible="thesaurus.state.open"
      :word="thesaurus.state.word"
      :senses="thesaurus.state.senses"
      :loading="thesaurus.state.loading"
      :error="thesaurus.state.error"
      :x="thesaurus.state.x"
      :y="thesaurus.state.y"
      @apply="thesaurus.apply"
      @cancel="thesaurus.close"
    />

    <!-- Toast notifications overlay. Mounted once at the root so it sits above
         every drawer, panel, and the status bar. -->
    <Toaster />

    <!-- Name-on-creation prompt (1.8). Custom modal: Tauri v1 has no native
         text-input prompt and window.prompt is blocked in the WKWebView. -->
    <PromptModal
      :visible="newDocument.showPrompt"
      title="New Document"
      message="Name your document. This becomes the filename on first save."
      placeholder="Untitled"
      confirm-label="Create"
      @confirm="newDocument.onConfirm"
      @cancel="newDocument.onCancel"
    />

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, reactive, nextTick, toRef, watch } from 'vue'
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
import { createMenuActions, useMenuActions } from './composables/useMenu.js'
import { noteDraftUndo } from './composables/useNotes.js'
import { useThesaurus } from './composables/useThesaurus.js'
import { useNewDocument } from './composables/useNewDocument.js'
import { useVersionHistory } from './composables/useVersionHistory.js'
import { useLlmSettings } from './composables/useLlmSettings.js'
import { useChatManager } from './composables/useChat.js'
import { useRetrieval } from './composables/useRetrieval.js'
import { useSummaries } from './composables/useSummaries.js'
import { useWordCount } from './composables/useWordCount.js'
import { useWritingStats } from './composables/useWritingStats.js'
import { usePagination } from './composables/usePagination.js'
import { useManuscriptFormat } from './composables/useManuscriptFormat.js'
import { usePointerModality } from './composables/usePointerModality.js'
import { isDrawerModeAllowedIn } from './constants/drawerVisibility.js'
import DocumentRenderer from './components/DocumentRenderer.vue'
import Toolbar from './components/Toolbar.vue'
import StatusBar from './components/StatusBar.vue'
import SearchPanel from './components/SearchPanel.vue'
import NavigationDrawer from './components/NavigationDrawer.vue'
import GeneralOptionsDrawer from './components/GeneralOptionsDrawer.vue'
import TextOptionsDrawer from './components/TextOptionsDrawer.vue'
import StatsDrawer from './components/StatsDrawer.vue'
import HistoryListDrawer from './components/HistoryListDrawer.vue'
import HistoryView from './components/HistoryView.vue'
import ReferencesView from './components/ReferencesView.vue'
import ActivityBar from './components/ActivityBar.vue'
import LlmPanel from './components/LlmPanel.vue'
import Toaster from './components/Toaster.vue'
import PromptModal from './components/PromptModal.vue'
import ThesaurusPopover from './components/ThesaurusPopover.vue'

const store = useDocumentStore()
const { doc } = storeToRefs(store)

// Computed over the store getter, so the context build sees the live record
// when a tab sends. A snapshot would go stale after a swap.
const notesRef = computed(() => store.notes)

const editorRef = ref(null)
// The scroll container that wraps the editor/manuscript (it scrolls, not the
// views themselves — see the .scroll-layer CSS). Used by onGoToTop to jump the
// manuscript back to its title page.
const scrollLayerRef = ref(null)
const viewMode = ref('editor')
const notesEntryId = ref('overview')
// App owns the References tab selection so it survives a view switch
// (SPEC.md 5.20 wiring decision 2, unit S-004/S-005 contract).
const referencesTab = ref('outline')
// Remembered when References is entered: the view the section jump returns to
// (SPEC.md 5.20). From History the default is the editor.
const notesOriginView = ref('editor')
const leftDrawerOpen = ref(false)
const leftDrawerMode = ref('chapters')
const rightDrawerOpen = ref(false)
const addExpanded = ref(false)
// The ActivityBar instance — needed for S-017: Escape that closes a drawer
// returns focus to the icon button that had opened it (focusItem is exposed
// by ActivityBar).
const activityBarRef = ref(null)

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
// Name-on-creation (1.8): the New action runs the save-before guard
// (useFileIO.newFile) and then opens the prompt modal so a document is named
// before its first save. Tauri v1 has no native text-input prompt and
// `window.prompt` is blocked in the WKWebView, so this is a custom modal.
const newDocument = reactive(useNewDocument({ fileIO, store }))
// reactive() here is load-bearing, not style: setup only auto-unwraps top-level
// bindings, so on a plain object the template's `newDocument.showPrompt` would
// receive the raw Ref — always truthy — and pin the prompt modal open.

// The native menu's single event sink (1.9): Rust emits a `menu` window event
// whose payload is the item id and this map runs the matching action. Called
// in setup so the `listen` registration lands during app load.
// Thesaurus (5.11): the document-level contextmenu listener decides whether a
// right-click belongs to the app; if it does, Rust pops the one-item word menu
// and its activation arrives through the same `menu` event as every other item.
const thesaurus = reactive(useThesaurus())
const menuActions = createMenuActions({
  store,
  fileIO,
  exports: exportComposable,
  newDocument,
  thesaurus,
  // Undo/redo consult the note draft before the store (useNotes.js, S-026).
  notesDraft: noteDraftUndo,
})
useMenuActions(menuActions)
const format = reactive(useFormat(editorRef, store.markModified.bind(store)))
const sectionFormat = reactive(useSectionFormat())
const history = reactive(useVersionHistory(store))
const llmSettingsRaw = useLlmSettings()
const llmSettings = reactive(llmSettingsRaw)
// Multi-chat: the manager owns the tab list + roles + the one-at-a-time
// `anyBusy`. Each tab is its own `useChat` session; `activeSession` is the
// selected one, passed to LlmPanel exactly as the single `chat` used to be.
const chatManager = reactive(useChatManager(doc, llmSettingsRaw, navRaw, editorRef, notesRef))
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

// 5.4 writing stats: one instance at the app root. The drawer is a bare view
// over today's progress: numbers flow down as props, 'set-target' back up.
// docRef is the SAME store doc ref useWordCount reads below (the status bar
// and the Stats item cannot disagree — S-011); docKey follows the saved path
// so each manuscript owns its day-start baseline (S-008).
const stats = reactive(useWritingStats({
  docRef: doc,
  docKey: computed(() => store.lastPath),
}))

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

// SPEC decision 7: the status bar shows the file's basename (extension
// included, e.g. `novel.rite`), never the full path, and nothing while the
// document has never been saved.
const fileName = computed(() => store.lastPath ? store.lastPath.split(/[\\/]/).pop() : '')


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
  if (mode === 'references') {
    // References opens on the caret section (S-015), or on the section
    // starting the manuscript page at the top (S-016). Any other source opens
    // the overview. The seed rides entering References. The notes tab consumes
    // it on its first mount. DocumentRenderer routes getCurrentSectionId to
    // the active view, so the editor and the manuscript both seed here. The
    // branch runs before the viewMode assignment below, so viewMode.value is
    // still the source view. The origin is remembered for the return jump
    // (onNotesJump). From History it falls back to the editor.
    const source = viewMode.value
    notesOriginView.value = source === 'manuscript' ? 'manuscript' : 'editor'
    notesEntryId.value =
      source === 'editor' || source === 'manuscript'
        ? (editorRef.value?.getCurrentSectionId?.() || 'overview')
        : 'overview'
  }
  // Entering the manuscript needs the breaks before its first render; the sync
  // API skips the 300ms debounce. Without it a just-loaded document renders as
  // one giant clipped page, and every scroll target below page 2 clamps short
  // of its section. A warm re-entry reuses the per-section cache, so is cheap.
  if (mode === 'manuscript' && viewMode.value !== 'manuscript') {
    paginationRaw.calculateBreaks()
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

// Section jump from a Notes entry (SPEC.md 5.17): the jump returns to the
// view the writer came from. nav.scrollToSection switches the view (the
// callback runs before its scroll) then nextTick-scrolls the active inner
// view. The callback must not go through onSetMode; that would run the notes
// branch again and re-seed the entry id.
function onNotesJump(sectionId) {
  if (!sectionId) return
  const targetView = notesOriginView.value === 'manuscript' ? 'manuscript' : 'editor'
  nav.scrollToSection(sectionId, () => { viewMode.value = targetView })
}

// Jump from a References tab (SPEC.md 5.20 wiring decision 6). The notes tab
// routes through onNotesJump, back to notesOriginView. The outline tab opens
// the section in the editor, the same route a note's Go to section uses.
function onReferencesJump(sectionId) {
  if (!sectionId) return
  if (referencesTab.value === 'notes') {
    onNotesJump(sectionId)
    return
  }
  nav.scrollToSection(sectionId, () => { viewMode.value = 'editor' })
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

// S-017: return focus to the icon button that opened the current drawer. The
// current leftDrawerMode is the id both the drawer and its ActivityBar button
// share, so no label/title lookup is needed; a no-op when the bar or the
// target button is absent (e.g. 'history', which has no drawer icon).
function focusDrawerOpener() {
  activityBarRef.value?.focusItem?.(leftDrawerMode.value)
}

// Resolve the sheet the way useFocusMode.js resolves it, so both paths land
// on the same element.
function onSkipLinkActivate() {
  const el = editorRef.value?.$el
  if (!el) return
  const sheet = el.classList?.contains('editor-sheet') ? el : el.querySelector?.('.editor-sheet')
  sheet?.focus()
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
  // Escape must also close the theme picker tooltip (SPEC 5.7). Chain
  // order is search → theme picker → drawer → focus mode. `theme` above is
  // a reactive() proxy, so `theme.showThemePicker` inline unwraps to a
  // boolean snapshot; toRef keeps a live ref, which is what the composable
  // reads via `.value`. `close` mirrors what a swatch click already does:
  // useTheme.selectTheme clears the same underlying ref.
  themePicker: {
    open: toRef(theme, 'showThemePicker'),
    close: () => { theme.showThemePicker = false },
  },
  viewMode,
  leftDrawerOpen,
  leftDrawerMode,
  addExpanded,
  editorRef,
  onInsertSection,
  // S-017: Escape that closes a drawer gives focus back to its opener.
  focusDrawerOpener,
  focusMode,
})

usePointerModality()

onMounted(async () => {
  theme.loadPrefs()
  sectionFormat.loadPrefs()
  format.loadPrefs()
  llmSettings.loadPrefs()
  document.execCommand('styleWithCSS', false, true)
  await store.loadInitialDocument()
  await store.retrieveNotes()

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

// Opening a document installs that file's notes in Rust (loadDocument sets
// lastPath), so lastPath is the trigger to re-read them (SPEC.md 5.17).
watch(() => store.lastPath, () => { store.retrieveNotes() })
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
  /* S-018: a closed drawer keeps its slide animation but leaves the tab
     order — visibility flips to hidden 0.25s AFTER the close starts (the
     slide stays on screen) and back to visible instantly on open. The same
     pattern lives in every drawer style home (Navigation/General/Text/
     HistoryList and this file); keep the values identical. */
  visibility: hidden;
  transition: transform 0.25s ease, visibility 0s linear 0.25s;
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
  transition: right 0.25s ease, visibility 0s linear 0.25s;
}

.drawer.right.open {
  right: 0;
  /* S-018: slide via `right`, so the open transition clears the visibility
     delay too (the base's transform flip never runs for this drawer). */
  visibility: visible;
  transition: right 0.25s ease, visibility 0s;
}

/* Stats drawer (5.4): a left drawer like Sections/General/Text, but with an
   exclusive class so the chrome here stays App-scoped (the four sibling left
   drawers each own a scoped copy of their styles). */
.drawer.stats {
  left: 48px;
  transform: translateX(-100%);
  width: 260px;
}

.drawer.stats.open {
  transform: translateX(0);
  /* S-018: visibility open state — same pattern as the four left drawers. */
  visibility: visible;
  transition: transform 0.25s ease, visibility 0s;
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

/* Skip link (S-003): a 1x1 box out of the flow until focused, then a real
   box at the top-left. The test reads the box right after focus, so no
   transition on the link. */
.skip-link {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  background: var(--glass-bg);
  color: var(--text-primary);
  font-size: 14px;
  text-decoration: none;
}

.skip-link:focus {
  top: 8px;
  left: 8px;
  width: auto;
  height: auto;
  overflow: visible;
  clip-path: none;
  padding: 10px 16px;
  border: 1px solid var(--bg-glass-border);
  border-radius: var(--radius-sm);
  /* Above the toolbar and the drawers, below the toast layer. */
  z-index: 30;
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
