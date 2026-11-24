// The floor under the chrome (SPEC.md revision 10, S-138).
//
// The rail and the top bar paint a translucent glass. What sits behind that
// glass decides what the glass looks like: over the near-black app base the
// editor's paper at 78% resolves to a mid grey, and no ink in the theme clears
// 3:1 on it. Publishing the paper as the floor in the editor view makes the
// same glass read as light glass over paper.

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

    // Positive control: the editor's floor is a colour of its own, so the
    // assertions above are not reading one constant four times.
    expect(editor.uiBase.value).not.toBe(CHROME_BASE['--bg-base'])
  })
})
