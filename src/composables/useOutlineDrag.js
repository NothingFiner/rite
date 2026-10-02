// Pure helpers for the outline drag-reorder in NavigationDrawer (roadmap
// 5.5). Split out of the component into a pure composable per the house
// pattern: NO DOM reads inside the helpers — geometry is passed in — so these
// are unit-testable in jsdom without faking layout, and the component stays a
// thin event-wiring shell.
//
// The reorder itself is one `move_section(id, to_after_id)` invoke (Rust holds
// the document; the store assigns Rust's returned doc back). These helpers
// compute ONLY which invoke to make from the drop gesture.

// Which half of the hovered row the pointer is in — the midpoint rule. The
// caller passes `event.currentTarget.getBoundingClientRect()`; jsdom returns
// all-zero rects, which deterministically lands every Y at or below the
// midpoint (0), so tests get a stable 'after'.
export function dropHalf(rect, clientY) {
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

// The `to_after_id` for a drop on `items[targetIndex]` in the given half.
// 'before' targets the PREVIOUS row's id (null = front of the list); 'after'
// targets the row itself. `items` are the nav rows ({ id, ... }), in display
// order.
export function toAfterIdFor(items, targetIndex, half) {
  if (half === 'before') {
    return targetIndex === 0 ? null : items[targetIndex - 1].id
  }
  return items[targetIndex].id
}

// The section-id order the drop would produce, or null when the drop is a
// no-op (the order already matches — e.g. dropping a row right back where it
// sits). `ids` is the current order; the dragged section is removed and
// reinserted after `toAfterId` (null = front). Returning null (instead of an
// identical array) lets the caller skip the invoke entirely — no wasted Rust
// round-trip, no journal delta.
export function reorderedIds(ids, draggedId, toAfterId) {
  // A row can't follow itself — the component never targets the dragged row,
  // but keep the helper total on its own.
  if (toAfterId === draggedId) return null
  const without = ids.filter((id) => id !== draggedId)
  const result =
    toAfterId === null
      ? [draggedId, ...without]
      : without.flatMap((id, index) =>
          id === toAfterId ? [id, draggedId] : [id],
        )
  // If toAfterId isn't in the list (shouldn't happen — the target row exists)
  // the flatMap never inserts; compare-and-null below then reports no-op.
  return result.length === ids.length && result.every((id, i) => id === ids[i])
    ? null
    : result
}