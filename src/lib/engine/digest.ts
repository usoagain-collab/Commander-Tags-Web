// A stable text form of a game state, for "same seed + same actions = same game" checks and bug reports.
// Keys are sorted, the persistent maps are written as sorted entries, and a spell's rollback checkpoint
// is left out (it is an earlier state, already covered by the log).

import { pmapEntries, type PMap } from "./pmap";
import type { GameState } from "./types";

function isPMap(v: unknown): v is PMap<unknown> {
  return typeof v === "object" && v !== null && "root" in v && "shift" in v && "size" in v && Object.keys(v).length === 3;
}

function canonical(v: unknown): unknown {
  if (isPMap(v)) return pmapEntries(v).map(([k, x]) => [k, canonical(x)]);
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = canonical(x);
    }
    return out;
  }
  return v;
}

export function stateDigest(s: GameState): string {
  const { casting, ...rest } = s;
  return JSON.stringify(canonical({ ...rest, casting: casting ? { ...casting, checkpoint: null } : null }));
}
