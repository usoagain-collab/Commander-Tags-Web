// Bracket estimate (Phase 5a): the lowest bracket the deck's CARDS allow, with every finding that set it.
// Cards can't show intent (1 vs 2, 4 vs 5, "early" combos), so the result is a floor: the deck plays at this
// bracket or higher, and it never claims 5 (CLAUDE.md, Phase 5 plan).
import type { DeckLine } from "@/lib/deck/model";
import { BRACKET_RULES, COMBO_TAG_NAMES, type BracketNumber } from "./rules";

/** A row from combos_within() (migration 0015). */
export type ComboRow = {
  id: string;
  card_a: string;
  card_b: string;
  results: string[];
  bracket_tag: string | null;
  requires: number;
  popularity: number | null;
};

export type Finding = {
  kind: "game-changers" | "mass-land-denial" | "extra-turns" | "combo";
  /** The lowest bracket this finding allows. */
  minBracket: BracketNumber;
  /** Plain words for the banner, e.g. "4 Game Changers (up to 3 in bracket 3)". */
  label: string;
  /** Cards involved (oracle ids), for badges. */
  cards: string[];
  combo?: ComboRow;
};

export type BracketEstimate = { floor: BracketNumber; findings: Finding[] };

export type EvaluateInput = {
  /** The 100-card deck: commander(s), companion and mainboard. */
  lines: DeckLine[];
  /** Each card's oracle tags. */
  tagsOf: (oracleId: string) => string[];
  /** Tag slugs that mean mass land denial / extra turns, sub-tags included. */
  massLandDenialTags: Set<string>;
  extraTurnTags: Set<string>;
  /** Combos fully inside the deck (combos_within). */
  combos: ComboRow[];
};

const BRACKET_LIST: BracketNumber[] = [1, 2, 3, 4, 5];
/** Lowest bracket whose limit allows `count`. */
const lowestAllowing = (count: number, max: Record<BracketNumber, number>) =>
  BRACKET_LIST.find((b) => count <= max[b]) ?? 4;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function estimateBracket(input: EvaluateInput): BracketEstimate {
  const R = BRACKET_RULES;
  const findings: Finding[] = [];
  const copies = (pred: (l: DeckLine) => boolean) => input.lines.filter(pred);
  const has = (l: DeckLine, set: Set<string>) => input.tagsOf(l.card.oracle_id).some((t) => set.has(t));

  const gc = copies((l) => l.card.game_changer);
  if (gc.length) {
    const n = gc.reduce((s, l) => s + l.quantity, 0);
    const min = lowestAllowing(n, R.gameChangersMax);
    findings.push({
      kind: "game-changers",
      minBracket: min,
      label: `${plural(n, "Game Changer")}${min >= 4 ? ` (up to ${R.gameChangersMax[3]} in bracket 3)` : ""}`,
      cards: gc.map((l) => l.card.oracle_id),
    });
  }

  const mld = copies((l) => has(l, input.massLandDenialTags));
  if (mld.length) {
    findings.push({
      kind: "mass-land-denial",
      minBracket: R.massLandDenialFrom,
      label: `Mass land denial: ${mld.map((l) => l.card.name).join(", ")}`,
      cards: mld.map((l) => l.card.oracle_id),
    });
  }

  const turns = copies((l) => has(l, input.extraTurnTags));
  if (turns.length) {
    const n = turns.reduce((s, l) => s + l.quantity, 0);
    const min = lowestAllowing(n, R.extraTurnsMax);
    findings.push({
      kind: "extra-turns",
      minBracket: min,
      label: `${plural(n, "extra-turn card")}${min >= 4 ? ` (up to ${R.extraTurnsMax[3]} in brackets 2-3)` : ""}`,
      cards: turns.map((l) => l.card.oracle_id),
    });
  }

  const name = new Map(input.lines.map((l) => [l.card.oracle_id, l.card.name]));
  for (const c of input.combos) {
    if (!name.has(c.card_a) || !name.has(c.card_b)) continue;
    if (c.requires > 0 && !R.comboCountsWithRequirements) continue;
    const min = (c.bracket_tag && R.comboBracketByTag[c.bracket_tag]) || R.comboBracketUntagged;
    const rating = c.bracket_tag ? COMBO_TAG_NAMES[c.bracket_tag] ?? c.bracket_tag : "unrated";
    findings.push({
      kind: "combo",
      minBracket: min,
      label: `2-card combo: ${name.get(c.card_a)} + ${name.get(c.card_b)} (${c.results[0] ?? "combo"}; Spellbook: ${rating})`,
      cards: [c.card_a, c.card_b],
      combo: c,
    });
  }

  findings.sort((a, b) => b.minBracket - a.minBracket);
  const floor = Math.min(4, Math.max(1, ...findings.map((f) => f.minBracket))) as BracketNumber;
  return { floor, findings };
}

/** What the badge says: "2 or lower" (1 vs 2 is intent), "3", "4+" (4 vs 5 is intent). */
export function estimateLabel(floor: BracketNumber) {
  return floor <= 2 ? "2 or lower" : floor >= 4 ? "4+" : "3";
}

/** Findings that push the deck above the target (what the banner lists and the badges mark). */
export const overTarget = (e: BracketEstimate, target: BracketNumber) => e.findings.filter((f) => f.minBracket > target);

/**
 * Phase 5c: what adding one more card would push above the target. Re-runs the estimate with the card added and
 * keeps only the over-target findings that involve it (a deck already over its Game Changer limit doesn't make
 * every other card "above bracket"). Empty = the card is fine for this target.
 */
export function candidateIssues(
  deck: EvaluateInput,
  candidate: { line: DeckLine; tags: string[] },
  target: BracketNumber,
): Finding[] {
  const id = candidate.line.card.oracle_id;
  const est = estimateBracket({
    ...deck,
    lines: [...deck.lines, candidate.line],
    tagsOf: (x) => (x === id ? candidate.tags : deck.tagsOf(x)),
  });
  return overTarget(est, target).filter((f) => f.cards.includes(id));
}
