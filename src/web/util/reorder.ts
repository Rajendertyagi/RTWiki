/**
 * Reorders items to match an externally supplied list of ids.
 *
 * This is what a drag reports: the reorder library computes the new order during
 * the gesture and hands it over whole, so the component does not have to know how
 * the drag was performed.
 *
 * ## Why it is defensive rather than trusting
 *
 * Two failures are worth more than the reordering, so both are made impossible
 * rather than merely unlikely:
 *
 * - **Nothing is lost.** Ids the caller left out are *appended in their existing
 *   order*, not dropped. A partial or stale list therefore cannot silently
 *   discard a tab or a diagram — losing a diagram would lose the reader's work.
 * - **Nothing is duplicated.** An id listed twice must not clone the item.
 *
 * Unknown ids are ignored, because the list is derived from what was on screen and
 * an id that is not there cannot be ordered.
 *
 * ## Why the same array is returned when nothing moved
 *
 * A new array reference makes React re-render, and a re-render of a workspace
 * means re-rendering every diagram. Returning the original reference when the
 * order is genuinely unchanged lets React skip that. Length alone is not enough
 * to decide this: the same ids can arrive in a different order.
 */
export function reorderByIds<T>(
  items: readonly T[],
  orderedIds: readonly string[],
  idOf: (item: T) => string
): T[] {
  const byId = new Map<string, T>()
  for (const item of items) byId.set(idOf(item), item)

  const next: T[] = []
  const taken = new Set<string>()
  for (const id of orderedIds) {
    const item = byId.get(id)
    if (item !== undefined && !taken.has(id)) {
      next.push(item)
      taken.add(id)
    }
  }

  if (next.length === items.length) {
    const unchanged = next.every((item, i) => item === items[i])
    return unchanged ? (items as T[]) : next
  }

  for (const item of items) {
    if (!taken.has(idOf(item))) next.push(item)
  }
  return next
}
