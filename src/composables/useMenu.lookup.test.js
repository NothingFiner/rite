// The lookup route (SPEC.md revision 6, S-111).
//
// A lookup id is `look_up_reference:<entry id>`: the menu already decided which
// entries the word belongs to, so the id names one. These tests pin that
// parsing, and that every other id still runs with no argument at all.

import { describe, expect, it, vi } from 'vitest'
import { LOOKUP_ID_PREFIX, runMenuAction } from './useMenu.js'

function actions(overrides = {}) {
  return {
    undo: vi.fn(),
    thesaurus: vi.fn(),
    look_up_reference: vi.fn(),
    ...overrides,
  }
}

describe('reference lookup ids', () => {
  it('S-111: opens the entry the id names, and ignores an id that names none', () => {
    const handlers = actions()

    expect(runMenuAction(`${LOOKUP_ID_PREFIX}e-queln`, handlers)).toBe(true)
    expect(handlers.look_up_reference).toHaveBeenCalledWith('e-queln')
    expect(handlers.look_up_reference.mock.calls[0]).toHaveLength(1)

    // A bare prefix names no entry, so it must not open anything.
    expect(runMenuAction(LOOKUP_ID_PREFIX, handlers)).toBe(false)
    expect(handlers.look_up_reference).toHaveBeenCalledTimes(1)

    // Positive control: an ordinary id still runs, with no argument.
    expect(runMenuAction('thesaurus', handlers)).toBe(true)
    expect(handlers.thesaurus).toHaveBeenCalledTimes(1)
    expect(handlers.thesaurus.mock.calls[0]).toHaveLength(0)
  })
})
