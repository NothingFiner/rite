<template>
  <div class="drawer left" :class="{ open: open }">
    <div class="drawer-content">
      <div class="drawer-section">
        <h3 class="drawer-heading">Navigation</h3>
        <ul class="nav-tree">
          <li v-for="group in groups" :key="group.section.id" class="nav-group">
            <div
              class="nav-section"
              :class="{ active: props.activeId === group.section.id }"
              @click="selectSection(group.section.id, group.section.level)"
            >
              <span v-if="group.section.editing">
                <input
                  ref="sectionInput"
                  class="nav-input"
                  :value="draftTitles[group.section.id] ?? group.section.title"
                  @input="e => draftTitles[group.section.id] = e.target.value"
                  @keydown.enter="confirmRename(group.section)"
                  @click.stop
                />
                <button class="nav-confirm" @click.stop="confirmRename(group.section)">&#10003;</button>
              </span>
              <span v-else class="nav-title">
                {{ group.section.title }}
                <button
                  v-if="props.activeId === group.section.id"
                  class="nav-edit"
                  @click.stop="startRename(group.section)"
                >&#9998;</button>
                <button
                  v-if="props.activeId === group.section.id"
                  class="nav-delete"
                  @click.stop="onDelete(group.section.id)"
                >&#10005;</button>
              </span>
              <span class="nav-page">p. {{ group.section.page }}</span>
            </div>
            <ul v-if="group.chapters.length > 0" class="nav-children">
              <li
                v-for="ch in group.chapters"
                :key="ch.id"
                class="nav-chapter"
                :class="{ active: props.activeId === ch.id }"
                @click="selectSection(ch.id, ch.level)"
              >
                <span class="nav-title">
                  {{ ch.title }}
                  <button
                    v-if="props.activeId === ch.id"
                    class="nav-delete"
                    @click.stop="onDelete(ch.id)"
                  >&#10005;</button>
                </span>
                <span class="nav-page">p. {{ ch.page }}</span>
              </li>
            </ul>
          </li>
        </ul>
        <div v-if="groups.length === 0" class="drawer-empty">
          <p>No headings yet.</p>
          <p class="hint">Press Cmd+Enter to add headings.</p>
        </div>
      </div>

      <div class="drawer-footer">
        <div class="add-control" :class="{ expanded: props.expanded }">
          <button class="add-btn" @click="toggleAdd" :title="props.expanded ? 'Cancel' : 'Add Heading'">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="#000000" viewBox="0 0 256 256"><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"></path></svg>
          </button>
          <transition name="slide-fade">
            <div v-if="props.expanded" class="add-options">
              <select v-model="selectedLevel" class="heading-select">
                <option v-for="n in 6" :key="n" :value="n">Heading {{ n }}</option>
              </select>
              <button class="add-confirm" @click="confirmAdd">Add</button>
            </div>
          </transition>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
  tocItems: { type: Array, default: () => [] },
  paragraphs: { type: Array, default: () => [] },
  activeId: { type: String, default: null },
})

const emit = defineEmits(['scrollTo', 'insertHeading', 'renameSection', 'update:expanded', 'select', 'deleteItem'])

const sectionInput = ref(null)
const editingIds = ref(new Set())
const draftTitles = ref({})
const selectedLevel = ref(1)

const groups = computed(() => {
  const result = []
  let currentGroup = null
  const tocItems = Array.isArray(props.tocItems) ? props.tocItems : []

  for (const item of tocItems) {
    const level = item.level || 1
    if (level === 1) {
      const isEditing = editingIds.value.has(item.id) || !item.title
      if (!item.title && !editingIds.value.has(item.id)) {
        editingIds.value.add(item.id)
      }
      currentGroup = {
        section: {
          ...item,
          editing: isEditing,
          draftTitle: draftTitles.value[item.id] ?? item.title,
        },
        chapters: [],
      }
      result.push(currentGroup)
    } else if (level === 2 && currentGroup) {
      currentGroup.chapters.push(item)
    } else if (level === 2 && !currentGroup) {
      currentGroup = {
        section: { id: 'orphan-' + item.id, title: 'Untitled Section', page: item.page, editing: false, draftTitle: '', level: 1 },
        chapters: [item],
      }
      result.push(currentGroup)
    }
  }
  return result
})

function toggleAdd() {
  emit('update:expanded', !props.expanded)
}

function confirmAdd() {
  emit('update:expanded', false)
  emit('insertHeading', selectedLevel.value)
}

function selectSection(id, type) {
  emit('select', id)
  emit('scrollTo', id)
}

function onDelete(id) {
  emit('deleteItem', id)
}

function startRename(section) {
  editingIds.value.add(section.id)
  draftTitles.value[section.id] = section.title
  nextTick(() => {
    const input = document.querySelector('.nav-input')
    if (input) {
      input.focus()
      input.select()
    }
  })
}

function confirmRename(section) {
  const newTitle = draftTitles.value[section.id]?.trim() || ''
  if (newTitle && newTitle !== section.title) {
    emit('renameSection', section.id, newTitle)
  }
  editingIds.value.delete(section.id)
  delete draftTitles.value[section.id]
}

watch(() => props.open, (v) => {
  if (!v) {
    emit('update:expanded', false)
    emit('select', null)
    editingIds.value.clear()
  }
})

watch(groups, () => {
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

.nav-group {
  margin-bottom: 4px;
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
}

.nav-section:hover,
.nav-section.active {
  background: var(--hover-bg);
}

.nav-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  overflow: hidden;
}

.nav-page {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  margin-left: 8px;
}

.nav-children {
  list-style: none;
  padding: 0;
  margin: 0 0 0 12px;
  border-left: 1px solid var(--bg-glass-border);
}

.nav-chapter {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 8px 5px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  transition: background 0.15s;
}

.nav-chapter:hover,
.nav-chapter.active {
  background: var(--hover-bg);
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
.nav-section.active .nav-edit {
  opacity: 1;
}

.nav-section:hover .nav-delete,
.nav-section.active .nav-delete,
.nav-chapter:hover .nav-delete,
.nav-chapter.active .nav-delete {
  opacity: 1;
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

.add-btn:hover {
  background: var(--accent-hover);
  transform: scale(1.05);
}

.add-options {
  display: flex;
  gap: 8px;
}

.add-option {
  background: var(--input-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 12px;
  padding: 5px 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.heading-select {
  flex: 1;
  background: var(--input-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 12px;
  padding: 5px 8px;
  cursor: pointer;
  outline: none;
}

.heading-select:focus {
  border-color: var(--accent);
}

.add-confirm {
  background: var(--accent);
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  cursor: pointer;
  transition: background 0.15s;
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
