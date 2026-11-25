// Use the printings I own (V3): when a card joins a deck with no printing picked, use a printing from your
// collection. A default printing you chose yourself (preferred_printings) still wins, since you picked it on
// purpose. Applies to anything added as a new row: search, quick add, drag and drop, imports, the land base.
// Turned off with Settings › Printings you own (profiles.tag_view.ownedPrintings = false). No migration.
import { isFoilFinish, type Collection, type OwnedRow } from "./collection";
import { entryKey, type Change, type PreferredPrintings, type PrintingChange, type Printings } from "./model";
import { foilFor, type ChosenPrinting } from "./printing";

/** On unless switched off. */
export const readOwnedPrintings = (prefs: Record<string, unknown>) => prefs.ownedPrintings !== false;

/**
 * The printing to use from your collection: the known printing you own most copies of (nonfoil first on a tie,
 * then the one added first). Copies with an unknown printing don't count. Null when you own none.
 */
export function ownedPrintingFor(c: Collection, oracleId: string): ChosenPrinting | null {
  // Copies of one printing and finish can sit in several binders (migration 0067): count them together.
  const merged = new Map<string, OwnedRow>();
  for (const r of c.get(oracleId) ?? []) {
    if (!r.printing_id || !r.printing_info || r.quantity <= 0) continue;
    const k = `${r.printing_id}|${r.finish}`;
    const had = merged.get(k);
    merged.set(k, had ? { ...had, quantity: had.quantity + r.quantity, added_at: (had.added_at ?? "") < (r.added_at ?? "") ? had.added_at : r.added_at } : r);
  }
  const rows = [...merged.values()];
  if (!rows.length) return null;
  const best = [...rows].sort(
    (a, b) =>
      b.quantity - a.quantity || Number(isFoilFinish(a.finish)) - Number(isFoilFinish(b.finish)) || (a.added_at ?? "").localeCompare(b.added_at ?? ""),
  )[0];
  const info = best.printing_info!;
  return { ...info, id: best.printing_id!, foil: foilFor(info.finishes, isFoilFinish(best.finish)) };
}

/**
 * Adds the owned printing to each new row in a change that has none yet. Rows that already have a printing (in
 * the deck or in the change itself) and cards with a default printing of your own are left as they are.
 */
export function pinOwnedPrintings(change: Change, printings: Printings, preferred: PreferredPrintings, c: Collection): Change {
  if (c.size === 0) return change;
  const touched = new Set((change.printings ?? []).map((p) => entryKey(p.board, p.oracle_id)));
  const extra: PrintingChange[] = [];
  for (const r of change.rows) {
    const key = entryKey(r.board, r.oracle_id);
    if (r.from !== 0 || r.to <= 0 || printings[key] || touched.has(key) || preferred[r.oracle_id]) continue;
    // A card moving between boards keeps the printing it had (keepPrintings), or none.
    if (change.rows.some((o) => o.oracle_id === r.oracle_id && o.from > 0)) continue;
    const owned = ownedPrintingFor(c, r.oracle_id);
    if (!owned) continue;
    extra.push({ oracle_id: r.oracle_id, board: r.board, from: null, to: owned });
    touched.add(key);
  }
  return extra.length ? { ...change, printings: [...(change.printings ?? []), ...extra] } : change;
}
