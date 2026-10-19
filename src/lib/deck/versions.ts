// Version history (step 3h): reading saved versions, comparing two deck states, and restoring one.
// Versions are full snapshots (deck_versions.cards, migration 0010), so any two compare directly.
import { BOARDS, entryKey, parseKey, type Board, type Categories, type Change, type Entries, type Plan } from "./model";

export type VersionMeta = { id: string; created_at: string; kind: "auto" | "manual"; name: string | null; card_count: number };
export type DeckState = { entries: Entries; categories: Categories };

/** deck_versions.cards ([[oracle_id, board, quantity, category], ...]) as entries and categories. */
export function readSnapshot(raw: unknown): DeckState {
  const entries: Entries = {};
  const categories: Categories = {};
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!Array.isArray(r)) continue;
    const [id, board, quantity, category] = r as [unknown, unknown, unknown, unknown];
    if (typeof id !== "string" || !BOARDS.includes(board as Board) || typeof quantity !== "number" || quantity <= 0) continue;
    const k = entryKey(board as Board, id);
    entries[k] = quantity;
    if (typeof category === "string" && category) categories[k] = category;
  }
  return { entries, categories };
}

export type DiffLine = { oracle_id: string; board: Board; from: number; to: number };
export type DeckDiff = { added: DiffLine[]; removed: DiffLine[]; changed: DiffLine[]; categorized: number };

/** What changed going from `before` to `after`, per board. Copies added or removed count as "changed". */
export function diffDecks(before: DeckState, after: DeckState): DeckDiff {
  const keys = new Set([...Object.keys(before.entries), ...Object.keys(after.entries)]);
  const diff: DeckDiff = { added: [], removed: [], changed: [], categorized: 0 };
  for (const k of keys) {
    const from = before.entries[k] ?? 0;
    const to = after.entries[k] ?? 0;
    const { board, oracle_id } = parseKey(k);
    const line = { oracle_id, board, from, to };
    if (from === 0 && to > 0) diff.added.push(line);
    else if (from > 0 && to === 0) diff.removed.push(line);
    else if (from !== to) diff.changed.push(line);
    else if ((before.categories[k] ?? null) !== (after.categories[k] ?? null)) diff.categorized++;
  }
  return diff;
}

/** "+3 / −2" for the version list: cards added and removed going from the version to now. */
export function diffSummary(d: DeckDiff) {
  const plus = d.added.reduce((n, l) => n + l.to, 0) + d.changed.reduce((n, l) => n + Math.max(0, l.to - l.from), 0);
  const minus = d.removed.reduce((n, l) => n + l.from, 0) + d.changed.reduce((n, l) => n + Math.max(0, l.from - l.to), 0);
  return { plus, minus };
}

/**
 * Turns the deck back into a saved version: one Change (one undo step) covering every card count and category
 * that differs. `snapshot` makes the save keep the current deck as a version first.
 */
export function planRestore(current: DeckState, target: DeckState, label: string, snapshot: string): Plan {
  const keys = new Set([...Object.keys(current.entries), ...Object.keys(target.entries)]);
  const rows: Change["rows"] = [];
  for (const k of keys) {
    const from = current.entries[k] ?? 0;
    const to = target.entries[k] ?? 0;
    if (from !== to) rows.push({ ...parseKey(k), from, to });
  }
  const catKeys = new Set([...Object.keys(current.categories), ...Object.keys(target.categories)]);
  const categories: NonNullable<Change["categories"]> = [];
  for (const k of catKeys) {
    const from = current.categories[k] ?? null;
    const to = target.entries[k] ? (target.categories[k] ?? null) : null;
    if (from !== to) categories.push({ ...parseKey(k), from, to });
  }
  if (!rows.length && !categories.length) return { ok: false, reason: "The deck already matches that version." };
  return { ok: true, change: { label, rows, categories, snapshot } };
}

/** "Oct 19, 2026, 8:15 PM" in the viewer's own time zone. */
export const versionDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export const versionTitle = (v: VersionMeta) => v.name ?? (v.kind === "auto" ? "Automatic save" : "Saved version");
