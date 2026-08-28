<template>
  <div class="app-container"
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
      @delete-item="nav.deleteSection"
      @select="nav.selectedNavId = $event"
    />

    <GeneralOptionsDrawer
      :open="leftDrawerOpen && leftDrawerMode === 'general-options'"
      :store="store"
      :section-format="sectionFormat"
      :llm-settings="llmSettings"
    />
    <TextOptionsDrawer
      :open="leftDrawerOpen && leftDrawerMode === 'text-options'"
      :theme="theme"
      :format="format"
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
          :chat="chat"
          :settings="llmSettings"
          @open-settings="openGeneralOptions"
        />
      </div>
    </div>

    <div class="scroll-layer" :class="['mode-' + viewMode, { 'left-pad': leftDrawerOpen, 'right-pad': rightDrawerOpen }]" @click="nav.selectedNavId = null">
      <div class="editor-wrapper" :class="'mode-' + viewMode">
        <HistoryView
          v-if="viewMode === 'history'"
          :history="history"
          @back="onSetMode('editor')"
        />
        <DocumentRenderer
          ref="editorRef"
          :modelValue="store.doc"
          :mode="viewMode"
          :theme="theme.editorTheme"
          :zoom="theme.editorZoom"
          :margin="theme.editorMargin"
          :toc-items="nav.tocItems"
          @sync-sections="store.syncSections"
          @delete-section="store.deleteSection"
          @update="store.markModified()"
          v-else-if="store.doc"
        />
      </div>
    </div>

    <Toolbar
      :mode="viewMode"
      :right-open="rightDrawerOpen"
      @toggle-right="rightDrawerOpen = !rightDrawerOpen"
      @set-mode="onSetMode($event)"
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
      :modified="store.isModified"
      :theme="theme.editorTheme"
      :themes="theme.themes"
      :show-theme-picker="theme.showThemePicker"
      :word-count="wordCount"
      :selected-word-count="format.selectedWordCount"
      @open-file="fileIO.openFile"
      @save-file="fileIO.saveFile"
      @import-file="fileIO.importFile"
      @toggle-theme-picker="theme.showThemePicker = !theme.showThemePicker"
      @select-theme="theme.selectTheme"
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
import { useFormat } from './composables/useFormat.js'
import { useSectionFormat } from './composables/useSectionFormat.js'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts.js'
import { useVersionHistory } from './composables/useVersionHistory.js'
import { useLlmSettings } from './composables/useLlmSettings.js'
import { useChat } from './composables/useChat.js'
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

const store = useDocumentStore()
const { doc, isModified } = storeToRefs(store)

const editorRef = ref(null)
const viewMode = ref('editor')
const leftDrawerOpen = ref(false)
const leftDrawerMode = ref('chapters')
const rightDrawerOpen = ref(false)
const addExpanded = ref(false)

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
const navRaw = useNavigation(doc, editorRef)
const nav = reactive(navRaw)
const fileIO = useFileIO()
const format = reactive(useFormat(editorRef, store.markModified.bind(store)))
const sectionFormat = reactive(useSectionFormat())
const history = reactive(useVersionHistory(store))
const llmSettingsRaw = useLlmSettings()
const llmSettings = reactive(llmSettingsRaw)
const chat = reactive(useChat(doc, llmSettingsRaw, navRaw, editorRef))

const wordCount = computed(() => {
  if (!store.doc) return 0
  let count = 0
  for (const section of store.doc.sections || []) {
    for (const p of section.paragraphs || []) {
      for (const el of p.elements) {
        const text = el.textRun.content || ''
        if (text.trim()) count += text.trim().split(/\s+/).length
      }
    }
  }
  return count
})


function onActivitySelect(mode) {
  if (leftDrawerOpen.value && leftDrawerMode.value === mode) {
    leftDrawerOpen.value = false
  } else {
    leftDrawerMode.value = mode
    leftDrawerOpen.value = true
  }
}

// Toolbar view-mode switch (Editor / Manuscript / History). History is a full
// view, not a drawer mode: entering it opens the version-list drawer and loads
// the history sidecar; clicking History while already in the view toggles the
// list drawer. Leaving History closes the list drawer so it does not linger
// over the editor.
function onSetMode(mode) {
  if (mode === 'history') {
    if (viewMode.value === 'history') {
      leftDrawerOpen.value = !leftDrawerOpen.value
    } else {
      viewMode.value = 'history'
      leftDrawerMode.value = 'history'
      leftDrawerOpen.value = true
      history.loadHistory()
    }
    return
  }
  if (viewMode.value === 'history' && leftDrawerMode.value === 'history') {
    leftDrawerOpen.value = false
  }
  viewMode.value = mode
}

function onScrollTo(id) {
  nav.scrollToSection(id, () => { viewMode.value = 'editor' })
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
  leftDrawerMode.value = 'general-options'
  leftDrawerOpen.value = true
}

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
})

onMounted(async () => {
  theme.loadPrefs()
  sectionFormat.loadPrefs()
  format.loadPrefs()
  llmSettings.loadPrefs()
  document.execCommand('styleWithCSS', false, true)
  await store.loadInitialDocument()

  autosaveTimer = setInterval(() => { store.autosaveDocument() }, AUTOSAVE_INTERVAL_MS)
})

onUnmounted(() => {
  if (autosaveTimer) clearInterval(autosaveTimer)
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
  right: 0;
  transform: translateX(100%);
}

.drawer.right.open {
  transform: translateX(0);
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
}

.scroll-layer.left-pad {
  padding-left: 308px;
}

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
