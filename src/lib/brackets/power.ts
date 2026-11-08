// Refined bracket estimate (v2): a transparent points model on top of v1's floor. v1 only proves a minimum from
// rule-breaking cards (Game Changers, mass land denial, extra turns, combos). This adds how the deck is likely to
// play: fast mana, tutors, cheap interaction, combos, Game Changers, a low curve and theme cohesion, each with its
// own points so the reason is always visible. The result never goes below the floor and never claims 5 (cEDH is
// intent, not a card list).
import type { BracketNumber } from "./rules";
import type { DeckLine } from "@/lib/deck/model";
import type { BracketEstimate } from "./evaluate";

export type PowerPart = { key: string; label: string; points: number; max: number; detail: string; cards: string[] };
export type PowerEstimate = { score: number; playsLike: BracketNumber; mapped: BracketNumber; parts: PowerPart[] };

export type PowerInput = {
  /** The 100-card deck (commander, companion, mainboard). */
  lines: DeckLine[];
  /** Role keys a line fills (rolesOf, with manual categories). */
  rolesOf: (line: DeckLine) => string[];
  tagsOf: (oracleId: string) => string[];
  /** Counterspell tags, sub-tags included. */
  counterTags: Set<string>;
  /** The deck's top gameplay themes (tag keys) and each card's theme keys, for cohesion. */
  topThemes: Set<string>;
  themeKeysOf: (line: DeckLine) => string[];
  estimate: BracketEstimate;
};

/** Points scale: tuned so a precon lands around 2, an upgraded deck around 3, a tuned one at 4 (Omo and QA decks). */
export const POWER = {
  fastMana: { per: 2, max: 20, maxManaValue: 2 },
  tutors: { per: 2.5, max: 20 },
  interaction: { per: 1.5, max: 15, maxManaValue: 2 },
  combos: { one: 8, more: 15 },
  gameChangers: { per: 2, max: 10 },
  curve: { max: 10, best: 2.5, worst: 4 },
  cohesion: { max: 10, low: 0.15, high: 0.6 },
  /** Score at or above each value plays like that bracket. */
  bands: [
    [60, 4],
    [35, 3],
    [15, 2],
    [0, 1],
  ] as [number, BracketNumber][],
};

const isLandFront = (l: DeckLine) => /\bLand\b/.test(l.card.type_line.split(" // ")[0]);

export function estimatePower(input: PowerInput): PowerEstimate {
  const spells = input.lines.filter((l) => !isLandFront(l));
  const sumQ = (ls: DeckLine[]) => ls.reduce((n, l) => n + l.quantity, 0);
  const ids = (ls: DeckLine[]) => ls.map((l) => l.card.oracle_id);
  const parts: PowerPart[] = [];
  const capped = (n: number, per: number, max: number) => Math.min(max, n * per);

  const fast = spells.filter((l) => l.card.mana_value <= POWER.fastMana.maxManaValue && (input.rolesOf(l).includes("ramp") || input.tagsOf(l.card.oracle_id).includes("ritual")));
  parts.push({ key: "fast", label: "Fast mana", points: capped(sumQ(fast), POWER.fastMana.per, POWER.fastMana.max), max: POWER.fastMana.max, detail: `${sumQ(fast)} ramp cards at mana value 2 or less`, cards: ids(fast) });

  const tutors = spells.filter((l) => input.rolesOf(l).includes("tutors"));
  parts.push({ key: "tutors", label: "Tutors", points: capped(sumQ(tutors), POWER.tutors.per, POWER.tutors.max), max: POWER.tutors.max, detail: `${sumQ(tutors)} cards that find another card`, cards: ids(tutors) });

  const cheap = spells.filter(
    (l) =>
      l.card.mana_value <= POWER.interaction.maxManaValue &&
      (input.rolesOf(l).some((k) => k === "removal" || k === "wipes") || input.tagsOf(l.card.oracle_id).some((t) => input.counterTags.has(t))),
  );
  parts.push({ key: "interaction", label: "Cheap interaction", points: capped(sumQ(cheap), POWER.interaction.per, POWER.interaction.max), max: POWER.interaction.max, detail: `${sumQ(cheap)} removal or counterspells at mana value 2 or less`, cards: ids(cheap) });

  // Exhibition combos (loops that don't win alone) don't raise the floor in v1, so they don't count here either.
  const combos = input.estimate.findings.filter((f) => f.combo && f.minBracket > 1);
  parts.push({
    key: "combos",
    label: "Two-card combos",
    points: combos.length === 0 ? 0 : combos.length === 1 ? POWER.combos.one : POWER.combos.more,
    max: POWER.combos.more,
    detail: combos.length ? `${combos.length} that can win or lock the game` : "None that win on their own",
    cards: [...new Set(combos.flatMap((f) => f.cards))],
  });

  const gc = input.lines.filter((l) => l.card.game_changer);
  parts.push({ key: "gc", label: "Game Changers", points: capped(gc.length, POWER.gameChangers.per, POWER.gameChangers.max), max: POWER.gameChangers.max, detail: `${gc.length} on the official list`, cards: ids(gc) });

  const avg = sumQ(spells) ? spells.reduce((s, l) => s + l.card.mana_value * l.quantity, 0) / sumQ(spells) : 0;
  const { best, worst } = POWER.curve;
  const curvePoints = sumQ(spells) ? POWER.curve.max * Math.min(1, Math.max(0, (worst - avg) / (worst - best))) : 0;
  parts.push({ key: "curve", label: "Low curve", points: curvePoints, max: POWER.curve.max, detail: `Average mana value ${avg.toFixed(2)} (full points at ${best} or less, none at ${worst}+)`, cards: [] });

  const onTheme = spells.filter((l) => input.themeKeysOf(l).some((k) => input.topThemes.has(k)));
  const share = sumQ(spells) ? sumQ(onTheme) / sumQ(spells) : 0;
  const { low, high } = POWER.cohesion;
  parts.push({
    key: "cohesion",
    label: "Theme cohesion",
    points: POWER.cohesion.max * Math.min(1, Math.max(0, (share - low) / (high - low))),
    max: POWER.cohesion.max,
    detail: `${Math.round(share * 100)}% of spells share one of the top 5 themes`,
    cards: [],
  });

  const score = Math.round(parts.reduce((s, p) => s + p.points, 0));
  const mapped = POWER.bands.find(([min]) => score >= min)![1];
  const playsLike = Math.min(4, Math.max(input.estimate.floor, mapped)) as BracketNumber;
  return { score, playsLike, mapped, parts: parts.map((p) => ({ ...p, points: Math.round(p.points * 10) / 10 })) };
}
