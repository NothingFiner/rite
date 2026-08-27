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
      :paragraphs="store.doc?.body?.content || []"
      :active-id="nav.selectedNavId"
      @scroll-to="onScrollTo"
      @insert-heading="onInsertHeading"
      @rename-section="nav.renameSection"
      @delete-item="nav.deleteHeading"
      @select="nav.selectedNavId = $event"
      ref="navDrawerRef"
    />

    <!-- Left drawer: General Options -->
    <div class="drawer left" :class="{ open: leftDrawerOpen && leftDrawerMode === 'general-options' }">
      <div class="drawer-content">
        <div class="general-options">
          <h3 class="drawer-heading">General Options</h3>

          <!-- Heading Options accordion -->
          <button
            class="accordion-header"
            :class="{ active: expandedSections['heading-options'] }"
            @click="expandedSections['heading-options'] = !expandedSections['heading-options']"
          >
            <span>Heading Options</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ rotated: expandedSections['heading-options'] }">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div v-show="expandedSections['heading-options']" class="accordion-body">
            <div v-for="level in [1, 2, 3, 4, 5, 6]" :key="level" class="heading-level-row">
              <div class="heading-level-label">Level {{ level }}</div>
              <label class="drawer-label">Prefix</label>
              <input
                class="drawer-input"
                :value="headingFormat.headingFormats[level].prefix"
                @input="e => headingFormat.setFormat(level, { prefix: e.target.value })"
              />
              <label class="drawer-label">Numbering</label>
              <select
                class="drawer-input"
                :value="headingFormat.headingFormats[level].numbering"
                @change="e => headingFormat.setFormat(level, { numbering: e.target.value })"
              >
                <option value="none">None</option>
                <option value="arabic">Arabic (1, 2, 3)</option>
                <option value="roman">Roman (I, II, III)</option>
              </select>
              <div class="drawer-check">
                <input
                  :id="'auto-gen-' + level"
                  type="checkbox"
                  :checked="headingFormat.headingFormats[level].autoGenerate"
                  @change="e => headingFormat.setFormat(level, { autoGenerate: e.target.checked })"
                />
                <label :for="'auto-gen-' + level">Auto-generate heading text</label>
              </div>
            </div>
          </div>

          <!-- Document Info accordion -->
          <button
            class="accordion-header"
            :class="{ active: expandedSections['document-info'] }"
            @click="expandedSections['document-info'] = !expandedSections['document-info']"
          >
            <span>Document Info</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ rotated: expandedSections['document-info'] }">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div v-show="expandedSections['document-info']" class="accordion-body">
            <label class="drawer-label">Title</label>
            <input class="drawer-input" :value="store.doc?.title || ''" @input="e => { store.doc.title = e.target.value; store.markModified() }" />
            <label class="drawer-label">Author</label>
            <input class="drawer-input" :value="store.doc?.author || ''" @input="e => { store.doc.author = e.target.value; store.markModified() }" />
            <label class="drawer-label">Contact Info</label>
            <textarea class="drawer-textarea" :value="store.doc?.authorContact || ''" @input="e => { store.doc.authorContact = e.target.value; store.markModified() }" rows="4" />
            <div class="drawer-check">
              <input id="toc" type="checkbox" :checked="store.doc?.hasTOC" @change="e => { store.doc.hasTOC = e.target.checked; store.markModified() }" />
              <label for="toc">Table of Contents</label>
            </div>
            <div class="drawer-check">
              <input id="epigram" type="checkbox" :checked="store.doc?.hasEpigram" @change="e => { store.doc.hasEpigram = e.target.checked; store.markModified() }" />
              <label for="epigram">Epigram Page</label>
            </div>
            <template v-if="store.doc?.hasEpigram">
              <label class="drawer-label">Epigram Text</label>
              <textarea class="drawer-textarea" :value="store.doc?.epigramText || ''" @input="e => { store.doc.epigramText = e.target.value; store.markModified() }" rows="3" />
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Left drawer -->
    <div class="drawer left" :class="{ open: leftDrawerOpen && leftDrawerMode === 'text-options' }">
      <div class="drawer-content">
        <div class="text-options">
          <h3 class="drawer-heading">Text Options</h3>
          <div class="drawer-label">Margins</div>
          <div class="zoom-row">
            <button
              class="zoom-btn"
              :class="{ active: theme.editorMargin === 'compact' }"
              @click="theme.setMargin('compact')"
            >
              Compact
            </button>
            <button
              class="zoom-btn"
              :class="{ active: theme.editorMargin === 'manuscript' }"
              @click="theme.setMargin('manuscript')"
            >
              Manuscript
            </button>
          </div>
          <div class="drawer-label">Zoom</div>
          <div class="zoom-row">
            <button
              v-for="z in [12, 16, 20]"
              :key="z"
              class="zoom-btn"
              :class="{ active: theme.editorZoom === z }"
              @click="theme.setZoom(z)"
            >
              {{ z }}pt
            </button>
          </div>
          <div class="drawer-label">Font</div>
          <select
            class="drawer-input font-select"
            :value="format.editorFont"
            @change="e => format.setFont(e.target.value)"
          >
            <option v-for="opt in format.fontOptions" :key="opt.label" :value="opt.family">{{ opt.label }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Right drawer: currently empty, reserved for future use -->
    <div class="drawer right" :class="{ open: rightDrawerOpen }">
      <div class="drawer-content right-drawer">
        <div class="drawer-section">
          <p class="drawer-empty">Settings moved to General Options drawer</p>
        </div>
      </div>
    </div>

    <div class="scroll-layer" :class="['mode-' + viewMode, { 'left-pad': leftDrawerOpen, 'right-pad': rightDrawerOpen }]" @click="nav.selectedNavId = null">
      <div class="editor-wrapper" :class="'mode-' + viewMode">
        <DocumentRenderer
          ref="editorRef"
          :modelValue="store.doc"
          :mode="viewMode"
          :theme="theme.editorTheme"
          :zoom="theme.editorZoom"
          :margin="theme.editorMargin"
          :toc-items="nav.tocItems"
          @sync-body="store.syncBodyContent"
          @update="store.markModified()"
          v-if="store.doc"
        />
      </div>
    </div>

    <Toolbar
      :mode="viewMode"
      :right-open="rightDrawerOpen"
      @toggle-right="rightDrawerOpen = !rightDrawerOpen"
      @set-mode="viewMode = $event"
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
import { useHeadingFormat } from './composables/useHeadingFormat.js'
import DocumentRenderer from './components/DocumentRenderer.vue'
import Toolbar from './components/Toolbar.vue'
import StatusBar from './components/StatusBar.vue'
import SearchPanel from './components/SearchPanel.vue'
import NavigationDrawer from './components/NavigationDrawer.vue'
import ActivityBar from './components/ActivityBar.vue'

const store = useDocumentStore()
const { doc, isModified } = storeToRefs(store)

const editorRef = ref(null)
const navDrawerRef = ref(null)
const viewMode = ref('editor')
const leftDrawerOpen = ref(false)
const leftDrawerMode = ref('chapters')
const rightDrawerOpen = ref(false)
const addExpanded = ref(false)
const expandedSections = ref({ 'heading-options': true, 'document-info': false })

// How often autosave journals a delta to the on-disk history sidecar. The
// store's autosaveDocument bails when there's no lastPath or nothing modified,
// so this fires harmlessly while idle. Explicit save writes the .rite; this
// interval only feeds the crash-recovery history between saves.
const AUTOSAVE_INTERVAL_MS = 30_000
let autosaveTimer = null

const theme = reactive(useTheme(viewMode))
const search = reactive(useSearchPanel(editorRef, viewMode))
const nav = reactive(useNavigation(doc, editorRef))
const fileIO = useFileIO()
const format = reactive(useFormat(editorRef, store.markModified.bind(store)))
const headingFormat = reactive(useHeadingFormat())

const wordCount = computed(() => {
  if (!store.doc) return 0
  let count = 0
  for (const p of store.doc.body.content) {
    for (const el of p.elements) {
      const text = el.textRun.content || ''
      if (text.trim()) count += text.trim().split(/\s+/).length
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

function onScrollTo(id) {
  nav.scrollToHeading(id, () => { viewMode.value = 'editor' })
}

function onInsertHeading(level) {
  const styleMap = { 1: 'heading1', 2: 'heading2', 3: 'heading3', 4: 'heading4', 5: 'heading5', 6: 'heading6' }
  const style = styleMap[level] || 'heading1'
  viewMode.value = 'editor'
  nextTick(() => {
    editorRef.value?.insertHeading?.(style, '', { atPageTop: true, afterId: nav.selectedNavId })
  })
  addExpanded.value = false
}

function onSearchReplace() {
  search.onSearchReplace()
}

function onSearchReplaceAll() {
  search.onSearchReplaceAll()
}

function getEditorSheet() {
  return editorRef.value?.$el?.classList?.contains('editor-sheet')
    ? editorRef.value.$el
    : editorRef.value?.$el?.querySelector?.('.editor-sheet')
}

function getCurrentParagraph() {
  const sel = window.getSelection()
  if (!sel.rangeCount) return null
  let node = sel.anchorNode
  if (!node) return null
  let el = node.nodeType === 3 ? node.parentElement : node
  const sheet = getEditorSheet()
  if (!sheet) return null
  while (el && el !== sheet) {
    if (el.classList?.contains('paragraph')) return el
    el = el.parentElement
  }
  return null
}

function selectLine() {
  const sel = window.getSelection()
  if (!sel.rangeCount) return
  const para = getCurrentParagraph()
  if (!para) return
  const range = sel.getRangeAt(0)
  const endPara = range.endContainer.nodeType === 3
    ? range.endContainer.parentElement.closest('.paragraph')
    : range.endContainer.closest('.paragraph')
  if (endPara && endPara.nextElementSibling && endPara.nextElementSibling.classList.contains('paragraph')) {
    const next = endPara.nextElementSibling
    range.setEndAfter(next.lastChild || next)
    sel.removeAllRanges()
    sel.addRange(range)
  } else {
    const r = document.createRange()
    r.selectNodeContents(para)
    sel.removeAllRanges()
    sel.addRange(r)
  }
}

function navigatePage(direction) {
  const sheet = getEditorSheet()
  if (!sheet) return
  const paras = Array.from(sheet.querySelectorAll('.paragraph'))
  const current = getCurrentParagraph()
  if (!current) return
  const currentPage = parseInt(current.dataset.pageStart, 10) || 1
  const targetPage = currentPage + direction
  if (targetPage < 1) return
  const target = paras.find(p => parseInt(p.dataset.pageStart, 10) === targetPage)
  if (!target) return
  const range = document.createRange()
  range.setStart(target, 0)
  range.collapse(true)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function navigateHeadingPage(direction) {
  const sheet = getEditorSheet()
  if (!sheet) return
  const paras = Array.from(sheet.querySelectorAll('.paragraph'))
  const current = getCurrentParagraph()
  if (!current) return
  const currentPage = parseInt(current.dataset.pageStart, 10) || 1
  const headings = paras.filter(p => /^heading[1-6]$/.test(p.dataset.paraStyle))
  const headingPages = headings.map(h => parseInt(h.dataset.pageStart, 10) || 1)
  let targetPage
  if (direction > 0) {
    targetPage = headingPages.find(p => p > currentPage)
  } else {
    targetPage = [...headingPages].reverse().find(p => p < currentPage)
  }
  if (!targetPage) return
  const target = paras.find(p => parseInt(p.dataset.pageStart, 10) === targetPage)
  if (!target) return
  const range = document.createRange()
  range.setStart(target, 0)
  range.collapse(true)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function onKeydown(e) {
  const cmd = e.metaKey || e.ctrlKey

  if (cmd && e.key === 's') {
    e.preventDefault()
    fileIO.saveFile()
    return
  }

  if (cmd && e.key === 'z' && !e.shiftKey) {
    e.preventDefault()
    store.undo()
    return
  }

  if (cmd && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
    e.preventDefault()
    store.redo()
    return
  }

  if (cmd && viewMode.value === 'editor') {
    if (e.key === 'b') {
      e.preventDefault()
      format.toggleFormat('bold')
      return
    }
    if (e.key === 'i') {
      e.preventDefault()
      format.toggleFormat('italic')
      return
    }
    if (e.key === 'u') {
      e.preventDefault()
      format.toggleFormat('underline')
      return
    }
    if (e.key === 'l') {
      e.preventDefault()
      selectLine()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      navigatePage(1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      navigatePage(-1)
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      navigateHeadingPage(1)
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      navigateHeadingPage(-1)
      return
    }
  }

  if (cmd && e.key === 'f') {
    e.preventDefault()
    if (search.searchVisible) {
      search.closeSearch()
    } else {
      search.openSearch()
    }
    return
  }
  if (e.key === 'Escape') {
    if (search.searchVisible) {
      e.preventDefault()
      search.closeSearch()
      return
    }
    if (leftDrawerOpen.value) {
      e.preventDefault()
      leftDrawerOpen.value = false
      return
    }
  }
  if (cmd && e.key === 'Enter') {
    e.preventDefault()
    if (viewMode.value === 'editor') {
      leftDrawerMode.value = 'chapters'
      leftDrawerOpen.value = true
      addExpanded.value = true
    }
    return
  }
  if (leftDrawerOpen.value && leftDrawerMode.value === 'chapters' && addExpanded.value && !search.searchVisible) {
    const level = parseInt(e.key, 10)
    if (level >= 1 && level <= 6) {
      e.preventDefault()
      onInsertHeading(level)
      return
    }
  }
}

function onSelectionChange() {
  format.syncFormatState()
  format.updateSelectedWordCount()
}

onMounted(async () => {
  theme.loadPrefs()
  headingFormat.loadPrefs()
  format.loadPrefs()
  document.execCommand('styleWithCSS', false, true)
  document.addEventListener('selectionchange', onSelectionChange)
  document.addEventListener('keydown', onKeydown)
  await store.loadInitialDocument()

  autosaveTimer = setInterval(() => { store.autosaveDocument() }, AUTOSAVE_INTERVAL_MS)
})

onUnmounted(() => {
  document.removeEventListener('selectionchange', onSelectionChange)
  document.removeEventListener('keydown', onKeydown)
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

/* Drawers */
.drawer {
  position: fixed;
  top: 38px;
  bottom: 36px;
  width: 260px;
  transition: transform 0.25s ease;
  z-index: 25;
}

.drawer.left {
  left: 48px;
  transform: translateX(-100%);
}

.drawer.left.open {
  transform: translateX(0);
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
}

.drawer-section {
  margin-bottom: 20px;
}

.drawer-heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.drawer-label {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
  margin-top: 10px;
}

.drawer-input,
.drawer-textarea {
  width: 100%;
  background: var(--input-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: 6px;
  padding: 6px 8px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  resize: vertical;
}

.drawer-input:focus,
.drawer-textarea:focus {
  border-color: var(--accent);
}

.drawer-check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 13px;
  color: var(--text-primary);
}

.drawer-check input {
  accent-color: var(--accent);
}


.drawer-empty {
  font-size: 13px;
  color: var(--text-secondary);
  opacity: 0.6;
}

/* Text options drawer */
.text-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}


/* General options drawer */
.general-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.accordion-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 0;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--bg-glass-border);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  user-select: none;
}

.accordion-header svg {
  transition: transform 0.2s ease;
  color: var(--text-secondary);
}

.accordion-header svg.rotated {
  transform: rotate(180deg);
}

.accordion-body {
  padding: 8px 0 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.heading-level-row {
  border-bottom: 1px solid var(--bg-glass-border);
  padding-bottom: 12px;
}

.heading-level-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.heading-level-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.zoom-row {
  display: flex;
  gap: 6px;
}

.zoom-btn {
  flex: 1;
  height: 32px;
  border-radius: 6px;
  border: 1px solid var(--bg-glass-border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.zoom-btn:hover {
  background: var(--hover-bg-strong);
  color: var(--text-primary);
}

.zoom-btn.active {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.font-select {
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  padding-right: 24px;
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
  padding-right: 260px;
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
