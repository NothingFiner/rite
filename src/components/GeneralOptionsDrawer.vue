<template>
  <div class="drawer left" :class="{ open }">
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
</template>

<script setup>
import { ref } from 'vue'

// Receives the document store and the heading-format composable as props and
// drives them directly (setFormat / store.doc.* + markModified). These are
// app-specific config panels coupled to the preference composables by nature,
// so the coupling is honest; keeping it behind emits would be plumbing for no
// reuse benefit. Accordion expansion state is local — nothing else reads it.
const props = defineProps({
  open: { type: Boolean, default: false },
  store: { type: Object, required: true },
  headingFormat: { type: Object, required: true },
})

const expandedSections = ref({ 'heading-options': true, 'document-info': false })
</script>

<style scoped>
/* Base drawer shell — duplicated per drawer component by convention (see
   NavigationDrawer.vue); scoped styles only reach this component's template. */
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
</style>