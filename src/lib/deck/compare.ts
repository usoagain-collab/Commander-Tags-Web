// Compare two decks (V3): which cards both decks run, which only one does, and how their role counts line up.
// Only the 100-card deck counts (commander, companion and mainboard); the maybeboard is left out on both sides.
// Copies are compared too, so 10 Forests against 14 shows under "both" with the two counts.
import type { Board } from "./model";

export type CompareRow = { oracle_id: string; board: Board; quantity: number };
export type CompareLine = { oracle_id: string; mine: number; theirs: number };
export type DeckComparison = {
  both: CompareLine[];
  onlyMine: CompareLine[];
  onlyTheirs: CompareLine[];
  /** Share of my non-basic cards the other deck also runs, 0 to 1 (basic lands would make any two decks look alike). */
  overlap: number;
};

const IN_DECK: Board[] = ["commander", "companion", "main"];

function counts(rows: CompareRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) if (IN_DECK.includes(r.board)) m.set(r.oracle_id, (m.get(r.oracle_id) ?? 0) + r.quantity);
  return m;
}

export function compareDecks(mine: CompareRow[], theirs: CompareRow[], isBasic: (oracleId: string) => boolean = () => false): DeckComparison {
  const a = counts(mine);
  const b = counts(theirs);
  const out: DeckComparison = { both: [], onlyMine: [], onlyTheirs: [], overlap: 0 };
  for (const [id, n] of a) {
    const line = { oracle_id: id, mine: n, theirs: b.get(id) ?? 0 };
    (line.theirs > 0 ? out.both : out.onlyMine).push(line);
  }
  for (const [id, n] of b) if (!a.has(id)) out.onlyTheirs.push({ oracle_id: id, mine: 0, theirs: n });
  const nonBasic = [...a.keys()].filter((id) => !isBasic(id));
  out.overlap = nonBasic.length ? nonBasic.filter((id) => b.has(id)).length / nonBasic.length : 0;
  return out;
}

export type RoleCompare = { key: string; name: string; mine: number; theirs: number };

/** One row per role, in the order given, with each deck's count. Roles neither deck fills are left out. */
export function compareRoles(roles: { key: string; name: string }[], mine: Record<string, number>, theirs: Record<string, number>): RoleCompare[] {
  return roles
    .map((r) => ({ key: r.key, name: r.name, mine: mine[r.key] ?? 0, theirs: theirs[r.key] ?? 0 }))
    .filter((r) => r.mine > 0 || r.theirs > 0);
}
