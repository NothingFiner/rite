// Role editor composable for the General Options "Roles" accordion (Phase 4.5).
//
// Owns the create/edit/delete flow for user-authored roles. The role LIST comes
// from `chatManager.roles` (built-in + user roles merged server-side by
// `list_roles`); this composable adds the editor's draft state + the
// `save_role`/`delete_role` calls, then calls `chatManager.refreshRoles()` so
// the Assistant role selector updates live. Built-in roles are read-only in the
// UI (the template gates edit/delete on `!role.isBuiltIn`); a "copy to custom"
// action prefills the form from a built-in's persona body so a writer can fork
// it into an editable user role (saving with the built-in's exact name creates a
// user override — user wins on collision, per Rust's `merge_roles`).
//
// The body the editor shows/edits is `personaBody` — the UN-composed persona
// only. The shared `_base.md` analytical-only rules are NEVER shown or edited;
// Rust composes them on top at read time, so the "never writes into the doc"
// guarantee is structural, not a setting the user can turn off.
//
// Factory returning refs + methods. The drawer builds it once in <script setup>
// from the reactive `chatManager` prop (auto-unwraps `chatManager.roles` to the
// array; method calls like `refreshRoles()` pass through the reactive proxy).

import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/tauri'

export function useRoles(chatManager) {
  /// The role being edited, or null when the form is closed or creating a new
  /// role. For an edit it's the role object so `save` can exclude it from the
  /// name-uniqueness check (renaming to its own name is allowed).
  const editing = ref(null)
  /// True when the form is creating a brand-new role (vs editing an existing
  /// one). Drives which buttons show.
  const isCreating = ref(false)
  const draftName = ref('')
  const draftDescription = ref('')
  /// The UN-composed persona body (base rules NOT included).
  const draftBody = ref('')
  /// Validation / save-delete error string; cleared at the start of each
  /// `save`/`remove` so a stale error doesn't linger after a success.
  const roleError = ref('')
  const roleSaving = ref(false)

  /// The merged role list, read off the manager. A computed so the template
  /// tracks a manager-side reload (e.g. after a save in another tab).
  const roles = computed(() => chatManager.roles || [])

  function resetDraft() {
    draftName.value = ''
    draftDescription.value = ''
    draftBody.value = ''
    roleError.value = ''
  }

  /// Open a blank form for a new role.
  function startNew() {
    editing.value = null
    isCreating.value = true
    resetDraft()
  }

  /// Open the form prefilled from an existing custom role for editing.
  function startEdit(role) {
    editing.value = role
    isCreating.value = false
    draftName.value = role.name
    draftDescription.value = role.description
    draftBody.value = role.personaBody
    roleError.value = ''
  }

  /// Open a form prefilled with a built-in's persona + description (name set to
  /// "<name> (copy)") so the writer can fork it into a user role. Editing the
  /// name back to the built-in's exact name creates an override.
  function copyToCustom(role) {
    editing.value = null
    isCreating.value = true
    draftName.value = role.name + ' (copy)'
    draftDescription.value = role.description
    draftBody.value = role.personaBody
    roleError.value = ''
  }

  function cancelEdit() {
    editing.value = null
    isCreating.value = false
    resetDraft()
  }

  /// Save the draft (create or overwrite). Validates: name non-empty, and the
  /// name isn't taken by ANOTHER custom role (a name colliding with a built-in
  /// is allowed — that's an intentional override). On success refreshes the list
  /// + closes the form; on error keeps the form open with `roleError` set.
  async function save() {
    roleError.value = ''
    const name = draftName.value.trim()
    if (!name) {
      roleError.value = 'Name is required.'
      return
    }
    // Uniqueness only among CUSTOM roles (built-in collisions are intentional
    // overrides). Exclude the role currently being edited.
    const editingName = editing.value?.name
    const clash = roles.value.some(
      (r) => !r.isBuiltIn && r.name === name && r.name !== editingName,
    )
    if (clash) {
      roleError.value = `A custom role named "${name}" already exists.`
      return
    }
    roleSaving.value = true
    try {
      await invoke('save_role', {
        name,
        description: draftDescription.value.trim(),
        personaBody: draftBody.value,
      })
      await chatManager.refreshRoles()
      cancelEdit()
    } catch (e) {
      roleError.value = typeof e === 'string' ? e : (e?.message || String(e))
    } finally {
      roleSaving.value = false
    }
  }

  /// Delete a user role file. The template confirms before calling. Built-in
  /// roles are never passed here (no delete button on built-in rows); if one
  /// were, Rust would error because no user file exists for that name.
  async function remove(role) {
    roleError.value = ''
    try {
      await invoke('delete_role', { name: role.name })
      await chatManager.refreshRoles()
    } catch (e) {
      roleError.value = typeof e === 'string' ? e : (e?.message || String(e))
    }
  }

  return {
    roles,
    editing,
    isCreating,
    draftName,
    draftDescription,
    draftBody,
    roleError,
    roleSaving,
    startNew,
    startEdit,
    copyToCustom,
    cancelEdit,
    save,
    remove,
  }
}