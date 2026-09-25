import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, reactive, nextTick } from 'vue'

vi.mock('@tauri-apps/api/tauri', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/tauri'
import { useRoles } from './useRoles.js'

// A stand-in for the reactive-wrapped useChatManager the drawer receives. In
// production `chatManager = reactive(useChatManager(...))`, so `chatManager.roles`
// auto-unwraps the ref to the array and `refreshRoles()` passes through the
// proxy. The test mirrors that with `reactive({ roles: ref([...]) })`.
function makeChatManager(initialRoles = []) {
  const roles = ref(initialRoles)
  return reactive({
    roles,
    refreshRoles: vi.fn(async () => {}),
  })
}

function builtIn(name, description = 'desc', personaBody = 'body') {
  return { name, description, body: 'composed', personaBody, isBuiltIn: true }
}
function custom(name, description = 'desc', personaBody = 'body') {
  return { name, description, body: 'composed', personaBody, isBuiltIn: false }
}

describe('useRoles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('roles computed reflects the manager list', async () => {
    const manager = makeChatManager([builtIn('Critic')])
    const { roles } = useRoles(manager)
    expect(roles.value).toHaveLength(1)
    expect(roles.value[0].name).toBe('Critic')
    // A manager-side reload (refresh mutates the ref) is tracked by the computed.
    manager.roles = [builtIn('Critic'), custom('Beta')]
    await nextTick()
    expect(roles.value).toHaveLength(2)
  })

  it('startNew opens a blank form in create mode', () => {
    const r = useRoles(makeChatManager())
    // Pretend a prior edit left stale draft state.
    r.draftName.value = 'stale'
    r.draftBody.value = 'stale body'
    r.startNew()
    expect(r.isCreating.value).toBe(true)
    expect(r.editing.value).toBeNull()
    expect(r.draftName.value).toBe('')
    expect(r.draftDescription.value).toBe('')
    expect(r.draftBody.value).toBe('')
  })

  it('startEdit prefills from an existing custom role', () => {
    const manager = makeChatManager([custom('Beta', 'a friend', 'be kind')])
    const { editing, isCreating, draftName, draftDescription, draftBody, startEdit } = useRoles(manager)
    startEdit(manager.roles[0])
    expect(isCreating.value).toBe(false)
    expect(editing.value).toBe(manager.roles[0])
    expect(draftName.value).toBe('Beta')
    expect(draftDescription.value).toBe('a friend')
    expect(draftBody.value).toBe('be kind')
  })

  it('copyToCustom prefills with the built-in name + " (copy)"', () => {
    const manager = makeChatManager([builtIn('Critic', 'feedback', 'be critical')])
    const { editing, isCreating, draftName, draftDescription, draftBody, copyToCustom } = useRoles(manager)
    copyToCustom(manager.roles[0])
    expect(isCreating.value).toBe(true)
    expect(editing.value).toBeNull()
    expect(draftName.value).toBe('Critic (copy)')
    expect(draftDescription.value).toBe('feedback')
    expect(draftBody.value).toBe('be critical')
  })

  it('cancelEdit closes the form and resets the draft', () => {
    const { editing, isCreating, draftName, draftBody, startNew, cancelEdit } = useRoles(makeChatManager())
    startNew()
    draftName.value = 'something'
    draftBody.value = 'body'
    cancelEdit()
    expect(isCreating.value).toBe(false)
    expect(editing.value).toBeNull()
    expect(draftName.value).toBe('')
    expect(draftBody.value).toBe('')
  })

  it('save rejects an empty name without invoking', async () => {
    const manager = makeChatManager()
    const { startNew, save, roleError } = useRoles(manager)
    startNew()
    await save()
    expect(invoke).not.toHaveBeenCalled()
    expect(roleError.value).toBe('Name is required.')
    // Form stays open.
    expect(roleError.value).toBeTruthy()
  })

  it('save rejects a name clashing with another custom role', async () => {
    const manager = makeChatManager([custom('Beta')])
    const { startNew, draftName, save, roleError } = useRoles(manager)
    startNew()
    draftName.value = 'Beta'
    await save()
    expect(invoke).not.toHaveBeenCalled()
    expect(roleError.value).toContain('already exists')
  })

  it('save allows a name matching a built-in (intentional override)', async () => {
    invoke.mockResolvedValue(undefined)
    const manager = makeChatManager([builtIn('Critic')])
    const { startNew, draftName, draftBody, save, roleError } = useRoles(manager)
    startNew()
    draftName.value = 'Critic'
    draftBody.value = 'my critic body'
    await save()
    expect(invoke).toHaveBeenCalledWith('save_role', {
      name: 'Critic',
      description: '',
      personaBody: 'my critic body',
    })
    expect(roleError.value).toBe('')
  })

  it('save allows keeping the same name when editing (exclude self)', async () => {
    invoke.mockResolvedValue(undefined)
    const beta = custom('Beta', 'a friend', 'be kind')
    const manager = makeChatManager([beta])
    const { startEdit, draftBody, save, roleError } = useRoles(manager)
    startEdit(beta)
    draftBody.value = 'be kinder' // change only the body, keep the name
    await save()
    expect(invoke).toHaveBeenCalledWith('save_role', {
      name: 'Beta',
      description: 'a friend',
      personaBody: 'be kinder',
    })
    expect(roleError.value).toBe('')
  })

  it('save calls refreshRoles and closes the form on success', async () => {
    invoke.mockResolvedValue(undefined)
    const manager = makeChatManager([custom('Beta')])
    const { startNew, draftName, draftBody, save, editing, isCreating } = useRoles(manager)
    startNew()
    draftName.value = 'New Role'
    draftBody.value = 'body'
    await save()
    expect(manager.refreshRoles).toHaveBeenCalledTimes(1)
    expect(isCreating.value).toBe(false)
    expect(editing.value).toBeNull()
  })

  it('save sets roleError and keeps the form open on invoke failure', async () => {
    invoke.mockRejectedValue('disk full')
    const manager = makeChatManager()
    const { startNew, draftName, save, roleError, isCreating, roleSaving } = useRoles(manager)
    startNew()
    draftName.value = 'New'
    await save()
    expect(roleError.value).toBe('disk full')
    expect(isCreating.value).toBe(true) // form stays open so they can retry
    expect(roleSaving.value).toBe(false)
  })

  it('remove calls delete_role with the name and refreshes', async () => {
    invoke.mockResolvedValue(undefined)
    const beta = custom('Beta')
    const manager = makeChatManager([beta])
    const { remove } = useRoles(manager)
    await remove(beta)
    expect(invoke).toHaveBeenCalledWith('delete_role', { name: 'Beta' })
    expect(manager.refreshRoles).toHaveBeenCalledTimes(1)
  })

  it('remove sets roleError on invoke failure', async () => {
    invoke.mockRejectedValue('no such file')
    const beta = custom('Beta')
    const manager = makeChatManager([beta])
    const { remove, roleError } = useRoles(manager)
    await remove(beta)
    expect(roleError.value).toBe('no such file')
  })
})