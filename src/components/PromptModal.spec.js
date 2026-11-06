import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PromptModal from './PromptModal.vue'

// PromptModal asks for one line of text. The behaviour that matters is the
// guard rail: an empty name cannot be confirmed, so a document can never be
// created without one — and the guard applies to Enter as well as the button.

const mountOpen = (props = {}) =>
  mount(PromptModal, { props: { visible: true, title: 'New document', ...props } })

describe('PromptModal', () => {
  it('renders nothing while invisible', () => {
    const wrapper = mount(PromptModal, { props: { visible: false } })

    expect(wrapper.find('.prompt-overlay').exists()).toBe(false)
  })

  it('renders the title, message, placeholder and confirm label it is given', () => {
    const wrapper = mountOpen({
      message: 'Give the file a name.',
      placeholder: 'Untitled',
      confirmLabel: 'Create',
    })

    expect(wrapper.find('.prompt-title').text()).toBe('New document')
    expect(wrapper.find('.prompt-message').text()).toBe('Give the file a name.')
    expect(wrapper.find('.prompt-input').attributes('placeholder')).toBe('Untitled')
    expect(wrapper.find('.btn-primary').text()).toBe('Create')
  })

  it('seeds the input with initialValue when it opens', () => {
    const wrapper = mountOpen({ initialValue: 'chapter-one' })

    expect(wrapper.find('.prompt-input').element.value).toBe('chapter-one')
  })

  it('disables confirm while the value is empty', async () => {
    const wrapper = mountOpen()
    const confirm = wrapper.find('.btn-primary')

    expect(confirm.attributes('disabled')).toBeDefined()

    await wrapper.find('.prompt-input').setValue('   ')
    expect(confirm.attributes('disabled')).toBeDefined()

    await wrapper.find('.prompt-input').setValue('Chapter One')
    expect(confirm.attributes('disabled')).toBeUndefined()
  })

  it('allows an empty value when the caller opts in', async () => {
    const wrapper = mountOpen({ allowEmpty: true })

    expect(wrapper.find('.btn-primary').attributes('disabled')).toBeUndefined()

    await wrapper.find('.btn-primary').trigger('click')
    expect(wrapper.emitted('confirm')[0]).toEqual([''])
  })

  it('emits the trimmed value on confirm', async () => {
    const wrapper = mountOpen()

    await wrapper.find('.prompt-input').setValue('  Chapter One  ')
    await wrapper.find('.btn-primary').trigger('click')

    expect(wrapper.emitted('confirm')[0]).toEqual(['Chapter One'])
  })

  it('does not emit confirm for an empty value, by button or by Enter', async () => {
    const wrapper = mountOpen()
    const input = wrapper.find('.prompt-input')

    await wrapper.find('.btn-primary').trigger('click')
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('confirms on Enter', async () => {
    const wrapper = mountOpen()

    await wrapper.find('.prompt-input').setValue('Chapter One')
    await wrapper.find('.prompt-input').trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('confirm')[0]).toEqual(['Chapter One'])
  })

  it('cancels on Escape', async () => {
    const wrapper = mountOpen()

    await wrapper.find('.prompt-input').trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('cancels on a click outside the panel but not inside it', async () => {
    const wrapper = mountOpen()

    await wrapper.find('.prompt-modal').trigger('click')
    expect(wrapper.emitted('cancel')).toBeUndefined()

    await wrapper.find('.prompt-overlay').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('cancels from the Cancel button', async () => {
    const wrapper = mountOpen()

    await wrapper.find('.btn-ghost').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('does not overwrite what the writer is typing when props change mid-open', async () => {
    const wrapper = mountOpen({ initialValue: 'first' })

    await wrapper.find('.prompt-input').setValue('typed by hand')
    await wrapper.setProps({ initialValue: 'second' })

    expect(wrapper.find('.prompt-input').element.value).toBe('typed by hand')
  })

  it('re-seeds the input the next time it opens', async () => {
    const wrapper = mountOpen({ initialValue: 'first' })
    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true, initialValue: 'second' })

    expect(wrapper.find('.prompt-input').element.value).toBe('second')
  })
})
