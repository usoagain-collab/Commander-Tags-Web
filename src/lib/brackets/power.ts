// Refined bracket estimate (v2): a transparent points model on top of v1's floor. v1 only proves a minimum from
// rule-breaking cards (Game Changers, mass land denial, extra turns, combos). This adds how the deck is likely to
// play, each part with its own points so the reason is always visible. The result never goes below the floor and
// never claims 5 (cEDH is intent, not a card list).
// Bracket rethink (David, Nov 15, 2026), steps 1 and 2: Speed is the heaviest part, 40 of 100, from the turn the
// deck threatens to win in 1,000 sample games (speed.ts). Five supporting parts share the other 60: Consistency (15),
// Interaction (15, stax up to 5 of it), Resilience (10), Card quality (10) and Commander (10). Fast mana and combos
// count through Speed; Game Changers through Card quality; theme cohesion became route redundancy in Consistency.
import type { BracketNumber } from "./rules";
import type { DeckLine } from "@/lib/deck/model";
import type { BracketEstimate } from "./evaluate";
import { resolveRoles, rolesOf, STANDARD_ROLES } from "@/lib/tags/roles";
import type { TagTree } from "@/lib/tags/tree";
import type { Archetype } from "@/lib/cutter/archetypes";
import { landAdvice } from "@/lib/deck/mana-checkup";
import { estimateSpeed, SPEED, turnWords, type SpeedEstimate } from "./speed";

/**
 * The roles the power estimate counts with: the STANDARD role definitions only, read straight from each card's
 * tags. Never the deck's own role settings: a hidden Tutors role, a custom role or a manual category must not
 * change the bracket estimate (David, Nov 11, 2026: it has to stand on its own).
 */
export function bracketRolesOf(tree: TagTree, tagsOf: (oracleId: string) => string[]) {
  const roles = resolveRoles(STANDARD_ROLES, tree);
  return (line: DeckLine) => rolesOf(line.card, tagsOf(line.card.oracle_id), roles);
}

export type PowerPart = { key: string; label: string; points: number; max: number; detail: string; cards: string[] };
export type PowerEstimate = {
  score: number;
  playsLike: BracketNumber;
  mapped: BracketNumber;
  parts: PowerPart[];
  speed: SpeedEstimate | null;
  /** The part with the most room to lift the points into the next band, when the points decide the bracket. */
  whyNotHigher: string | null;
};

export type PowerInput = {
  /** The 100-card deck (commander, companion, mainboard). */
  lines: DeckLine[];
  /** Standard role keys a line fills, from its tags alone (bracketRolesOf), never the deck's role settings. */
  rolesOf: (line: DeckLine) => string[];
  tagsOf: (oracleId: string) => string[];
  estimate: BracketEstimate;
  /** The tag tree, for the sample games and the tag-based counts. Without it Speed scores 0 ("not checked"). */
  tree?: TagTree;
  /** The Plays line's archetype when picked, otherwise the detected one; it decides which win routes are checked. */
  archetype?: { archetype: Archetype; picked: boolean } | null;
};

/** Cost weights: free, mana value 2 or less, 3, 4 or more. */
type CostWeights = { free?: number; cheap: number; three: number; more: number };

/** Every tuning number in one place. Speed's 40 points live in speed.ts (SPEED.points). */
export const POWER = {
  consistency: {
    max: 15,
    /** Tutors by cost; past `fullUntil` weighted tutors, each counts half. */
    tutors: { max: 6, per: 0.75, fullUntil: 6, weights: { cheap: 1, three: 0.7, more: 0.4 } as CostWeights },
    /** Card draw by cost; noncreature draw permanents (engines) count `engine` times as much. */
    draw: { max: 3, weights: { cheap: 0.4, three: 0.25, more: 0.15 } as CostWeights, engine: 1.5 },
    /** Card selection: cantrips, scry, surveil, looting. */
    selection: { max: 2, per: 0.25 },
    /** Route redundancy: pieces of the best non-board win route (combo pieces, cheat enablers and payoffs). */
    redundancy: { max: 2, per: 0.25 },
    /** Mana base fit: the land count against the Mana base checkup's suggestion. */
    manaBase: { max: 2, close: 1, near: 3 },
  },
  interaction: {
    max: 15,
    /** Targeted removal and counterspells by cost; instants and flash cards count `instant` times as much. */
    targeted: { max: 8, weights: { free: 1.5, cheap: 1, three: 0.6, more: 0.25 } as CostWeights, instant: 1.15 },
    wipes: { max: 2, per: 0.5 },
    /** Stax (David, Nov 15: up to 5 points inside Interaction, never a bracket on its own). */
    stax: { max: 5, per: 1 },
  },
  resilience: {
    max: 10,
    protection: { max: 4, per: 0.75 },
    recursion: { max: 3, per: 0.5 },
    /** Rebuilding after a wipe: repeatable token makers and noncreature draw engines. */
    rebuild: { max: 2, per: 0.4 },
    /** A commander cheap enough to recast: full at this mana value or less, half one above. */
    recast: { max: 1, full: 3 },
  },
  quality: {
    max: 10,
    /** Share of nonland cards at or above this EDHREC rank (1 = most played). */
    topRank: 1000,
    share: { max: 8, low: 0.15, high: 0.6 },
    gameChangers: { max: 2, per: 0.5 },
  },
  commander: {
    max: 10,
    /** Points for each thing the commander does by itself, from its own tags. */
    roles: { ramp: 3, draw: 3, tutors: 3, costReducer: 2 } as Record<string, number>,
    /** A win route that needs the commander (a combo piece, a cheat enabler). */
    route: 3,
  },
  /**
   * Score at or above each value plays like that bracket. Step 2 laptop check (Nov 15): precons score higher with the
   * new parts (median 34, 90th percentile 43), so 3 moved from 40 to 50 (82% of precons at 2, the rules floor caps it
   * at 84%) and 4 from 60 to 70 so bracket 3 still spans 20 points.
   */
  bands: [
    [70, 4],
    [50, 3],
    [10, 2],
    [0, 1],
  ] as [number, BracketNumber][],
};

/** Tags the parts read. Each includes its subtree; slugs missing from the tag tree are skipped (the check script lists them). */
export const POWER_TAGS = {
  // card-selection, stax and free-spell aren't Scryfall tags (laptop check, Nov 15), so they were dropped.
  selection: ["cantrip", "scry", "surveil", "loot"],
  stax: ["tax", "cast-tax", "hatebear", "hate-nonbasic-land", "rule-of-law"],
  free: ["pitch-spell"],
  tokens: ["repeatable-creature-tokens"],
  costReducer: ["cost-reducer"],
};

/** Every slug the parts use, for the check script. */
export const powerSlugs = () => Object.values(POWER_TAGS).flat();

/**
 * Interaction that costs no mana in practice: pitch spells, free-if spells and the like. Scryfall's tags may not mark
 * them all, so the best-known ones are listed by name (as FAST_MANA is for mana amounts).
 */
export const FREE_SPELLS = new Set([
  "Force of Will",
  "Force of Negation",
  "Fierce Guardianship",
  "Deflecting Swat",
  "Deadly Rollick",
  "Flawless Maneuver",
  "Obscuring Haze",
  "Pact of Negation",
  "Mental Misstep",
  "Snuff Out",
  "Misdirection",
  "Commandeer",
  "Mindbreak Trap",
  "Daze",
  "Foil",
  "Thwart",
  "Contagion",
  "Gush",
  "Subtlety",
  "Solitude",
  "Fury",
  "Grief",
  "Slaughter Pact",
  "Dismember",
  "Mogg Salvage",
  "Bounty of the Hunt",
  "Abjure",
  "Disrupting Shoal",
  "Sickening Shoal",
  "Blazing Shoal",
  "Nourishing Shoal",
  "Invert Polarity",
  "An Offer You Can't Refuse",
  "Snapback",
  "Force of Vigor",
  "Force of Despair",
  "Tibalt's Trickery",
]);

/** "Under 10 plays like 1, 10-49 like 2, 50-69 like 3, 70+ like 4." from POWER.bands. */
export function bandWords() {
  const [four, three, two] = POWER.bands.map(([min]) => min);
  return `Under ${two} plays like 1, ${two}-${three - 1} like 2, ${three}-${four - 1} like 3, ${four}+ like 4.`;
}

const front = (l: DeckLine) => l.card.type_line.split(" // ")[0];
const isLandFront = (l: DeckLine) => /\bLand\b/.test(front(l));
const sumQ = (ls: DeckLine[]) => ls.reduce((n, l) => n + l.quantity, 0);
const ids = (ls: DeckLine[]) => [...new Set(ls.map((l) => l.card.oracle_id))];
const capped = (n: number, per: number, max: number) => Math.min(max, n * per);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function estimatePower(input: PowerInput): PowerEstimate {
  const { tree } = input;
  const set = (slugs: string[]) => (tree ? tree.descendants(slugs.filter((s) => tree.has(s))) : new Set<string>());
  const tagSets = Object.fromEntries(Object.entries(POWER_TAGS).map(([k, v]) => [k, set(v)])) as Record<keyof typeof POWER_TAGS, Set<string>>;
  const hasTag = (l: DeckLine, s: Set<string>) => input.tagsOf(l.card.oracle_id).some((t) => s.has(t));
  const role = (l: DeckLine, k: string) => input.rolesOf(l).includes(k);
  const free = (l: DeckLine) => FREE_SPELLS.has(l.card.name) || hasTag(l, tagSets.free);
  const byCost = (l: DeckLine, w: CostWeights) =>
    w.free !== undefined && free(l) ? w.free : l.card.mana_value <= 2 ? w.cheap : l.card.mana_value <= 3 ? w.three : w.more;
  const weigh = (ls: DeckLine[], each: (l: DeckLine) => number) => ls.reduce((n, l) => n + each(l) * l.quantity, 0);

  const spells = input.lines.filter((l) => !isLandFront(l));
  const commanders = input.lines.filter((l) => l.board === "commander");
  const threat = (l: DeckLine) => /\b(Creature|Planeswalker)\b/.test(front(l));
  const permanent = (l: DeckLine) => !/\b(Instant|Sorcery)\b/.test(front(l));
  const engine = (l: DeckLine) => role(l, "draw") && permanent(l) && !threat(l) && !role(l, "ramp");

  const speed = tree ? estimateSpeed({ lines: input.lines, tagsOf: input.tagsOf, rolesOf: input.rolesOf, tree, estimate: input.estimate, archetype: input.archetype }) : null;
  const parts: PowerPart[] = [speedPart(speed)];

  // ---------- Consistency ----------
  {
    const C = POWER.consistency;
    const tutors = spells.filter((l) => role(l, "tutors"));
    const weights = tutors.flatMap((l) => Array(l.quantity).fill(byCost(l, C.tutors.weights)) as number[]).sort((a, b) => b - a);
    const tutorUnits = weights.reduce((n, w, i) => n + (i < C.tutors.fullUntil ? w : w / 2), 0);
    const tutorPts = capped(tutorUnits, C.tutors.per, C.tutors.max);

    const draw = spells.filter((l) => role(l, "draw") && !role(l, "tutors"));
    const drawPts = Math.min(C.draw.max, weigh(draw, (l) => byCost(l, C.draw.weights) * (engine(l) ? C.draw.engine : 1)));
    const engines = draw.filter(engine);

    const selection = spells.filter((l) => hasTag(l, tagSets.selection));
    const selectionPts = capped(sumQ(selection), C.selection.per, C.selection.max);

    const route = speed && speed.route.key !== "board" ? speed.route : speed?.routes.find((r) => r.key !== "board" && r.cards.length);
    const routeCards = route?.cards ?? [];
    const redundancyPts = capped(routeCards.length, C.redundancy.per, C.redundancy.max);

    const lands = landAdvice(input.lines.filter((l) => l.board === "commander" || l.board === "main"), (l) => role(l, "ramp") || role(l, "draw"));
    const off = Math.abs(lands.lands - lands.recommended);
    const manaPts = off <= C.manaBase.close ? C.manaBase.max : off <= C.manaBase.near ? C.manaBase.max / 2 : 0;

    const points = Math.min(C.max, tutorPts + drawPts + selectionPts + redundancyPts + manaPts);
    const bits = [
      `${plural(sumQ(tutors), "tutor", "tutors")} (${round1(tutorPts)})`,
      `${sumQ(draw)} draw, ${plural(sumQ(engines), "engine", "engines")} among them (${round1(drawPts)})`,
      `${sumQ(selection)} card selection (${round1(selectionPts)})`,
      route ? `${plural(routeCards.length, "piece", "pieces")} for the ${route.label} (${round1(redundancyPts)})` : "no combo or cheat route to back up (0)",
      `${lands.lands} lands against a suggested ${lands.recommended} (${round1(manaPts)})`,
    ];
    parts.push({ key: "consistency", label: "Consistency", points, max: C.max, detail: bits.join("; "), cards: ids([...tutors, ...engines, ...selection]) });
  }

  // ---------- Interaction ----------
  {
    const I = POWER.interaction;
    const targeted = spells.filter((l) => role(l, "removal"));
    const targetedPts = Math.min(I.targeted.max, weigh(targeted, (l) => byCost(l, I.targeted.weights) * (l.card.instant_speed ? I.targeted.instant : 1)));
    const freeOnes = targeted.filter(free);
    const wipes = spells.filter((l) => role(l, "wipes"));
    const wipePts = capped(sumQ(wipes), I.wipes.per, I.wipes.max);
    const stax = input.lines.filter((l) => !isLandFront(l) && hasTag(l, tagSets.stax));
    const staxPts = capped(sumQ(stax), I.stax.per, I.stax.max);
    const points = Math.min(I.max, targetedPts + wipePts + staxPts);
    const bits = [
      `${sumQ(targeted)} removal and counterspells${freeOnes.length ? `, ${sumQ(freeOnes)} of them free` : ""} (${round1(targetedPts)})`,
      `${plural(sumQ(wipes), "board wipe", "board wipes")} (${round1(wipePts)})`,
      stax.length ? `slows the table: ${plural(sumQ(stax), "stax piece", "stax pieces")} (${round1(staxPts)})` : "no stax pieces (0)",
    ];
    parts.push({ key: "interaction", label: "Interaction", points, max: I.max, detail: bits.join("; "), cards: ids([...targeted, ...wipes, ...stax]) });
  }

  // ---------- Resilience ----------
  {
    const R = POWER.resilience;
    const protection = spells.filter((l) => role(l, "protection"));
    const recursion = spells.filter((l) => role(l, "recursion"));
    const rebuild = spells.filter((l) => hasTag(l, tagSets.tokens) || engine(l));
    const cheapest = commanders.length ? Math.min(...commanders.map((l) => l.card.mana_value)) : Infinity;
    const recastPts = cheapest <= R.recast.full ? R.recast.max : cheapest === R.recast.full + 1 ? R.recast.max / 2 : 0;
    const pts = [capped(sumQ(protection), R.protection.per, R.protection.max), capped(sumQ(recursion), R.recursion.per, R.recursion.max), capped(sumQ(rebuild), R.rebuild.per, R.rebuild.max), recastPts];
    const bits = [
      `${sumQ(protection)} protection (${round1(pts[0])})`,
      `${sumQ(recursion)} recursion (${round1(pts[1])})`,
      `${sumQ(rebuild)} token makers and draw engines to rebuild with (${round1(pts[2])})`,
      commanders.length ? `commander costs ${cheapest} to cast (${round1(recastPts)})` : "no commander (0)",
    ];
    parts.push({ key: "resilience", label: "Resilience", points: Math.min(R.max, pts.reduce((a, b) => a + b, 0)), max: R.max, detail: bits.join("; "), cards: ids([...protection, ...recursion, ...rebuild]) });
  }

  // ---------- Card quality ----------
  {
    const Q = POWER.quality;
    const pool = spells.filter((l) => l.board !== "commander");
    const top = pool.filter((l) => l.card.edhrec_rank !== null && l.card.edhrec_rank <= Q.topRank);
    const share = sumQ(pool) ? sumQ(top) / sumQ(pool) : 0;
    const sharePts = Q.share.max * Math.min(1, Math.max(0, (share - Q.share.low) / (Q.share.high - Q.share.low)));
    const gc = input.lines.filter((l) => l.card.game_changer);
    const gcPts = capped(sumQ(gc), Q.gameChangers.per, Q.gameChangers.max);
    parts.push({
      key: "quality",
      label: "Card quality",
      points: Math.min(Q.max, sharePts + gcPts),
      max: Q.max,
      detail: `${Math.round(share * 100)}% of nonland cards are among EDHREC's ${Q.topRank.toLocaleString("en-US")} most played (${round1(sharePts)}); ${plural(sumQ(gc), "Game Changer", "Game Changers")} (${round1(gcPts)})`,
      cards: ids(gc),
    });
  }

  // ---------- Commander ----------
  {
    const K = POWER.commander;
    const does: string[] = [];
    let pts = 0;
    const words: Record<string, string> = { ramp: "makes mana", draw: "draws cards", tutors: "finds cards", costReducer: "makes spells cheaper" };
    for (const l of commanders) {
      for (const [k, p] of Object.entries(K.roles)) {
        const yes = k === "costReducer" ? hasTag(l, tagSets.costReducer) : role(l, k);
        if (!yes) continue;
        pts += p;
        does.push(`${l.card.name} ${words[k]} (${p})`);
      }
    }
    const routeIds = new Set((speed?.routes ?? []).filter((r) => r.key !== "board").flatMap((r) => r.cards));
    const inRoute = commanders.filter((l) => routeIds.has(l.card.oracle_id));
    if (inRoute.length) {
      pts += K.route;
      does.push(`${inRoute[0].card.name} is part of a win route (${K.route})`);
    }
    parts.push({
      key: "commander",
      label: "Commander",
      points: Math.min(K.max, pts),
      max: K.max,
      detail: commanders.length ? (does.length ? does.join("; ") : "The commander adds no mana, cards, tutors or win route by itself") : "No commander set",
      cards: ids(commanders),
    });
  }

  const rounded = parts.map((p) => ({ ...p, points: round1(p.points) }));
  const score = Math.round(parts.reduce((s, p) => s + p.points, 0));
  const mapped = POWER.bands.find(([min]) => score >= min)![1];
  const playsLike = Math.min(4, Math.max(input.estimate.floor, mapped)) as BracketNumber;
  return { score, playsLike, mapped, parts: rounded, speed, whyNotHigher: whyNotHigher(score, playsLike, mapped, rounded) };
}

/** "6 more points would make it play like 3; Interaction has the most room (9 of 15 left)." */
function whyNotHigher(score: number, playsLike: BracketNumber, mapped: BracketNumber, parts: PowerPart[]): string | null {
  if (playsLike >= 4 || playsLike > mapped) return null;
  const next = POWER.bands.filter(([, b]) => b > playsLike).at(-1);
  if (!next) return null;
  const gap = next[0] - score;
  const roomiest = parts.slice().sort((a, b) => b.max - b.points - (a.max - a.points))[0];
  const room = round1(roomiest.max - roomiest.points);
  return `${gap} more ${gap === 1 ? "point" : "points"} would make it play like ${next[1]}; ${roomiest.label} has the most room (${room} of ${roomiest.max} left).`;
}

/** The Speed part: points from the threat turn, the route that gets there first and its cards. */
function speedPart(speed: SpeedEstimate | null): PowerPart {
  const max = SPEED.points.max;
  if (!speed) return { key: "speed", label: "Speed", points: 0, max, detail: "Not checked yet (the tag tree is still loading)", cards: [] };
  const r = speed.route;
  const by = r.key === "board" ? "by building a board" : `through a ${r.label} (${r.pieces})`;
  const detail =
    speed.turn > SPEED.maxTurn
      ? `No win route ready by turn ${SPEED.maxTurn} in ${speed.games.toLocaleString("en-US")} sample games`
      : `Threatens a win around ${turnWords(speed.turn)} in half of ${speed.games.toLocaleString("en-US")} sample games (${turnWords(speed.fast)} in the fastest quarter), ${by}. Full points at turn ${SPEED.points.full}, none at turn ${SPEED.points.none}+`;
  return { key: "speed", label: "Speed", points: speed.points, max, detail, cards: r.cards };
}
