import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useEditorReadback } from './useEditorReadback.js'

// First-line indent after a DOM→model readback (SPEC.md 5.18, S-004/S-005).
//
// `null` means automatic, a number means the writer set it. The renderer marks
// automatic paragraphs with `data-auto-indent="true"`; an explicit indent lives
// in the inline `text-indent`, and an explicit 0 keeps the `no-indent` class.

describe('first-line indent readback', () => {
  let root

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  afterEach(() => {
    if (root.parentNode) root.parentNode.removeChild(root)
  })

  const readBack = (html) => {
    root.innerHTML = html
    const emitted = []
    const { fullSyncFromDOM } = useEditorReadback({
      sheetRef: ref(root),
      modelRef: ref({ sections: [] }),
      zoomRef: ref(16),
      lastRenderedBlocks: ref(null),
      lastSectionCount: ref(0),
      skipNextWatcher: ref(false),
      emit: (event, payload) => emitted.push({ event, payload }),
    })
    fullSyncFromDOM()
    const sections = emitted.find((e) => e.event === 'syncSections').payload
    return sections[0].paragraphs
  }

  it('S-004: an automatic paragraph reads back as null, not as its rendered number', () => {
    const paragraphs = readBack(`
      <div class="section-title" data-section-id="s1" data-section-type="section">
        <span class="section-title-text">Opening</span>
      </div>
      <div class="paragraph no-indent" data-para-id="p1" data-section-id="s1"
           data-auto-indent="true" style="text-indent:0px">First</div>
      <div class="paragraph" data-para-id="p2" data-section-id="s1"
           data-auto-indent="true" style="text-indent:48px">Second</div>
    `)
    expect(paragraphs[0].firstLineIndent).toBe(null)
    expect(paragraphs[1].firstLineIndent).toBe(null)
  })

  it('S-005: an explicit indent reads back as its exact value, including a flush 0', () => {
    const paragraphs = readBack(`
      <div class="section-title" data-section-id="s1" data-section-type="section">
        <span class="section-title-text">Opening</span>
      </div>
      <div class="paragraph" data-para-id="p1" data-section-id="s1"
           style="text-indent:96px">Indented</div>
      <div class="paragraph no-indent" data-para-id="p2" data-section-id="s1">Flush</div>
    `)
    expect(paragraphs[0].firstLineIndent).toBe(1)
    expect(paragraphs[1].firstLineIndent).toBe(0)
  })
})
