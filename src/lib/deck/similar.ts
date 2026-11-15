// Similar decks (V3): public decks that share this deck's commander, ranked by how many of this deck's cards they
// also run (basic lands left out, as in Compare). Reads only what row-level security lets anyone see, so it needs
// no migration. It looks at the 60 most recently changed public decks with the same commander; past that it wants
// a database function that does the counting.
import type { SupabaseClient } from "@supabase/supabase-js";
import { compareDecks, type CompareRow } from "./compare";

export const SIMILAR_SCAN = 60;
export const SIMILAR_SHOWN = 8;
const DECKS_PER_READ = 8; // about 800 card rows, under the API's 1000-row page

export type SimilarCandidate = { id: string; name: string; precon: boolean; updated_at: string; rows: CompareRow[] };
export type SimilarDeck = { id: string; name: string; precon: boolean; shared: number; overlap: number };

/** Best match first: the most of this deck's non-basic cards shared, then the newest. Decks sharing none are dropped. */
export function rankSimilar(mine: CompareRow[], candidates: SimilarCandidate[], isBasic: (oracleId: string) => boolean, limit = SIMILAR_SHOWN): SimilarDeck[] {
  return candidates
    .map((c) => {
      const diff = compareDecks(mine, c.rows, isBasic);
      const shared = diff.both.filter((l) => !isBasic(l.oracle_id)).length;
      return { id: c.id, name: c.name, precon: c.precon, shared, overlap: diff.overlap, updated_at: c.updated_at };
    })
    .filter((d) => d.shared > 0)
    .sort((a, b) => b.overlap - a.overlap || b.shared - a.shared || b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit)
    .map((d) => ({ id: d.id, name: d.name, precon: d.precon, shared: d.shared, overlap: d.overlap }));
}

/** The public decks led by any of these commanders (this deck left out), with their cards. */
export async function loadSimilarCandidates(supabase: SupabaseClient, deckId: string, commanderIds: string[]): Promise<SimilarCandidate[]> {
  if (!commanderIds.length) return [];
  const { data, error } = await supabase
    .from("decks")
    .select("id, name, updated_at, precon, deck_cards!inner(oracle_id)")
    .eq("visibility", "public")
    .eq("deck_cards.board", "commander")
    .in("deck_cards.oracle_id", commanderIds)
    .neq("id", deckId)
    .order("updated_at", { ascending: false })
    .limit(SIMILAR_SCAN);
  if (error) throw new Error(error.message);
  type Row = { id: string; name: string; updated_at: string; precon: unknown };
  const decks = [...new Map(((data ?? []) as Row[]).map((d) => [d.id, d])).values()];

  const rows = new Map<string, CompareRow[]>();
  const reads = [];
  for (let i = 0; i < decks.length; i += DECKS_PER_READ) {
    const ids = decks.slice(i, i + DECKS_PER_READ).map((d) => d.id);
    reads.push(
      supabase
        .from("deck_cards")
        .select("deck_id, oracle_id, board, quantity")
        .in("deck_id", ids)
        .in("board", ["commander", "companion", "main"])
        .limit(1000),
    );
  }
  for (const { data: cr, error: ce } of await Promise.all(reads)) {
    if (ce) throw new Error(ce.message);
    for (const r of (cr ?? []) as (CompareRow & { deck_id: string })[]) {
      const list = rows.get(r.deck_id) ?? [];
      list.push({ oracle_id: r.oracle_id, board: r.board, quantity: r.quantity });
      rows.set(r.deck_id, list);
    }
  }
  return decks.map((d) => ({ id: d.id, name: d.name, precon: d.precon != null, updated_at: d.updated_at, rows: rows.get(d.id) ?? [] }));
}
