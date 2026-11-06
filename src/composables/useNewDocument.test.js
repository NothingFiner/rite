import { describe, it, expect, vi } from 'vitest'
import { useNewDocument } from './useNewDocument.js'

// The New… flow (SPEC.md S-019, S-020). The save-before guard resolves before the
// name prompt appears, and cancelling the prompt changes nothing.

describe('useNewDocument', () => {
  it('S-019: should show the name prompt only after the unsaved-changes guard', async () => {
    let release
    const guard = new Promise((resolve) => {
      release = resolve
    })
    const deps = {
      fileIO: { newFile: vi.fn(() => guard) },
      store: { newDocument: vi.fn() },
    }
    const { showPrompt, onNewFile } = useNewDocument(deps)

    const pending = onNewFile()
    await Promise.resolve()

    expect(deps.fileIO.newFile).toHaveBeenCalledTimes(1)
    expect(showPrompt.value).toBe(false)

    release()
    await pending

    expect(showPrompt.value).toBe(true)
  })

  it('S-020: should leave the document unchanged when the name prompt is cancelled', async () => {
    const deps = {
      fileIO: { newFile: vi.fn(async () => {}) },
      store: { newDocument: vi.fn() },
    }
    const { showPrompt, onNewFile, onCancel } = useNewDocument(deps)

    await onNewFile()
    expect(showPrompt.value).toBe(true)

    onCancel()

    expect(showPrompt.value).toBe(false)
    expect(deps.store.newDocument).not.toHaveBeenCalled()
  })
})
