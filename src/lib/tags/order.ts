// Your own order for the left column (v2: reorder roles and top tags). Saved as lists of keys in
// profiles.tag_view (roleOrder, tagOrder), so it follows you into every deck.

/** Items with a saved place first, in that order; the rest after them in their usual order. */
export function applyOrder<T>(items: T[], keyOf: (item: T) => string, order: readonly string[] | undefined): T[] {
  if (!order?.length) return items;
  const rank = new Map(order.map((k, i) => [k, i]));
  const placed = items.filter((it) => rank.has(keyOf(it))).sort((a, b) => rank.get(keyOf(a))! - rank.get(keyOf(b))!);
  return [...placed, ...items.filter((it) => !rank.has(keyOf(it)))];
}

/** Moves `key` to where `over` is now (after it when moving down, before it when moving up). */
export function moveKey(keys: readonly string[], key: string, over: string): string[] {
  const from = keys.indexOf(key);
  const to = keys.indexOf(over);
  if (from < 0 || to < 0 || from === to) return [...keys];
  const next = keys.filter((k) => k !== key);
  next.splice(to, 0, key);
  return next;
}

/** The new saved order: what's on screen now, then earlier saved keys from other decks, capped. */
export function mergeOrder(visible: readonly string[], saved: readonly string[] | undefined, cap = 200): string[] {
  const seen = new Set(visible);
  return [...visible, ...(saved ?? []).filter((k) => !seen.has(k))].slice(0, cap);
}

export function readOrder(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((k): k is string => typeof k === "string") : [];
}
