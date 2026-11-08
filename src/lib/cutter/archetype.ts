// Smart Cutter: archetype detection and the effective curve (docs/spec.md → Smart Cutter, section 1).
// Pure logic: the caller hands in the deck's cards with their tags and roles.
import type { CardSummary } from "@/lib/deck/model";
import { isLand } from "@/lib/tags/roles";
import type { TagTree } from "@/lib/tags/tree";
import { ARCHETYPES, DEFAULT_FULL, GENERAL_KEY, type Archetype, type Curve, type Signal } from "./archetypes";
import { CHEAT_ENABLERS, CUTTER } from "./config";

/** One row of the 100-card deck as the cutter sees it. */
export type CutterCard = {
  card: CardSummary;
  quantity: number;
  /** On the commander board: counts toward roles, curve and themes, never cut. */
  commander: boolean;
  /** Oracle tag slugs as applied. */
  tags: string[];
  /** Role keys it counts toward (manual category and hidden roles already applied, as in the role profile). */
  roles: string[];
};

const front = (typeLine: string) => typeLine.split(" // ")[0];
const hasType = (c: CardSummary, type: string) => new RegExp(`\\b${type}\\b`).test(front(c.type_line));
const isSpell = (c: CardSummary) => !isLand(c.type_line);
const isCreature = (c: CardSummary) => hasType(c, "Creature");
const isPermanent = (c: CardSummary) => !hasType(c, "Instant") && !hasType(c, "Sorcery");

/** The front face's creature types ("Elf Druid" gives both). */
const creatureTypes = (c: CardSummary) => (isCreature(c) ? (front(c.type_line).split("—")[1] ?? "").trim().split(/\s+/).filter(Boolean) : []);

// ---------- detection ----------

export type SignalResult = { label: string; strength: number; count: number };
export type DetectedArchetype = { archetype: Archetype; score: number; evidence: SignalResult[]; typalType?: string };

export type DetectInput = {
  cards: CutterCard[];
  tree: TagTree;
  /** Two-card combos fully inside the deck. */
  combos: number;
  /** Starter set plus the user's custom profiles. */
  archetypes?: Archetype[];
};

/** All archetypes, most likely first. General is always last, as the fallback. */
export function detectArchetypes(input: DetectInput): DetectedArchetype[] {
  const { cards, tree } = input;
  const list = input.archetypes ?? ARCHETYPES;
  const nonland = cards.filter((c) => isSpell(c.card));
  // The commander counts as several cards for tag and type signals: it's the strongest hint.
  const weightOf = (c: CutterCard) => (c.commander ? CUTTER.commanderWeight : c.quantity);
  const total = nonland.reduce((n, c) => n + weightOf(c), 0) || 1;
  const spells = nonland.reduce((n, c) => n + c.quantity, 0) || 1;
  const subtrees = new Map<string, Set<string>>();
  const subtree = (slugs: string[]) => {
    const key = slugs.join(",");
    if (!subtrees.has(key)) subtrees.set(key, tree.descendants(slugs));
    return subtrees.get(key)!;
  };

  // Typal: the most common creature type among the deck's creatures (needs at least 10 creatures).
  const typeCount = new Map<string, number>();
  let creatures = 0;
  for (const c of nonland) {
    if (!isCreature(c.card)) continue;
    creatures += c.quantity;
    for (const t of creatureTypes(c.card)) typeCount.set(t, (typeCount.get(t) ?? 0) + c.quantity);
  }
  const [topType, topTypeCount] = [...typeCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? ["", 0];

  const measure = (s: Signal): SignalResult => {
    const full = s.full ?? DEFAULT_FULL;
    let share = 0;
    let count = 0;
    let label = "";
    if (s.kind === "tags" || s.kind === "type" || s.kind === "role") {
      const set = s.kind === "tags" ? subtree(s.slugs) : null;
      const hit = (c: CutterCard) =>
        s.kind === "tags" ? c.tags.some((t) => set!.has(t)) : s.kind === "type" ? hasType(c.card, s.type) : c.roles.includes(s.role);
      const hits = nonland.filter(hit);
      count = hits.reduce((n, c) => n + c.quantity, 0);
      share = hits.reduce((n, c) => n + weightOf(c), 0) / total;
      label = s.kind === "tags" ? s.slugs.map((x) => tree.label(x)).join(" / ") : s.kind === "type" ? s.type : s.role;
    } else if (s.fact === "instantsSorceries") {
      count = nonland.filter((c) => !isPermanent(c.card)).reduce((n, c) => n + c.quantity, 0);
      share = count / spells;
      label = "instants and sorceries";
    } else if (s.fact === "bigSpells") {
      count = nonland.filter((c) => c.card.mana_value >= 6).reduce((n, c) => n + c.quantity, 0);
      share = count / spells;
      label = "spells at mana value 6+";
    } else if (s.fact === "combos") {
      count = input.combos;
      share = count;
      label = "two-card combos";
    } else {
      count = topTypeCount;
      share = creatures >= 10 ? topTypeCount / creatures : 0;
      label = topType ? `${topType} creatures` : "one creature type";
    }
    const from = s.from ?? 0;
    return { label, count, strength: Math.max(0, Math.min(1, (share - from) / (full - from))) };
  };

  const out = list.map((archetype): DetectedArchetype => {
    const evidence = archetype.signals.map(measure);
    const weights = archetype.signals.reduce((n, s) => n + s.weight, 0);
    const score = weights ? archetype.signals.reduce((n, s, i) => n + s.weight * evidence[i].strength, 0) / weights : 0;
    const typalType = archetype.signals.some((s) => s.kind === "fact" && s.fact === "typal") && topType ? topType : undefined;
    return { archetype, score, evidence: evidence.filter((e) => e.count > 0).sort((a, b) => b.strength - a.strength), typalType };
  });
  const general = out.find((d) => d.archetype.key === GENERAL_KEY) ?? { archetype: ARCHETYPES[0], score: 0, evidence: [] };
  const ranked = out.filter((d) => d.archetype.key !== GENERAL_KEY).sort((a, b) => b.score - a.score || a.archetype.name.localeCompare(b.archetype.name));
  // General goes first when nothing clears the floor, otherwise last.
  return ranked.length && ranked[0].score >= CUTTER.archetypeFloor ? [...ranked, general] : [general, ...ranked];
}

/** "Typal (Elf)" for typal, the archetype's name otherwise. */
export const archetypeLabel = (d: DetectedArchetype) => (d.typalType ? `${d.archetype.name} (${d.typalType})` : d.archetype.name);

/** Saved answers to "Is this your archetype?" (decks.cutter.archetype). */
export type ArchetypeAnswer = { key: string | null; status: "auto" | "confirmed" | "picked"; rejected: string[] };

/**
 * The archetype to use: a confirmed or picked one when it still exists, otherwise the most likely one not
 * rejected yet. `askToPick` is true once the builder has said No enough times.
 */
export function chooseArchetype(ranked: DetectedArchetype[], answer: ArchetypeAnswer): { chosen: DetectedArchetype; askToPick: boolean } {
  const settled = answer.status !== "auto" && answer.key ? ranked.find((d) => d.archetype.key === answer.key) : undefined;
  if (settled) return { chosen: settled, askToPick: false };
  const rejected = new Set(answer.rejected);
  const chosen = ranked.find((d) => !rejected.has(d.archetype.key)) ?? ranked[ranked.length - 1];
  return { chosen, askToPick: answer.rejected.length >= CUTTER.archetypeRejectLimit };
}

// ---------- cheat targets and the effective curve ----------

export type CheatInfo = { enablers: number; putIntoPlay: number; targets: Set<string> };

/**
 * Cards the deck likely cheats into play: mana value 6+ creatures in a deck with enough reanimate / put-into-play
 * enablers, and noncreature permanents when there are enough put-into-play enablers. Enablers are never targets.
 * `overrides` (power user): oracle_id -> "curve" (count it on the curve) or "cheat" (always a target).
 */
export function cheatTargets(
  cards: CutterCard[],
  tree: TagTree,
  archetype?: Archetype,
  overrides: Record<string, "curve" | "cheat"> = {},
): CheatInfo {
  const not = tree.descendants(CHEAT_ENABLERS.not);
  const reanimate = tree.descendants(CHEAT_ENABLERS.reanimate);
  const putIntoPlay = tree.descendants(CHEAT_ENABLERS.putIntoPlay);
  const enables = (c: CutterCard, set: Set<string>) => c.tags.some((t) => set.has(t) && !not.has(t));
  const enablerCards = cards.filter((c) => enables(c, reanimate) || enables(c, putIntoPlay));
  const enablers = enablerCards.reduce((n, c) => n + c.quantity, 0);
  const pip = cards.filter((c) => enables(c, putIntoPlay)).reduce((n, c) => n + c.quantity, 0);
  const minMv = archetype?.cheat?.minManaValue ?? CUTTER.cheatMinManaValue;
  const need = archetype?.cheat?.enablers ?? CUTTER.cheatEnablers;
  const enablerIds = new Set(enablerCards.map((c) => c.card.oracle_id));

  const targets = new Set<string>();
  for (const c of cards) {
    const id = c.card.oracle_id;
    if (overrides[id] === "cheat") {
      targets.add(id);
      continue;
    }
    if (overrides[id] === "curve" || !isSpell(c.card) || enablerIds.has(id) || c.card.mana_value < minMv || enablers < need) continue;
    if (isCreature(c.card) || (isPermanent(c.card) && pip >= CUTTER.cheatPermanentEnablers)) targets.add(id);
  }
  return { enablers, putIntoPlay: pip, targets };
}

/** Curve bucket for a mana value: 0 = 0-1, 1 = 2, … 6 = 7+. */
export const curveBucket = (manaValue: number) => (manaValue <= 1 ? 0 : Math.min(6, Math.floor(manaValue) - 1));
export const CURVE_LABELS = ["0-1", "2", "3", "4", "5", "6", "7+"];

/** The deck's nonland spells per bucket, as percent shares, leaving out cheat targets. */
export function effectiveCurve(cards: CutterCard[], targets: Set<string>): { shares: Curve; counts: Curve; spells: number } {
  const counts: Curve = [0, 0, 0, 0, 0, 0, 0];
  for (const c of cards) {
    if (!isSpell(c.card) || targets.has(c.card.oracle_id)) continue;
    counts[curveBucket(c.card.mana_value)] += c.quantity;
  }
  const spells = counts.reduce((a, b) => a + b, 0);
  return { shares: counts.map((n) => (spells ? (100 * n) / spells : 0)) as Curve, counts, spells };
}
