import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Toaster from './Toaster.vue'
import { useToastsStore } from '../stores/toasts.js'

// Toaster is the only consumer of the toasts store. Its whole contract is:
// render one readable line per toast, tag it by severity, and disappear when the
// writer dismisses it or the store's timer fires.

describe('Toaster', () => {
  let pinia

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const mountToaster = () => mount(Toaster, { global: { plugins: [pinia] } })

  it('renders nothing while the queue is empty', () => {
    const wrapper = mountToaster()

    expect(wrapper.find('.toaster').exists()).toBe(false)
  })

  it('renders one toast per queued entry, oldest first', () => {
    const store = useToastsStore()
    store.pushToast({ type: 'error', message: 'Save failed' })
    store.pushToast({ type: 'success', message: 'Saved' })

    const wrapper = mountToaster()
    const toasts = wrapper.findAll('.toast')

    expect(toasts).toHaveLength(2)
    expect(toasts[0].text()).toContain('Save failed')
    expect(toasts[1].text()).toContain('Saved')
  })

  it('tags each toast with its severity so the accent stripe can differ', () => {
    const store = useToastsStore()
    store.pushToast({ type: 'error', message: 'Save failed' })
    store.pushToast({ type: 'success', message: 'Saved' })
    store.pushToast({ type: 'info', message: 'Indexing' })

    const toasts = mountToaster().findAll('.toast')

    expect(toasts.map((toast) => toast.classes())).toEqual([
      expect.arrayContaining(['type-error']),
      expect.arrayContaining(['type-success']),
      expect.arrayContaining(['type-info']),
    ])
  })

  it('dismisses a toast when the writer clicks it', async () => {
    const store = useToastsStore()
    store.pushToast({ type: 'error', message: 'Save failed' })
    const wrapper = mountToaster()

    await wrapper.find('.toast').trigger('click')

    expect(store.toasts).toHaveLength(0)
    expect(wrapper.find('.toaster').exists()).toBe(false)
  })

  it('removes a toast on its own after the auto-dismiss delay', async () => {
    const store = useToastsStore()
    store.pushToast({ type: 'info', message: 'Indexing' })
    const wrapper = mountToaster()
    expect(wrapper.findAll('.toast')).toHaveLength(1)

    vi.advanceTimersByTime(5000)
    await wrapper.vm.$nextTick()

    expect(store.toasts).toHaveLength(0)
    expect(wrapper.find('.toaster').exists()).toBe(false)
  })

  it('keeps the remaining toasts when one is dismissed', async () => {
    const store = useToastsStore()
    store.pushToast({ type: 'error', message: 'First' })
    store.pushToast({ type: 'info', message: 'Second' })
    const wrapper = mountToaster()

    await wrapper.findAll('.toast')[0].trigger('click')

    expect(wrapper.findAll('.toast')).toHaveLength(1)
    expect(wrapper.find('.toast').text()).toContain('Second')
  })
})
