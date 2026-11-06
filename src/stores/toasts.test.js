import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useToastsStore } from './toasts.js'

describe('useToastsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initializes with an empty toasts list', () => {
    const store = useToastsStore()
    expect(store.toasts).toEqual([])
  })

  it('pushToast appends a toast with an id and schedules auto-dismiss', () => {
    vi.useFakeTimers()
    const store = useToastsStore()
    const id = store.pushToast({ type: 'error', message: 'Something broke' })

    expect(store.toasts).toHaveLength(1)
    expect(store.toasts[0]).toEqual({ id, type: 'error', message: 'Something broke' })

    // Auto-dismiss fires after ~5s.
    vi.advanceTimersByTime(5000)
    expect(store.toasts).toEqual([])
    vi.useRealTimers()
  })

  it('pushToast generates incrementing ids', () => {
    const store = useToastsStore()
    const id1 = store.pushToast({ type: 'info', message: 'one' })
    const id2 = store.pushToast({ type: 'success', message: 'two' })
    expect(id2).toBe(id1 + 1)
    expect(store.toasts).toHaveLength(2)
  })

  it('dismissToast removes the toast with the given id', () => {
    const store = useToastsStore()
    const id = store.pushToast({ type: 'error', message: 'oops' })
    // Test dismissToast directly rather than waiting on the timer.
    store.dismissToast(id)
    expect(store.toasts).toEqual([])
  })

  it('dismissToast is a no-op for an unknown id', () => {
    const store = useToastsStore()
    store.pushToast({ type: 'info', message: 'stay' })
    store.dismissToast(999999)
    expect(store.toasts).toHaveLength(1)
  })
})