// Auto build land base (v2). Fills the deck's lands up to the Lands target: first the most-played lands that make
// two or more of the deck's colors (duals, fetches, tri-lands, Command Tower...), then basics split by how many
// mana symbols of each color the spells have. Utility lands (lands that make one color or none) are left to the
// user. Pure functions; the editor fetches the candidates and applies the result as one Change.
import { COLORS, type Color } from "./stats";
import { entryKey, type CardSummary, type Change, type Entries, type RowChange } from "./model";

export const BASIC_NAMES: Record<Color | "C", string> = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest", C: "Wastes" };

/**
 * Share of the Lands target that goes to color-fixing nonbasics, by number of colors. A two-color deck runs about a
 * third duals; three or more colors lean on them more. Mono-color and colorless decks get basics only.
 */
export const NONBASIC_SHARE: Record<number, number> = { 0: 0, 1: 0, 2: 0.35, 3: 0.5, 4: 0.6, 5: 0.6 };

/**
 * Lands whose colored mana only works for some spells (Cavern of Souls, Unclaimed Territory, Secluded Courtyard,
 * Ancient Ziggurat) don't count as fixing: they're utility lands, left to the user.
 */
export const NOT_FIXING_TAGS = ["restricted-mana"];

/** A candidate land with its oracle tags (fetch lands make no mana themselves; their tags say what they find). */
export type LandCandidate = CardSummary & { tags: string[] };

const TYPE_COLOR: Record<string, Color> = { plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G" };

/** The deck's colors a land can make or fetch: produced mana, plus land types a fetch finds (any basic = every color). */
export function colorsMade(land: LandCandidate, identity: readonly Color[]): Set<Color> {
  const out = new Set<Color>();
  const inDeck = (c: string): c is Color => (identity as readonly string[]).includes(c);
  for (const c of land.produced_mana ?? []) if (inDeck(c)) out.add(c);
  for (const t of land.tags) {
    if (t === "tutor-land-basic") identity.forEach((c) => out.add(c));
    const m = /^tutor-land-(plains|island|swamp|mountain|forest)$/.exec(t);
    if (m && inDeck(TYPE_COLOR[m[1]])) out.add(TYPE_COLOR[m[1]]);
  }
  return out;
}

export const isBasicLand = (c: Pick<CardSummary, "type_line">) => /\bBasic\b/.test(c.type_line.split(" // ")[0]);

/** Splits `n` into whole numbers proportional to `weights` (largest remainder), in key order. */
export function splitByWeight<K extends string>(n: number, weights: Record<K, number>): Record<K, number> {
  const keys = Object.keys(weights) as K[];
  const total = keys.reduce((s, k) => s + weights[k], 0);
  const out = {} as Record<K, number>;
  if (keys.length === 0 || n <= 0) {
    keys.forEach((k) => (out[k] = 0));
    return out;
  }
  const w = total > 0 ? weights : (Object.fromEntries(keys.map((k) => [k, 1])) as Record<K, number>);
  const sum = total > 0 ? total : keys.length;
  const exact = keys.map((k) => ({ k, v: (n * w[k]) / sum }));
  exact.forEach(({ k, v }) => (out[k] = Math.floor(v)));
  let left = n - keys.reduce((s, k) => s + out[k], 0);
  for (const { k } of [...exact].sort((a, b) => b.v - Math.floor(b.v) - (a.v - Math.floor(a.v)) || keys.indexOf(a.k) - keys.indexOf(b.k))) {
    if (left-- <= 0) break;
    out[k]++;
  }
  return out;
}

export type LandBaseInput = {
  identity: Color[];
  /** The Lands target and how many cards already count toward it (MDFCs included). */
  target: number;
  landCount: number;
  /** Nonbasic lands already in the deck (they count toward the fixing share). */
  nonbasicCount: number;
  /** Basics already in the deck, by color (C = Wastes). */
  basicCounts: Partial<Record<Color | "C", number>>;
  /** Colored mana symbols in the deck's spells, by color. */
  pips: Partial<Record<Color, number>>;
  /** Candidates, most played first. Cards already in the deck are skipped. */
  pool: LandCandidate[];
  inDeck: (oracleId: string) => boolean;
  /** Skip lands over this price (null = any price). */
  maxPrice: number | null;
};

export type LandBasePlan = {
  need: number;
  nonbasic: { card: LandCandidate; colors: Color[] }[];
  /** New basics by color, only colors that get some. */
  basics: { color: Color | "C"; name: string; count: number }[];
};

export function planLandBase(input: LandBaseInput): LandBasePlan {
  const need = Math.max(0, input.target - input.landCount);
  const identity = COLORS.filter((c) => input.identity.includes(c));
  if (need === 0) return { need, nonbasic: [], basics: [] };

  const share = NONBASIC_SHARE[identity.length] ?? 0;
  const wantNonbasic = Math.max(0, Math.min(need, Math.round(input.target * share) - input.nonbasicCount));
  const nonbasic: LandBasePlan["nonbasic"] = [];
  if (wantNonbasic > 0) {
    for (const card of input.pool) {
      if (nonbasic.length >= wantNonbasic) break;
      if (isBasicLand(card) || input.inDeck(card.oracle_id)) continue;
      if (input.maxPrice !== null && (card.price_usd ?? 0) > input.maxPrice) continue;
      if (card.color_identity.some((c) => !(identity as string[]).includes(c))) continue;
      if (card.tags.some((t) => NOT_FIXING_TAGS.includes(t))) continue;
      const colors = colorsMade(card, identity);
      if (colors.size < 2) continue;
      nonbasic.push({ card, colors: COLORS.filter((c) => colors.has(c)) });
    }
  }

  const newBasics = need - nonbasic.length;
  if (identity.length === 0) return { need, nonbasic, basics: newBasics > 0 ? [{ color: "C", name: BASIC_NAMES.C, count: newBasics }] : [] };

  // Aim the whole basic count (old + new) at the pip split, then give the new ones to the colors furthest behind.
  const pipWeights = Object.fromEntries(identity.map((c) => [c, input.pips[c] ?? 0])) as Record<Color, number>;
  const existing = identity.reduce((s, c) => s + (input.basicCounts[c] ?? 0), 0);
  const ideal = splitByWeight(existing + newBasics, pipWeights);
  const deficit = Object.fromEntries(identity.map((c) => [c, Math.max(0, ideal[c] - (input.basicCounts[c] ?? 0))])) as Record<Color, number>;
  const split = splitByWeight(newBasics, deficit);
  return {
    need,
    nonbasic,
    basics: identity.filter((c) => split[c] > 0).map((c) => ({ color: c, name: BASIC_NAMES[c], count: split[c] })),
  };
}

/** The plan as one undoable edit on the mainboard. `basicCards` maps a basic's name to its card. */
export function landBaseChange(entries: Entries, plan: LandBasePlan, basicCards: Record<string, CardSummary>): Change {
  const rows: RowChange[] = [];
  for (const { card } of plan.nonbasic) rows.push({ oracle_id: card.oracle_id, board: "main", from: entries[entryKey("main", card.oracle_id)] ?? 0, to: (entries[entryKey("main", card.oracle_id)] ?? 0) + 1 });
  for (const b of plan.basics) {
    const card = basicCards[b.name];
    if (!card) continue;
    const from = entries[entryKey("main", card.oracle_id)] ?? 0;
    rows.push({ oracle_id: card.oracle_id, board: "main", from, to: Math.min(99, from + b.count) });
  }
  const added = rows.reduce((s, r) => s + r.to - r.from, 0);
  return { label: `Auto build land base: added ${added} land${added === 1 ? "" : "s"}`, rows };
}
