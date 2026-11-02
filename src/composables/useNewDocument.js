// The new-document flow (SPEC.md S-019, S-020).
//
// STUB — signatures only. The implementer fills these in and wires them into
// App.vue, replacing the inline onNewFile / onConfirmNewDocument handlers.
//
// The guard (`fileIO.newFile`) may ask the writer to save unsaved work. The name
// prompt must appear only after that guard returns, so a cancelled save dialog
// does not leave a dangling prompt.

import { ref } from 'vue'

export function useNewDocument(_deps) {
  const showPrompt = ref(false)

  async function onNewFile() {}

  async function onConfirm(_name) {}

  function onCancel() {}

  return { showPrompt, onNewFile, onConfirm, onCancel }
}
