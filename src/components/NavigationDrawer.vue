<template>
  <div class="drawer left" :class="{ open: open }">
    <div class="drawer-content">
      <div class="drawer-section">
        <h3 class="drawer-heading">Sections</h3>
        <ul class="nav-tree" ref="navTreeRef">
          <li
            v-for="item in sections"
            :key="item.id"
            class="nav-section"
            :class="{
              active: props.activeId === item.id,
              dragging: draggingId === item.id,
              'drop-above': dropTarget?.id === item.id && dropTarget.half === 'before',
              'drop-below': dropTarget?.id === item.id && dropTarget.half === 'after',
            }"
            :draggable="!editingIds.has(item.id)"
            :data-nav-id="item.id"
            @click="selectSection(item.id)"
            @dragstart="onDragStart($event, item)"
          >
            <span v-if="editingIds.has(item.id)" class="nav-edit-row">
              <input
                ref="sectionInput"
                class="nav-input"
                :value="draftTitles[item.id] ?? item.title"
                @input="e => draftTitles[item.id] = e.target.value"
                @keydown.enter="confirmRename(item)"
                @click.stop
              />
              <button class="nav-confirm" @click.stop="confirmRename(item)">&#10003;</button>
            </span>
            <span v-else class="nav-title">
              {{ item.displayTitle }}
              <button
                v-if="props.activeId === item.id"
                class="nav-edit"
                @click.stop="startRename(item)"
                :title="item.sectionType === 'chapter' ? 'Rename subtitle' : 'Rename section'"
              >&#9998;</button>
              <button
                v-if="props.activeId === item.id"
                class="nav-delete"
                @click.stop="onDelete(item.id)"
              >&#10005;</button>
            </span>
            <button
              class="nav-type-toggle"
              :class="{ chapter: item.sectionType === 'chapter' }"
              @click.stop="toggleType(item)"
              :title="item.sectionType === 'chapter'
                ? 'Chapter (auto-numbered). Click to make a freeform Section.'
                : 'Section (freeform title). Click to make an auto-numbered Chapter.'"
            >{{ item.sectionType === 'chapter' ? 'Ch' : '§' }}</button>
            <span class="nav-page">p. {{ item.page }}</span>
          </li>
        </ul>
        <div v-if="sections.length === 0" class="drawer-empty">
          <p>No sections yet.</p>
          <p class="hint">Use Add Chapter / Add Section below.</p>
        </div>
      </div>

      <div class="drawer-footer">
        <div class="add-control" :class="{ expanded: props.expanded }">
          <button class="add-btn" @click="toggleAdd" :title="props.expanded ? 'Cancel' : 'Add section'">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 256 256"><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"></path></svg>
          </button>
          <transition name="slide-fade">
            <div v-if="props.expanded" class="add-options">
              <button class="add-confirm" @click="addChapter">+ Chapter</button>
              <button class="add-confirm" @click="addSection">+ Section</button>
            </div>
          </transition>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch, onBeforeUnmount } from 'vue'
import { dropHalf, toAfterIdFor, reorderedIds } from '../composables/useOutlineDrag.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
  tocItems: { type: Array, default: () => [] },
  activeId: { type: String, default: null },
})

const emit = defineEmits(['scrollTo', 'insertSection', 'renameSection', 'changeSectionType', 'moveSection', 'update:expanded', 'select', 'deleteItem'])

const sectionInput = ref(null)
const editingIds = ref(new Set())
const draftTitles = ref({})

// The outline is already flat (one item per section) — pass it through as the
// row list. No Part/Chapter grouping, no orphan synthesis, no levels.
const sections = computed(() => (Array.isArray(props.tocItems) ? props.tocItems : []))

function toggleAdd() {
  emit('update:expanded', !props.expanded)
}

function addChapter() {
  emit('update:expanded', false)
  emit('insertSection', 'chapter')
}

function addSection() {
  emit('update:expanded', false)
  emit('insertSection', 'section')
}

function selectSection(id) {
  emit('select', id)
  emit('scrollTo', id)
}

function onDelete(id) {
  emit('deleteItem', id)
}

// --- drag-to-reorder (roadmap 5.5) --------------------------------------------
// Native HTML5 DnD, no dependency. The dragged id lives in a component-internal
// ref; it never crosses the wire — Rust identifies the section and destination
// by id. The dataTransfer is still REQUIRED: WebKit cancels an element drag
// whose dragstart sets no data (it fell back to a text-selection drag and
// `drop` never fired). All dataTransfer accesses are optional-chained so
// jsdom's bare Events (no dataTransfer) keep the unit specs running.
//
// THE WKWEBVIEW LESSON (2nd manual round): WebKit MISROUTES drag events inside
// this drawer — a transformed panel with a scrolling list. A hover over
// chapter 3 painted the insertion line on chapter 15 (one scroll-offset
// away), and the drop was delivered to an element our row handlers never
// saw, so sections never moved. So dragover/drop/dragend are handled at the
// DOCUMENT level (every misrouted event still bubbles there), and the
// hovered row is computed from the POINTER COORDINATES against each row's
// real rect — geometry read in JS is trustworthy; only WebKit's internal
// hit-testing is broken. The rows keep only dragstart, which fires reliably
// on the source.

const draggingId = ref(null)
// { id, half } of the row under the pointer while dragging — drives the
// insertion-line CSS classes. Null when the pointer is off the list, over
// the dragged row itself, or over a row mid-rename.
const dropTarget = ref(null)
// The <ul> — the geometry source for drop targeting.
const navTreeRef = ref(null)

// The offscreen element shown as the drag ghost. The NATIVE ghost is a
// snapshot of the dragged row — but this drawer sits in a backdrop-filter
// glass panel, and WKWebView snapshots the page text BEHIND the drawer, so
// the ghost showed unrelated editor text. setDragImage replaces it with a
// clean pill. Styled inline: it's appended to <body>, outside this
// component's scoped-style reach.
let dragGhost = null

function makeDragGhost(item) {
  removeDragGhost()
  dragGhost = document.createElement('div')
  dragGhost.className = 'nav-drag-ghost'
  dragGhost.textContent = item.displayTitle
  const style = dragGhost.style
  style.position = 'fixed'
  style.top = '-9999px' // offscreen but rendered — setDragImage snapshots it
  style.left = '0'
  style.padding = '4px 10px'
  style.borderRadius = '4px'
  style.background = 'var(--accent)'
  style.color = '#fff'
  style.fontSize = '13px'
  style.fontWeight = '600'
  style.whiteSpace = 'nowrap'
  document.body.appendChild(dragGhost)
  return dragGhost
}

function removeDragGhost() {
  if (dragGhost) {
    dragGhost.remove()
    dragGhost = null
  }
}

// The row { id, half } under the pointer, from geometry WE read (see the
// block comment above for why this is not just `event.target`). Returns null
// off the list, or when the list has no rows.
function dropTargetUnder(clientX, clientY) {
  const list = navTreeRef.value
  if (!list) return null
  const listRect = list.getBoundingClientRect()
  // Pointer outside the list's box (over the editor, the toolbar, ...): no
  // target — the document listeners fire for the whole page, so the line
  // must not paint when the pointer merely shares the drawer's Y range.
  if (clientX < listRect.left || clientX > listRect.right) return null
  const rowEls = list.querySelectorAll('.nav-section')
  let lastEl = null
  for (const el of rowEls) {
    const rect = el.getBoundingClientRect()
    // At or above this row's bottom edge: inside it, or in the 2px gap
    // above it — both mean "this row". dropHalf's midpoint rule sorts out
    // which side (a point above the row's top is also above its midpoint).
    if (clientY <= rect.bottom) {
      return { id: el.dataset.navId, half: dropHalf(rect, clientY) }
    }
    lastEl = el
  }
  // Below every row (the list's padding area under the last entry): after
  // the last row.
  return lastEl ? { id: lastEl.dataset.navId, half: 'after' } : null
}

// Prevent the drop ANYWHERE on the page while our drag is in flight —
// otherwise WebKit's default would let the payload land as text into
// whatever it (mis)hit-tests, e.g. inserting it into the editor prose.
// dropEffect must AGREE with dragstart's effectAllowed ('move').
function onDocumentDragOver(e) {
  if (!draggingId.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  const target = dropTargetUnder(e.clientX, e.clientY)
  // The dragged row itself and rows mid-rename are never valid targets (a
  // rename row hosts a text input whose text selection a drag would fight).
  dropTarget.value =
    target && target.id !== draggingId.value && !editingIds.value.has(target.id)
      ? target
      : null
}

function onDocumentDrop(e) {
  if (!draggingId.value) return
  e.preventDefault()
  const target = dropTargetUnder(e.clientX, e.clientY)
  if (target && target.id !== draggingId.value && !editingIds.value.has(target.id)) {
    const targetIndex = sections.value.findIndex((s) => s.id === target.id)
    const toAfterId = toAfterIdFor(sections.value, targetIndex, target.half)
    const currentIds = sections.value.map((s) => s.id)
    // A drop back onto the row's own position is a no-op — skip the invoke
    // entirely (reorderedIds returns null when the order wouldn't change).
    if (reorderedIds(currentIds, draggingId.value, toAfterId)) {
      emit('moveSection', draggingId.value, toAfterId)
    }
  }
  cleanupDrag()
}

// dragend fires on the SOURCE row no matter where the pointer ended up
// (cancelled drag, drop outside any row) — the single place all drag state
// is cleared. Document-level because (per the block comment) even the
// source row's own listeners can be bypassed by WebKit's routing; dragend
// still bubbles.
function onDocumentDragEnd() {
  cleanupDrag()
}

let documentDragListenersActive = false

function cleanupDrag() {
  draggingId.value = null
  dropTarget.value = null
  removeDragGhost()
  if (documentDragListenersActive) {
    document.removeEventListener('dragover', onDocumentDragOver)
    document.removeEventListener('drop', onDocumentDrop)
    document.removeEventListener('dragend', onDocumentDragEnd)
    documentDragListenersActive = false
  }
}

function onDragStart(e, item) {
  draggingId.value = item.id
  // The payload is informational (the component state carries the real id) —
  // but WebKit cancels the drag entirely without it.
  e.dataTransfer?.setData?.('text/plain', item.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer?.setDragImage?.(makeDragGhost(item), 60, 16)
  if (!documentDragListenersActive) {
    document.addEventListener('dragover', onDocumentDragOver)
    document.addEventListener('drop', onDocumentDrop)
    document.addEventListener('dragend', onDocumentDragEnd)
    documentDragListenersActive = true
  }
}

// If the component unmounts mid-drag (view switch), the document listeners
// must not outlive it — their closures hold refs into this component.
onBeforeUnmount(cleanupDrag)

// Toggle a section between auto-numbered Chapter and freeform Section. The
// round-trip change_section_type command is undoable.
function toggleType(item) {
  const newType = item.sectionType === 'chapter' ? 'section' : 'chapter'
  emit('changeSectionType', item.id, newType)
}

function startRename(item) {
  editingIds.value.add(item.id)
  draftTitles.value[item.id] = item.title
  nextTick(() => {
    const input = document.querySelector('.nav-input')
    if (input) {
      input.focus()
      input.select()
    }
  })
}

function confirmRename(item) {
  const newTitle = draftTitles.value[item.id]?.trim() ?? ''
  // For a Chapter, item.title is the subtitle; for a Section, the full title.
  // Either way it is written to Section.title via rename_section.
  if (newTitle !== item.title) {
    emit('renameSection', item.id, newTitle)
  }
  editingIds.value.delete(item.id)
  delete draftTitles.value[item.id]
}

watch(() => props.open, (v) => {
  if (!v) {
    emit('update:expanded', false)
    emit('select', null)
    editingIds.value.clear()
  }
})

watch(sections, () => {
  nextTick(() => {
    const input = document.querySelector('.nav-input')
    if (input) {
      input.focus()
    }
  })
}, { flush: 'post' })
</script>

<style scoped>
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

.drawer-content {
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  background: var(--glass-bg);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border-right: 1px solid var(--bg-glass-border);
  display: flex;
  flex-direction: column;
}

.drawer-section {
  flex: 1;
  overflow-y: auto;
}

.drawer-heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.nav-tree {
  list-style: none;
  padding: 0;
  margin: 0;
}

.nav-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  transition: background 0.15s;
  margin-bottom: 2px;
  /* A mousedown on row text must start an ELEMENT drag, never a text-selection
     drag — in WKWebView a selection drag preempts the draggable row (the
     "ghost shows stray page text" bug). The rename input opts back in. */
  user-select: none;
  -webkit-user-select: none;
}

.nav-section .nav-input {
  user-select: text;
  -webkit-user-select: text;
}

.nav-section:hover,
.nav-section.active {
  background: var(--hover-bg);
}

/* Source row while its drag is in flight. */
.nav-section.dragging {
  opacity: 0.4;
}

/* Insertion line at the hovered row's top/bottom edge while dragging — the
   drop preview. Inset box-shadow (not border) so the row's height and layout
   don't shift as the pointer moves, which would flicker the half-detection. */
.nav-section.drop-above {
  box-shadow: inset 0 2px 0 0 var(--accent);
}

.nav-section.drop-below {
  box-shadow: inset 0 -2px 0 0 var(--accent);
}

.nav-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.nav-page {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  margin-left: 8px;
}

/* Chapter/Section type toggle badge. */
.nav-type-toggle {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid var(--bg-glass-border);
  background: var(--input-bg);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 6px;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.nav-type-toggle:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.nav-type-toggle.chapter {
  border-color: var(--accent);
  color: var(--accent);
}

.nav-edit {
  background: transparent;
  border: none;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
  padding: 0 2px;
  opacity: 0;
  transition: opacity 0.15s;
}

.nav-delete {
  background: transparent;
  border: none;
  color: #c44;
  font-size: 11px;
  cursor: pointer;
  padding: 0 2px;
  opacity: 0;
  transition: opacity 0.15s;
}

.nav-section:hover .nav-edit,
.nav-section.active .nav-edit,
.nav-section:hover .nav-delete,
.nav-section.active .nav-delete {
  opacity: 1;
}

.nav-edit-row {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 4px;
}

.nav-input {
  flex: 1;
  background: var(--input-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: 4px;
  padding: 3px 6px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  min-width: 0;
}

.nav-input:focus {
  border-color: var(--accent);
}

.nav-confirm {
  background: var(--accent);
  border: none;
  color: #fff;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
  cursor: pointer;
  margin-left: 4px;
}

.drawer-empty {
  font-size: 13px;
  color: var(--text-secondary);
  opacity: 0.6;
  text-align: center;
  padding: 20px 0;
}

.drawer-empty .hint {
  font-size: 11px;
  margin-top: 8px;
  opacity: 0.7;
}

.drawer-footer {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--bg-glass-border);
}

.add-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.add-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: var(--accent);
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform 0.2s ease, background 0.15s;
}

.add-btn svg {
  transition: transform 0.2s ease;
}

.expanded svg {
  transform: rotate(45deg);
}

.add-btn:hover {
  background: var(--accent-hover);
  transform: scale(1.05);
}

.add-options {
  display: flex;
  gap: 8px;
  flex: 1;
}

.add-confirm {
  flex: 1;
  background: var(--accent);
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 8px;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}

.add-confirm:hover {
  background: var(--accent-hover);
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
</style>