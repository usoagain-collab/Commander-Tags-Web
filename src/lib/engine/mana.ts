// Mana costs, pools and payment.
// PR 1 pays generic, colored and colorless ({C}) symbols. Hybrid, Phyrexian, snow and {X} costs are
// refused as "not yet" until a top-500 card needs them (docs/engine-rules-cut.md).

import type { Color, ManaPool, ManaType } from "./types";

export const COLORS: Color[] = ["W", "U", "B", "R", "G"];
export const MANA_TYPES: ManaType[] = ["W", "U", "B", "R", "G", "C"];

export type ParsedCost = {
  generic: number;
  symbols: Record<ManaType, number>; // colored and {C} symbols
  unsupported: string[]; // symbols PR 1 can't pay yet
};

export function emptyPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function poolTotal(pool: ManaPool): number {
  return MANA_TYPES.reduce((n, t) => n + pool[t], 0);
}

export function parseCost(cost: string | null): ParsedCost {
  const out: ParsedCost = { generic: 0, symbols: emptyPool(), unsupported: [] };
  if (!cost) return out;
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1];
    if (/^\d+$/.test(sym)) out.generic += Number(sym);
    else if ((MANA_TYPES as string[]).includes(sym)) out.symbols[sym as ManaType] += 1;
    else out.unsupported.push(`{${sym}}`);
  }
  return out;
}

/** Mana value (202.3): X counts 0, hybrid {2/W} counts its largest part. */
export function manaValue(cost: string | null): number {
  if (!cost) return 0;
  let total = 0;
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1];
    if (/^\d+$/.test(sym)) total += Number(sym);
    else if (sym === "X" || sym === "Y" || sym === "Z") total += 0;
    else {
      const parts = sym.split("/").map((p) => (/^\d+$/.test(p) ? Number(p) : 1));
      total += Math.max(...parts);
    }
  }
  return total;
}

/** 305.6: a land with a basic land type has "{T}: Add [that mana]". One ability per type, in WUBRG order. */
const BASIC_TYPE_MANA: Record<string, Color> = { Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G" };

export function intrinsicMana(subtypes: string[]): ManaType[] {
  return COLORS.filter((c) => subtypes.some((t) => BASIC_TYPE_MANA[t] === c));
}

/**
 * Pays `cost` from a fixed pool. With a fixed set of mana, paying colored and {C} symbols first and generic
 * from what's left always works when any payment does. Generic takes {C} first, then colors in WUBRG order.
 */
export function payFromPool(pool: ManaPool, cost: ParsedCost): ManaPool | null {
  if (cost.unsupported.length) return null;
  const left = { ...pool };
  for (const t of MANA_TYPES) {
    left[t] -= cost.symbols[t];
    if (left[t] < 0) return null;
  }
  let generic = cost.generic;
  for (const t of ["C", ...COLORS] as ManaType[]) {
    const use = Math.min(generic, left[t]);
    left[t] -= use;
    generic -= use;
  }
  return generic === 0 ? left : null;
}

export type ManaSource = { object: number; produces: ManaType[] };

/**
 * Auto-pay (engine-design.md section 4): which sources to tap, and for which mana, so the pool plus that
 * mana pays the cost. Mana already in the pool is used first; the fewest sources are tapped.
 * Returns null when no choice of sources pays the cost.
 */
export function planAutoPay(pool: ManaPool, cost: ParsedCost, sources: ManaSource[]): { object: number; mana: ManaType }[] | null {
  if (cost.unsupported.length) return null;
  // Requirements that need a specific type, after the pool covers what it can.
  const need = emptyPool();
  const left = { ...pool };
  for (const t of MANA_TYPES) {
    const fromPool = Math.min(left[t], cost.symbols[t]);
    left[t] -= fromPool;
    need[t] = cost.symbols[t] - fromPool;
  }
  const leftover = MANA_TYPES.reduce((n, t) => n + left[t], 0);
  const genericNeed = Math.max(0, cost.generic - leftover);

  // Bipartite matching: each specific requirement gets its own source (augmenting paths).
  const reqs: ManaType[] = MANA_TYPES.flatMap((t) => Array<ManaType>(need[t]).fill(t));
  const ownerOf = new Array<number>(sources.length).fill(-1); // source index -> requirement index
  let seen: boolean[] = [];
  const assign = (r: number): boolean => {
    for (let s = 0; s < sources.length; s++) {
      if (seen[s] || !sources[s].produces.includes(reqs[r])) continue;
      seen[s] = true;
      if (ownerOf[s] === -1 || assign(ownerOf[s])) {
        ownerOf[s] = r;
        return true;
      }
    }
    return false;
  };
  for (let r = 0; r < reqs.length; r++) {
    seen = new Array<boolean>(sources.length).fill(false);
    if (!assign(r)) return null;
  }

  const plan: { object: number; mana: ManaType }[] = [];
  const free: number[] = [];
  sources.forEach((src, s) => {
    if (ownerOf[s] >= 0) plan.push({ object: src.object, mana: reqs[ownerOf[s]] });
    else if (src.produces.length) free.push(s);
  });
  if (free.length < genericNeed) return null;
  for (const s of free.slice(0, genericNeed)) plan.push({ object: sources[s].object, mana: sources[s].produces[0] });
  return plan;
}
