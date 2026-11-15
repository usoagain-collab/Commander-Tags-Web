// Combos one card away (V3, Nov 15, 2026): two-card combos from Commander Spellbook where the deck has one card
// and not the other, grouped by the missing card so one pick can finish several combos. Only combos that need
// nothing else (requires = 0); the bracket panel already lists pairs that need an extra generic piece.
import type { ComboRow } from "./evaluate";

export type OneAway = {
  /** The card the deck is missing. */
  missing: string;
  /** The deck's cards it would combo with, one per combo, most popular combo first. */
  combos: { combo: ComboRow; have: string }[];
  /** Highest Spellbook popularity among its combos, for sorting. */
  popularity: number;
};

/**
 * Groups combos by the one card the deck lacks. `inDeck` is the 100-card deck (commander, companion, mainboard).
 * Missing cards that fail `allowed` (outside the colors, not legal) are dropped. Most combos first, then most played.
 */
export function combosOneAway(rows: ComboRow[], inDeck: Set<string>, allowed: (oracleId: string) => boolean, limit = 12): OneAway[] {
  const byMissing = new Map<string, OneAway>();
  const seen = new Set<string>();
  for (const c of rows) {
    if (c.requires !== 0 || seen.has(c.id)) continue;
    seen.add(c.id);
    const a = inDeck.has(c.card_a);
    const b = inDeck.has(c.card_b);
    if (a === b) continue; // both in the deck (the bracket's own list) or neither
    const missing = a ? c.card_b : c.card_a;
    const have = a ? c.card_a : c.card_b;
    if (!allowed(missing)) continue;
    const group = byMissing.get(missing) ?? { missing, combos: [], popularity: 0 };
    group.combos.push({ combo: c, have });
    group.popularity = Math.max(group.popularity, c.popularity ?? 0);
    byMissing.set(missing, group);
  }
  const groups = [...byMissing.values()];
  for (const g of groups) g.combos.sort((x, y) => (y.combo.popularity ?? 0) - (x.combo.popularity ?? 0));
  return groups.sort((x, y) => y.combos.length - x.combos.length || y.popularity - x.popularity || x.missing.localeCompare(y.missing)).slice(0, limit);
}
