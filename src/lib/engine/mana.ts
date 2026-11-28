// Mana costs, pools and payment.
// Pays generic, colored, colorless ({C}) and hybrid ({W/B}) symbols, and {X} once X is chosen.
// Phyrexian and snow costs are refused as "not yet" until a top-500 card needs them (docs/engine-rules-cut.md).

import type { Color, ManaPool, ManaType } from "./types";

export const COLORS: Color[] = ["W", "U", "B", "R", "G"];
export const MANA_TYPES: ManaType[] = ["W", "U", "B", "R", "G", "C"];

export type ParsedCost = {
  generic: number;
  symbols: Record<ManaType, number>; // colored and {C} symbols
  hybrid: ManaType[][]; // one entry per hybrid symbol: the colors that can pay it
  x: number; // how many {X} symbols (X is chosen while casting, 601.2b)
  unsupported: string[]; // symbols this engine can't pay yet
};

export function emptyPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function poolTotal(pool: ManaPool): number {
  return MANA_TYPES.reduce((n, t) => n + pool[t], 0);
}

export function parseCost(cost: string | null): ParsedCost {
  const out: ParsedCost = { generic: 0, symbols: emptyPool(), hybrid: [], x: 0, unsupported: [] };
  if (!cost) return out;
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1];
    if (/^\d+$/.test(sym)) out.generic += Number(sym);
    else if ((MANA_TYPES as string[]).includes(sym)) out.symbols[sym as ManaType] += 1;
    else if (sym === "X") out.x += 1;
    else if (/^[WUBRG]\/[WUBRG]$/.test(sym)) out.hybrid.push(sym.split("/") as ManaType[]);
    else out.unsupported.push(`{${sym}}`);
  }
  return out;
}

/** The cost with X replaced by its value (107.3a), as a cost string. */
export function costWithX(cost: string, x: number): string {
  if (!cost.includes("{X}")) return cost;
  const xs = (cost.match(/\{X\}/g) ?? []).length;
  const rest = cost.replace(/\{X\}/g, "");
  return addGeneric(rest, x * xs);
}

/** Adds (or with a negative amount, removes) generic mana from a cost string; generic never goes below 0. */
export function addGeneric(cost: string, amount: number): string {
  const p = parseCost(cost);
  const generic = Math.max(0, p.generic + amount);
  const others = cost.replace(/\{\d+\}/g, "");
  return (generic > 0 ? `{${generic}}` : "") + others;
}

export function isFreeCost(p: ParsedCost): boolean {
  return p.generic === 0 && p.hybrid.length === 0 && Object.values(p.symbols).every((n) => n === 0);
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
 * Pays `cost` from a fixed pool. Colored and {C} symbols first, then hybrid symbols (trying each way, so a
 * payment is found whenever one exists), then generic from what's left ({C} first, then WUBRG).
 */
export function payFromPool(pool: ManaPool, cost: ParsedCost): ManaPool | null {
  if (cost.unsupported.length) return null;
  const left = { ...pool };
  for (const t of MANA_TYPES) {
    left[t] -= cost.symbols[t];
    if (left[t] < 0) return null;
  }
  const payHybrid = (i: number, p: ManaPool): ManaPool | null => {
    if (i === cost.hybrid.length) return payGeneric(p, cost.generic);
    for (const c of cost.hybrid[i]) {
      if (p[c] <= 0) continue;
      const r = payHybrid(i + 1, { ...p, [c]: p[c] - 1 });
      if (r) return r;
    }
    return null;
  };
  return payHybrid(0, left);
}

function payGeneric(pool: ManaPool, amount: number): ManaPool | null {
  const left = { ...pool };
  let generic = amount;
  for (const t of ["C", ...COLORS] as ManaType[]) {
    const use = Math.min(generic, left[t]);
    left[t] -= use;
    generic -= use;
  }
  return generic === 0 ? left : null;
}

/** One way an object can make mana by tapping: an ability index and the mana it adds. */
export type ManaOption = { ability: number; bundle: ManaType[] };

/**
 * An untapped object that can help pay. `options` are its mana abilities whose only cost is {T}
 * (auto-pay never sacrifices anything). `convoke` is set for creatures that can be tapped for convoke
 * (702.51a): the colors they can pay; a colorless creature pays generic only.
 */
export type ManaSource = { object: number; options: ManaOption[]; convoke?: Color[] };

export type PayStep = { object: number; ability: number; bundle: ManaType[]; convoke?: boolean };

type Slot = { source: number; colors: ManaType[] };

/**
 * Auto-pay (engine-design.md section 4): which sources to tap, and for which mana, so the pool plus that
 * mana pays the cost. Mana already in the pool is used first; the fewest sources are tapped; convoke
 * creatures are used only when lands and rocks aren't enough.
 * Returns null when no choice of sources pays the cost.
 */
export function planAutoPay(pool: ManaPool, cost: ParsedCost, sources: ManaSource[]): PayStep[] | null {
  if (cost.unsupported.length) return null;
  const mana = sources.filter((s) => s.options.length > 0);
  const convoke = sources.filter((s) => s.convoke);
  return plan(pool, cost, mana, false) ?? (convoke.length ? plan(pool, cost, [...mana, ...convoke.filter((c) => !mana.includes(c))], true) : null);
}

function plan(pool: ManaPool, cost: ParsedCost, sources: ManaSource[], useConvoke: boolean): PayStep[] | null {
  // What the pool covers first.
  const left = { ...pool };
  const reqs: ManaType[][] = [];
  for (const t of MANA_TYPES) {
    const fromPool = Math.min(left[t], cost.symbols[t]);
    left[t] -= fromPool;
    for (let i = fromPool; i < cost.symbols[t]; i++) reqs.push([t]);
  }
  for (const h of cost.hybrid) {
    const c = h.filter((x) => left[x] > 0).sort((a, b) => left[b] - left[a])[0];
    if (c) left[c] -= 1;
    else reqs.push(h);
  }
  const leftover = MANA_TYPES.reduce((n, t) => n + left[t], 0);
  const genericNeed = Math.max(0, cost.generic - leftover);

  // Slots: one per mana a source can add. A source with several single-mana options is one slot of any of
  // those colors; a fixed bundle ({C}{C}) is one slot per mana.
  const slots: Slot[] = [];
  const isConvoke = (i: number) => useConvoke && !!sources[i].convoke && sources[i].options.length === 0;
  sources.forEach((src, i) => {
    if (isConvoke(i)) {
      slots.push({ source: i, colors: src.convoke ?? [] });
      return;
    }
    if (src.options.length === 1) for (const m of src.options[0].bundle) slots.push({ source: i, colors: [m] });
    else if (src.options.every((o) => o.bundle.length === 1)) slots.push({ source: i, colors: [...new Set(src.options.map((o) => o.bundle[0]))] });
    else for (const m of src.options[0].bundle) slots.push({ source: i, colors: [m] });
  });

  // Bipartite matching: each colored requirement gets its own slot (augmenting paths).
  const ownerOf = new Array<number>(slots.length).fill(-1);
  let seen: boolean[] = [];
  const fits = (slot: Slot, r: number) => slot.colors.some((c) => reqs[r].includes(c));
  const assign = (r: number): boolean => {
    for (let k = 0; k < slots.length; k++) {
      if (seen[k] || !fits(slots[k], r)) continue;
      seen[k] = true;
      if (ownerOf[k] === -1 || assign(ownerOf[k])) {
        ownerOf[k] = r;
        return true;
      }
    }
    return false;
  };
  for (let r = 0; r < reqs.length; r++) {
    seen = new Array<boolean>(slots.length).fill(false);
    if (!assign(r)) return null;
  }

  const tapped = new Set<number>();
  slots.forEach((sl, k) => ownerOf[k] >= 0 && tapped.add(sl.source));
  // Generic: free slots of sources already tapped, then more sources, biggest first.
  let generic = genericNeed;
  slots.forEach((sl, k) => {
    if (generic > 0 && ownerOf[k] === -1 && tapped.has(sl.source)) {
      ownerOf[k] = -2;
      generic--;
    }
  });
  if (generic > 0) {
    const bySource = new Map<number, number[]>();
    slots.forEach((sl, k) => {
      if (ownerOf[k] === -1 && !tapped.has(sl.source)) bySource.set(sl.source, [...(bySource.get(sl.source) ?? []), k]);
    });
    // Least waste first (a {C}{C} rock isn't tapped for one generic), then the bigger source, then in order.
    const need = generic;
    const waste = (n: number) => Math.max(0, n - need);
    const order = [...bySource.entries()].sort((a, b) => Number(isConvoke(a[0])) - Number(isConvoke(b[0])) || waste(a[1].length) - waste(b[1].length) || b[1].length - a[1].length || a[0] - b[0]);
    for (const [src, ks] of order) {
      if (generic <= 0) break;
      tapped.add(src);
      for (const k of ks) {
        if (generic <= 0) break;
        ownerOf[k] = -2;
        generic--;
      }
    }
  }
  if (generic > 0) return null;

  const out: PayStep[] = [];
  for (const i of [...tapped].sort((a, b) => a - b)) {
    const src = sources[i];
    const mySlots = slots.map((sl, k) => [sl, k] as const).filter(([sl]) => sl.source === i);
    if (isConvoke(i)) {
      const [sl, k] = mySlots[0];
      const r = ownerOf[k];
      const color = r >= 0 ? sl.colors.find((c) => reqs[r].includes(c))! : "C";
      out.push({ object: src.object, ability: -1, bundle: [color], convoke: true });
      continue;
    }
    if (src.options.length > 1 && src.options.every((o) => o.bundle.length === 1)) {
      const [sl, k] = mySlots[0];
      const r = ownerOf[k];
      const color = r >= 0 ? sl.colors.find((c) => reqs[r].includes(c))! : sl.colors[0];
      const opt = src.options.find((o) => o.bundle[0] === color)!;
      out.push({ object: src.object, ability: opt.ability, bundle: opt.bundle });
    } else out.push({ object: src.object, ability: src.options[0].ability, bundle: src.options[0].bundle });
  }
  return out;
}

export function addToPool(pool: ManaPool, bundle: ManaType[]): ManaPool {
  const out = { ...pool };
  for (const m of bundle) out[m] += 1;
  return out;
}

/** Reads "{G}{G}" (mana to add) into a bundle. */
export function bundleOf(mana: string): ManaType[] {
  return [...mana.matchAll(/\{([WUBRGC])\}/g)].map((m) => m[1] as ManaType);
}
