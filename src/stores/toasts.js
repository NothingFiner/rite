import { defineStore } from 'pinia'

// Module-level incrementing counter for toast ids. Avoids Math.random/Date so
// ids are deterministic, cheap, and stable across the session.
let nextToastId = 1

/// Auto-dismiss delay for toasts. ~5s is long enough to read a short error
/// message but short enough not to pile up if many fire in succession.
const AUTO_DISMISS_DELAY_MS = 5000

export const useToastsStore = defineStore('toasts', {
  state: () => ({
    toasts: [],
  }),

  actions: {
    /// Append a toast { type, message } and schedule auto-dismiss after ~5s.
    /// `type` is one of 'error' | 'success' | 'info'. Returns the generated id.
    pushToast({ type, message }) {
      const id = nextToastId++
      this.toasts.push({ id, type, message })
      setTimeout(() => this.dismissToast(id), AUTO_DISMISS_DELAY_MS)
      return id
    },

    /// Remove a toast by id. No-op if the id is no longer present (e.g. the
    /// toast was already dismissed manually before the timer fired).
    dismissToast(id) {
      const index = this.toasts.findIndex((t) => t.id === id)
      if (index !== -1) this.toasts.splice(index, 1)
    },
  },
})