<template>
  <!--
    Read-only renderer for a reconstructed past version of the document. No
    editing, no pagination, no page-break layout — just the text laid out as the
    editor shows it (section titles + body paragraphs in one continuous scroll),
    so the writer can read what that version contained. Reuses the existing
    HTML helpers (sectionTitleToHTML / paragraphToHTML) and the flat↔nested
    `flattenSections` translation — no new rendering logic. The `.history-preview`
    container picks up the editor font via the `--editor-font` CSS var App sets.
  -->
  <div class="history-preview" v-if="document">
    <div class="history-preview-doc" v-html="renderedHtml"></div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { flattenSections } from '../composables/useSectionBlocks.js'
import { paragraphToHTML, sectionTitleToHTML, escapeHtml } from '../composables/useParagraphHTML.js'
import { useSectionFormat } from '../composables/useSectionFormat.js'

const props = defineProps({
  document: { type: Object, default: null },
})

const sectionFormat = useSectionFormat()

const renderedHtml = computed(() => {
  const doc = props.document
  if (!doc || !doc.sections) return ''
  const blocks = flattenSections(doc.sections)
  const parts = []
  for (const block of blocks) {
    if (block.kind === 'section-title') {
      // Reconstruct a minimal Section for the helper (it only reads id/title/
      // sectionType/hidden). The chapter prefix is derived from chapterIndex.
      const section = {
        id: block.sectionId,
        title: block.title,
        sectionType: block.sectionType,
        hidden: block.hidden,
      }
      const prefix = block.sectionType === 'chapter'
        ? sectionFormat.formatChapter(block.chapterIndex)
        : ''
      parts.push(sectionTitleToHTML(section, block.chapterIndex, prefix, { manuscript: false }))
    } else {
      parts.push(paragraphToHTML(block.paragraph, { sectionId: block.sectionId }))
    }
  }
  return parts.join('') || `<div class="history-preview-empty">${escapeHtml('This version is empty.')}</div>`
})
</script>

<style scoped>
.history-preview {
  /* Flows inside the App scroll-layer; the page scrolls. Centered max-width
     sheet like the editor, with a muted background to signal "read-only
     archive". */
  display: flex;
  justify-content: center;
  padding: 48px 24px 96px;
}

.history-preview-doc {
  max-width: 720px;
  width: 100%;
  font-family: var(--editor-font, Georgia, serif);
  font-size: 16px;
  line-height: 1.7;
  color: var(--text-primary, #f0f0f5);
  background: var(--bg-base, rgba(255, 255, 255, 0.02));
  border-radius: 6px;
  padding: 48px 56px;
}

.history-preview-doc :deep(.section-title) {
  font-weight: 700;
  font-size: 1.4em;
  margin: 1.5em 0 0.5em;
}

.history-preview-doc :deep(.section-title.chapter) {
  font-size: 1.6em;
}

/* Hidden sections dim the same way the editor marks them (5.10). */
.history-preview-doc :deep(.section-title.section-hidden) {
  opacity: 0.45;
}

.history-preview-doc :deep(.paragraph) {
  margin: 0 0 0.8em;
}

.history-preview-empty {
  opacity: 0.5;
  font-style: italic;
}
</style>