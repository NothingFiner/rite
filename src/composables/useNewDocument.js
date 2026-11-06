// The new-document flow (SPEC.md S-019, S-020).
//
// The guard (`fileIO.newFile`) may ask the writer to save unsaved work. The
// name prompt must appear only after that guard returns, so a cancelled save
// dialog does not leave a dangling prompt.

import { ref } from 'vue'

export function useNewDocument(deps) {
  const showPrompt = ref(false)

  async function onNewFile() {
    await deps.fileIO.newFile()
    showPrompt.value = true
  }

  async function onConfirm(name) {
    showPrompt.value = false
    await deps.store.newDocument(name)
  }

  function onCancel() {
    showPrompt.value = false
  }

  return { showPrompt, onNewFile, onConfirm, onCancel }
}