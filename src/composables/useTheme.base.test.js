// The floor under the chrome (SPEC.md revision 10, S-138).
//
// The rail and the top bar paint a translucent glass, and the floor decides how
// that glass lands. Over the near-black app base, paper at 78% resolves to a
// mid grey with no legible ink. S-138 puts the paper underneath it.

import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { CHROME_BASE } from '../constants/palette.js'
import { useTheme } from '../composables/useTheme.js'

describe('the chrome base', () => {
  it('S-138: publishes the paper under the chrome in the editor and the dark base elsewhere', () => {
    const editor = useTheme(ref('editor'))
    expect(editor.uiBase.value).toBe(editor.currentTheme.value.bg)

    for (const viewMode of ['manuscript', 'references', 'history']) {
      const view = useTheme(ref(viewMode))
      expect(view.uiBase.value, viewMode).toBe(CHROME_BASE['--bg-base'])
      expect(view.uiBase.value, viewMode).not.toBe(view.currentTheme.value.bg)
    }

    // Positive control: the editor publishes its own floor, which no other view
    // shares.
    expect(editor.uiBase.value).not.toBe(CHROME_BASE['--bg-base'])
  })
})
