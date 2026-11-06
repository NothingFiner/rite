import { describe, it, expect } from 'vitest'
import { dropHalf, toAfterIdFor, reorderedIds } from './useOutlineDrag.js'

describe('dropHalf', () => {
  it('returns before for a pointer above the midpoint', () => {
    // Row spanning y 100–140: midpoint 120.
    expect(dropHalf({ top: 100, height: 40 }, 100)).toBe('before')
    expect(dropHalf({ top: 100, height: 40 }, 119)).toBe('before')
  })

  it('returns after for a pointer at or below the midpoint', () => {
    expect(dropHalf({ top: 100, height: 40 }, 120)).toBe('after')
    expect(dropHalf({ top: 100, height: 40 }, 140)).toBe('after')
  })

  it('lands deterministically on after for jsdom zero rects', () => {
    // jsdom getBoundingClientRect returns all zeros — every Y is at the
    // midpoint, so the component spec gets a stable 'after' half.
    expect(dropHalf({ top: 0, height: 0 }, 0)).toBe('after')
  })
})

describe('toAfterIdFor', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('targets the previous row for before', () => {
    expect(toAfterIdFor(items, 2, 'before')).toBe('b')
    expect(toAfterIdFor(items, 1, 'before')).toBe('a')
  })

  it('targets null (front) for before on the first row', () => {
    expect(toAfterIdFor(items, 0, 'before')).toBeNull()
  })

  it('targets the hovered row for after', () => {
    expect(toAfterIdFor(items, 1, 'after')).toBe('b')
    expect(toAfterIdFor(items, 2, 'after')).toBe('c')
  })
})

describe('reorderedIds', () => {
  it('moves a section after a later one', () => {
    expect(reorderedIds(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a'])
  })

  it('moves a later section after an earlier one', () => {
    expect(reorderedIds(['a', 'b', 'c'], 'c', 'a')).toEqual(['a', 'c', 'b'])
  })

  it('moves a section to the front for null', () => {
    expect(reorderedIds(['a', 'b', 'c'], 'b', null)).toEqual(['b', 'a', 'c'])
  })

  it('returns null when the section is already at the front', () => {
    expect(reorderedIds(['a', 'b', 'c'], 'a', null)).toBeNull()
  })

  it('returns null for a drop onto the dragged row itself', () => {
    expect(reorderedIds(['a', 'b', 'c'], 'b', 'b')).toBeNull()
  })

  it('returns null for a drop that lands on the current position', () => {
    // Dropping 'c' after 'b' when the order is a,b,c changes nothing.
    expect(reorderedIds(['a', 'b', 'c'], 'c', 'b')).toBeNull()
    // Same for 'b' after 'a'.
    expect(reorderedIds(['a', 'b', 'c'], 'b', 'a')).toBeNull()
  })

  it('handles a two-row swap', () => {
    expect(reorderedIds(['a', 'b'], 'a', 'b')).toEqual(['b', 'a'])
    expect(reorderedIds(['a', 'b'], 'b', null)).toEqual(['b', 'a'])
  })
})