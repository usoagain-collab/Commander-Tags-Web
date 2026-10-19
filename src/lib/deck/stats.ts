// Deck stats (step 3i): mana curve, color pips against land sources, and card types. Counts cover the
// 100-card deck (commander, companion and mainboard), copies included.
import type { DeckLine } from "./model";

export const COLORS = ["W", "U", "B", "R", "G"] as const;
export type Color = (typeof COLORS)[number];
export const COLOR_NAMES: Record<Color, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

const front = (s: string | null) => (s ?? "").split(" // ")[0];
const frontIsLand = (l: DeckLine) => /\bLand\b/.test(front(l.card.type_line));
const isColor = (c: string): c is Color => (COLORS as readonly string[]).includes(c);

/**
 * Colored mana symbols in a cost (front face: the side you normally cast). Hybrid ({G/U}) counts for both
 * colors; Phyrexian ({G/P}) and two-or-color ({2/G}) count for their color. Generic, X and colorless don't count.
 */
export function pipsOf(cost: string | null): Partial<Record<Color, number>> {
  const out: Partial<Record<Color, number>> = {};
  for (const [, sym] of front(cost).matchAll(/\{([^}]+)\}/g)) {
    for (const part of new Set(sym.split("/"))) {
      if (isColor(part)) out[part] = (out[part] ?? 0) + 1;
    }
  }
  return out;
}

export type CurveBucket = { mv: number; label: string; creatures: number; other: number };

/** Spells by mana value 0-7+ (cards whose front face isn't a land; MDFC spells count here too). */
export function manaCurve(lines: DeckLine[]): { buckets: CurveBucket[]; average: number; spells: number } {
  const buckets: CurveBucket[] = Array.from({ length: 8 }, (_, mv) => ({ mv, label: mv === 7 ? "7+" : String(mv), creatures: 0, other: 0 }));
  let total = 0;
  let spells = 0;
  for (const l of lines) {
    if (frontIsLand(l)) continue;
    const b = buckets[Math.min(7, Math.max(0, Math.floor(l.card.mana_value)))];
    if (/\bCreature\b/.test(front(l.card.type_line))) b.creatures += l.quantity;
    else b.other += l.quantity;
    total += l.card.mana_value * l.quantity;
    spells += l.quantity;
  }
  return { buckets, average: spells ? total / spells : 0, spells };
}

export type ColorRow = { color: Color; pips: number; pipShare: number; sources: number; sourceShare: number };

/**
 * For each color in the deck's identity: colored pips in spell costs, and lands that can make that color
 * (Scryfall's produced_mana; an MDFC with a land face counts). Shares are of all pips and all land sources, so
 * the two bars compare. Lands that only fetch others (Evolving Wilds) list no colors, so they don't count.
 */
export function colorBalance(
  lines: DeckLine[],
  identity: Set<string> | null,
): { rows: ColorRow[]; lands: number; colorlessLands: number } {
  const pips: Partial<Record<Color, number>> = {};
  const sources: Partial<Record<Color, number>> = {};
  let lands = 0;
  let colorlessLands = 0;
  for (const l of lines) {
    if (!frontIsLand(l)) {
      for (const [c, n] of Object.entries(pipsOf(l.card.mana_cost))) pips[c as Color] = (pips[c as Color] ?? 0) + n * l.quantity;
    }
    if (l.card.counts_as_land) {
      lands += l.quantity;
      const makes = (l.card.produced_mana ?? []).filter(isColor);
      if (!makes.length) colorlessLands += l.quantity;
      for (const c of makes) sources[c] = (sources[c] ?? 0) + l.quantity;
    }
  }
  const shown = COLORS.filter((c) => (identity ? identity.has(c) : !!sources[c]) || !!pips[c]);
  const pipTotal = shown.reduce((n, c) => n + (pips[c] ?? 0), 0);
  const sourceTotal = shown.reduce((n, c) => n + (sources[c] ?? 0), 0);
  return {
    rows: shown.map((color) => ({
      color,
      pips: pips[color] ?? 0,
      pipShare: pipTotal ? (pips[color] ?? 0) / pipTotal : 0,
      sources: sources[color] ?? 0,
      sourceShare: sourceTotal ? (sources[color] ?? 0) / sourceTotal : 0,
    })),
    lands,
    colorlessLands,
  };
}

const TYPES = ["Creature", "Artifact", "Enchantment", "Sorcery", "Instant", "Planeswalker", "Battle", "Land"] as const;

/** Every card type a card has (front face), so an Artifact Creature counts under both. */
export function typeCounts(lines: DeckLine[]): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const l of lines) {
    const t = front(l.card.type_line);
    for (const type of TYPES) if (new RegExp(`\\b${type}\\b`).test(t)) counts.set(type, (counts.get(type) ?? 0) + l.quantity);
  }
  return TYPES.filter((t) => counts.has(t)).map((type) => ({ type, count: counts.get(type)! }));
}
