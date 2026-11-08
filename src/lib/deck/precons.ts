// Precons (v2): an MTGJSON precon deck as Deck Genome rows. Shared by the nightly import (scripts/import-precons.mts,
// run by plain Node, so this file uses no path aliases) and its tests.

export type MtgjsonCard = { name: string; count: number; isFoil?: boolean; identifiers?: { scryfallId?: string; scryfallOracleId?: string } };
export type MtgjsonDeck = {
  name: string;
  code: string;
  releaseDate: string | null;
  type: string;
  source?: string;
  commander?: MtgjsonCard[];
  mainBoard?: MtgjsonCard[];
  sideBoard?: MtgjsonCard[];
};
export type MtgjsonDeckEntry = { fileName: string; name: string; code: string; releaseDate: string | null; type: string };

/** Deck types imported: retail Commander precons and the two MTGO-only ones. */
export const PRECON_TYPES = ["Commander Deck", "MTGO Commander Deck"];

export type PreconPart = { printing_id: string | null; foil: boolean; quantity: number };
/** One deck_cards row: the printing with the most copies is the row's own, the rest go in its split (mixed copies). */
export type PreconRow = { oracle_id: string; board: "commander" | "main" | "maybe"; quantity: number; printing_id: string | null; foil: boolean; split: PreconPart[] };

export const isCollectorEdition = (name: string) => /collector['’]?s edition/i.test(name);

/**
 * Rows for one deck: commanders, the main deck, and anything in the sideboard as maybeboard. The same card in
 * several printings (basic lands with different art, a foil and a plain copy) becomes one row. Cards our
 * database doesn't have yet are left out and named in `missing`.
 */
export function preconRows(deck: MtgjsonDeck, known: (oracleId: string) => boolean): { rows: PreconRow[]; missing: string[] } {
  const boards: [PreconRow["board"], MtgjsonCard[] | undefined][] = [
    ["commander", deck.commander],
    ["main", deck.mainBoard],
    ["maybe", deck.sideBoard],
  ];
  const byKey = new Map<string, { oracle_id: string; board: PreconRow["board"]; parts: PreconPart[] }>();
  const missing: string[] = [];
  for (const [board, cards] of boards) {
    for (const c of cards ?? []) {
      const oracle = c.identifiers?.scryfallOracleId;
      if (!oracle || !known(oracle)) {
        missing.push(c.name);
        continue;
      }
      const k = `${board}|${oracle}`;
      const entry = byKey.get(k) ?? { oracle_id: oracle, board, parts: [] };
      const printing_id = c.identifiers?.scryfallId ?? null;
      const foil = !!c.isFoil && !!printing_id;
      const same = entry.parts.find((p) => p.printing_id === printing_id && p.foil === foil);
      if (same) same.quantity += c.count;
      else entry.parts.push({ printing_id, foil, quantity: c.count });
      byKey.set(k, entry);
    }
  }
  const rows = [...byKey.values()].map(({ oracle_id, board, parts }): PreconRow => {
    const sorted = [...parts].sort((a, b) => b.quantity - a.quantity);
    const [base, ...rest] = sorted;
    const quantity = Math.min(99, parts.reduce((n, p) => n + p.quantity, 0));
    return { oracle_id, board, quantity, printing_id: base.printing_id, foil: base.foil, split: rest.filter((p) => p.printing_id) };
  });
  return { rows, missing };
}
