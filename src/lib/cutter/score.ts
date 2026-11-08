// Smart Cutter: keep score, guardrails and cut planning (docs/spec.md → Smart Cutter, sections 2, 3 and 5).
// Pure logic. Higher keep = keep; cuts are the lowest scores among cards nothing protects.
import type { ComboRow, Finding } from "@/lib/brackets/evaluate";
import type { DeckLine } from "@/lib/deck/model";
import { colorBalance, pipsOf, type Color } from "@/lib/deck/stats";
import { popularity } from "@/lib/suggest/score";
import { isLand, type ResolvedRole } from "@/lib/tags/roles";
import type { TagKey, ThemeTag } from "@/lib/tags/themes";
import type { TagTree } from "@/lib/tags/tree";
import { cheatTargets, curveBucket, effectiveCurve, type CutterCard } from "./archetype";
import type { Archetype } from "./archetypes";
import { CUTTER, FLEX_POINTS, REPEATABLE_PREFIX, type CutterWeights } from "./config";
import { DEFAULT_PREFS, DEFAULT_STATE, type CutterPrefs, type CutterState } from "./state";

export type CutterContext = {
  /** The 100-card deck: commander(s) and mainboard. */
  cards: CutterCard[];
  /** The deck's visible roles (hidden ones left out), Lands included. */
  roles: ResolvedRole[];
  tree: TagTree;
  /** The top gameplay themes ("selected" along with the roles). Recomputed after each cut when `themesFor` is given. */
  themes: ThemeTag[];
  themesFor?: (cards: CutterCard[]) => ThemeTag[];
  /** A card's tag keys, matching how the themes were counted (Specific or Broad). */
  keysOf: (c: CutterCard) => TagKey[];
  archetype: Archetype;
  /** Two-card combos inside the deck (combos_within). */
  combos: ComboRow[];
  /** Over-target bracket findings (overTarget(estimateBracket(...), target)). */
  bracketFindings: Finding[];
  identity: Set<string> | null;
  state?: CutterState;
  prefs?: CutterPrefs;
};

export type Part = keyof CutterWeights;
export type Protection = {
  kind: "commander" | "land" | "lock" | "no-tags" | "combo" | "below-target" | "dismissed";
  detail: string;
};
export type RoleFact = { key: string; name: string; count: number; target: number };
export type RankFact = { key: string; name: string; /** 1 = the weakest card in that role. */ position: number; of: number };

export type CardScore = {
  entry: CutterCard;
  keep: number;
  parts: Record<Part, number>;
  flags: { bracket: string[]; strain: Color | null; noTags: boolean; cheatTarget: boolean; popularity: number };
  protect: Protection | null;
  facts: {
    roles: RoleFact[];
    themes: ThemeTag[];
    /** Distinct selected items it hits, and the most any card hits. */
    hits: number;
    maxHits: number;
    ranks: RankFact[];
    /** Fallback when it fills no rankable role: ranked within its strongest theme on mana value. */
    themeRank?: { theme: ThemeTag; position: number; of: number };
    bucket: number;
    bucketShare: number;
    expectedShare: number;
  };
};

const front = (typeLine: string) => typeLine.split(" // ")[0];
const hasType = (typeLine: string, type: string) => new RegExp(`\\b${type}\\b`).test(front(typeLine));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Share of the others that `v` beats, ties counting half (0 = worst, 1 = best). Needs 2+ values. */
function standing(values: number[], index: number, higherIsBetter: boolean) {
  const v = values[index];
  let better = 0;
  for (let i = 0; i < values.length; i++) {
    if (i === index) continue;
    const w = values[i];
    if (w === v) better += 0.5;
    else if (higherIsBetter ? v > w : v < w) better += 1;
  }
  return values.length > 1 ? better / (values.length - 1) : CUTTER.neutral;
}

/** Position from the bottom (1 = weakest) among values, ties sharing the better position. */
function positionFromBottom(values: number[], index: number) {
  return 1 + values.filter((w, i) => i !== index && w < values[index]).length;
}

/** How many copies fill each role. */
export function roleCountsOf(cards: CutterCard[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of cards) for (const k of c.roles) counts[k] = (counts[k] ?? 0) + c.quantity;
  return counts;
}

/** Every card's keep score, flags and protection. Cards are in the order given. */
export function keepScores(ctx: CutterContext): CardScore[] {
  const state = ctx.state ?? DEFAULT_STATE;
  const prefs = ctx.prefs ?? DEFAULT_PREFS;
  const { cards, tree, themes, archetype } = ctx;
  const roleBy = new Map(ctx.roles.map((r) => [r.key, r]));
  const landKeys = new Set(ctx.roles.filter((r) => r.land).map((r) => r.key));
  const counts = roleCountsOf(cards);
  const spellRoles = (c: CutterCard) => c.roles.filter((k) => roleBy.has(k) && !landKeys.has(k));
  const main = cards.filter((c) => !c.commander);
  // Each card's tag keys, worked out once per scoring run.
  const keysBy = new Map(cards.map((c) => [c, new Set(ctx.keysOf(c))]));

  // Themes: weights with the card's own contribution taken out (leave-one-out), so a card can't hold up a theme alone.
  const themeBy = new Map(themes.map((t) => [t.key, t]));
  const themeTotal = themes.reduce((n, t) => n + t.score, 0) || 1;
  const sharedThemes = (c: CutterCard) => {
    const seen = new Set<TagKey>();
    return [...keysBy.get(c)!].flatMap((k) => (themeBy.has(k) && !seen.has(k) && seen.add(k) ? [themeBy.get(k)!] : []));
  };
  const looThemeWeight = (t: ThemeTag) => (t.count > 0 ? (t.score * Math.max(0, t.count - 1)) / t.count : 0);

  // Selected items hit: each role once, each theme once, a theme that is an ancestor of another hit theme with it.
  const hitCount = (c: CutterCard, shared: ThemeTag[]) => {
    const slugs = new Set(shared.map((t) => t.slug));
    const distinct = shared.filter((t) => !shared.some((o) => o !== t && tree.ancestors(o.slug).includes(t.slug) && slugs.has(o.slug)));
    return spellRoles(c).length + distinct.length;
  };

  // Curve.
  const cheat = cheatTargets(cards, tree, archetype, state.curve);
  const curve = effectiveCurve(cards, cheat.targets);

  // Weakest in role: quality per card within each role, then its standing among the role's mainboard cards.
  const speedOf = (c: CutterCard) =>
    c.card.instant_speed || hasType(c.card.type_line, "Instant") ? 1 : hasType(c.card.type_line, "Sorcery") ? CUTTER.sorcerySpeed : 1;
  const flexOf = (c: CutterCard, role: ResolvedRole) => {
    const points = FLEX_POINTS[role.key] ?? {};
    const inRole = c.tags.filter((t) => role.tagSet?.has(t));
    const base = inRole.reduce((n, t) => n + (points[t] ?? 1), 0);
    const identity = ctx.identity;
    const fixes =
      role.key === "ramp" && identity && identity.size >= CUTTER.fixingMinColors && (c.card.produced_mana ?? []).filter((m) => identity.has(m)).length >= 2;
    return base + (c.tags.some((t) => t.startsWith(REPEATABLE_PREFIX)) ? 1 : 0) + (fixes ? CUTTER.fixingPoints : 0);
  };
  const rankIn = new Map<string, Map<string, { standing: number; position: number; of: number }>>();
  for (const role of ctx.roles) {
    if (role.land) continue;
    const mates = main.filter((c) => !isLand(c.card.type_line) && c.roles.includes(role.key));
    if (mates.length < CUTTER.minRoleSize) continue;
    const mvs = mates.map((c) => (c.tags.some((t) => CUTTER.freeTags.includes(t)) ? 0 : c.card.mana_value));
    const flex = mates.map((c) => flexOf(c, role));
    const maxFlex = Math.max(...flex);
    const q = CUTTER.quality;
    const quality = mates.map(
      (c, i) => q.manaValue * standing(mvs, i, false) + q.speed * speedOf(c) + q.flexibility * (maxFlex ? flex[i] / maxFlex : 1),
    );
    const m = new Map<string, { standing: number; position: number; of: number }>();
    mates.forEach((c, i) => m.set(c.card.oracle_id, { standing: standing(quality, i, true), position: positionFromBottom(quality, i), of: mates.length }));
    rankIn.set(role.key, m);
  }

  // Mana strain: land sources per color.
  const lines: DeckLine[] = cards.map((c) => ({ board: c.commander ? "commander" : "main", quantity: c.quantity, card: c.card }));
  const balance = colorBalance(lines, ctx.identity);
  const shareOf = new Map(balance.rows.map((r) => [r.color, r.sourceShare]));

  const inCombo = new Set(ctx.combos.flatMap((c) => [c.card_a, c.card_b]));
  // Head to head (power user): each card's win rate, blended 50/50 into weakest in role.
  const record = new Map<string, { won: number; lost: number }>();
  for (const [winner, loser] of state.h2h) {
    record.set(winner, { won: (record.get(winner)?.won ?? 0) + 1, lost: record.get(winner)?.lost ?? 0 });
    record.set(loser, { won: record.get(loser)?.won ?? 0, lost: (record.get(loser)?.lost ?? 0) + 1 });
  }
  const locks = new Set(state.locks);

  const rows = cards.map((entry) => {
    const id = entry.card.oracle_id;
    const land = isLand(entry.card.type_line);
    const shared = sharedThemes(entry);
    const roles = spellRoles(entry);

    // Saturation pressure (Lands left out).
    let saturation: number = CUTTER.neutral;
    if (roles.length) {
      const overness = roles.map((k) => {
        const over = (counts[k] ?? 0) - (roleBy.get(k)!.target ?? 0);
        return over > 0 ? Math.min(1, over / CUTTER.overnessFull) : 0;
      });
      const allOver = overness.every((o) => o > 0);
      const pressure = (overness.reduce((a, b) => a + b, 0) / overness.length) * (allOver ? 1 : CUTTER.partialOverFactor);
      saturation = 1 - pressure;
    }

    // Weakest in role, or within its strongest theme when no role can be ranked.
    const ranks: RankFact[] = [];
    const standings: number[] = [];
    for (const k of roles) {
      const r = rankIn.get(k)?.get(id);
      if (!r) continue;
      standings.push(r.standing);
      ranks.push({ key: k, name: roleBy.get(k)!.name, position: r.position, of: r.of });
    }
    let weakest: number = CUTTER.neutral;
    let themeRank: CardScore["facts"]["themeRank"];
    if (standings.length) weakest = standings.reduce((a, b) => a + b, 0) / standings.length;
    else if (!roles.length && shared.length && !land) {
      const best = [...shared].sort((a, b) => b.score - a.score)[0];
      const mates = main.filter((c) => !isLand(c.card.type_line) && keysBy.get(c)!.has(best.key));
      const i = mates.findIndex((c) => c.card.oracle_id === id);
      if (mates.length >= CUTTER.minRoleSize && i >= 0) {
        const mvs = mates.map((c) => -c.card.mana_value);
        weakest = standing(mvs, i, true);
        themeRank = { theme: best, position: positionFromBottom(mvs, i), of: mates.length };
      }
    }

    const h2h = record.get(id);
    if (h2h) weakest = 0.5 * weakest + 0.5 * (h2h.won / (h2h.won + h2h.lost));

    // Curve fit.
    const bucket = curveBucket(entry.card.mana_value);
    const bucketShare = curve.shares[bucket];
    const expectedShare = archetype.curve[bucket];
    const cheatTarget = cheat.targets.has(id);
    const curveFit = cheatTarget || land || bucket < CUTTER.curveFreeBuckets ? 1 : 1 -Math.min(1, Math.max(0, bucketShare - expectedShare) / CUTTER.curveExcessFull);

    // Mana strain: the color with the most pips that's short on land sources.
    let strain: Color | null = null;
    if (!land && balance.lands > 0) {
      const pips = Object.entries(pipsOf(entry.card.mana_cost)) as [Color, number][];
      const short = pips.filter(([c, n]) => n >= CUTTER.strainPips && (shareOf.get(c) ?? 0) < CUTTER.strainSourceShare).sort((a, b) => b[1] - a[1]);
      strain = short[0]?.[0] ?? null;
    }

    // Protection, most important reason first.
    let protect: Protection | null = null;
    const below = roles
      .map((k) => ({ k, count: counts[k] ?? 0, target: roleBy.get(k)!.target }))
      .filter((r) => r.count - 1 < r.target);
    if (entry.commander) protect = { kind: "commander", detail: "Your commander" };
    else if (land) protect = { kind: "land", detail: "Lands aren't suggested yet" };
    else if (locks.has(id)) protect = { kind: "lock", detail: "Locked: never suggested" };
    else if (!entry.tags.length) protect = { kind: "no-tags", detail: "No tags yet, so it can't be scored" };
    else if (prefs.comboProtect && inCombo.has(id)) protect = { kind: "combo", detail: "Part of a two-card combo" };
    else if (below.length)
      protect = {
        kind: "below-target",
        detail: below.map((r) => `${roleBy.get(r.k)!.name} would drop to ${r.count - 1} / ${r.target}`).join("; "),
      };
    else if (id in state.dismissed) protect = { kind: "dismissed", detail: state.dismissed[id] ? `Dismissed: ${state.dismissed[id]}` : "Dismissed" };

    return {
      entry,
      shared,
      hits: hitCount(entry, shared),
      fitRaw: shared.reduce((n, t) => n + looThemeWeight(t), 0) / themeTotal,
      saturation,
      weakest,
      curveFit,
      ranks,
      themeRank,
      bucket,
      bucketShare,
      expectedShare,
      cheatTarget,
      strain,
      protect,
    };
  });

  const scored = rows.filter((r) => !r.entry.commander);
  const maxHits = Math.max(0, ...scored.map((r) => r.hits));
  const maxFit = Math.max(0, ...scored.map((r) => r.fitRaw));
  const w = prefs.weights;
  const wSum = w.coverage + w.saturation + w.weakest + w.theme + w.curve || 1;
  const inFinding = (id: string) => ctx.bracketFindings.filter((f) => f.cards.includes(id)).map((f) => f.label);

  return rows.map((r): CardScore => {
    const parts: Record<Part, number> = {
      coverage: maxHits ? r.hits / maxHits : CUTTER.neutral,
      saturation: r.saturation,
      weakest: r.weakest,
      theme: maxFit ? r.fitRaw / maxFit : CUTTER.neutral,
      curve: r.curveFit,
    };
    const keep = (w.coverage * parts.coverage + w.saturation * parts.saturation + w.weakest * parts.weakest + w.theme * parts.theme + w.curve * parts.curve) / wSum;
    const id = r.entry.card.oracle_id;
    return {
      entry: r.entry,
      keep,
      parts,
      flags: { bracket: inFinding(id), strain: r.strain, noTags: !r.entry.tags.length, cheatTarget: r.cheatTarget, popularity: popularity(r.entry.card.edhrec_rank) },
      protect: r.protect,
      facts: {
        roles: spellRoles(r.entry).map((k) => ({ key: k, name: roleBy.get(k)!.name, count: counts[k] ?? 0, target: roleBy.get(k)!.target })),
        themes: r.shared,
        hits: r.hits,
        maxHits,
        ranks: r.ranks,
        themeRank: r.themeRank,
        bucket: r.bucket,
        bucketShare: r.bucketShare,
        expectedShare: r.expectedShare,
      },
    };
  });
}

/** The cut to make next: the lowest keep score nothing protects; near-ties go to the less played card. */
function weakestOf(scores: CardScore[]): CardScore | null {
  const open = scores.filter((s) => !s.protect);
  if (!open.length) return null;
  const low = Math.min(...open.map((s) => s.keep));
  const near = open.filter((s) => s.keep <= low + CUTTER.tieMargin);
  near.sort((a, b) => a.flags.popularity - b.flags.popularity || a.keep - b.keep || a.entry.card.name.localeCompare(b.entry.card.name));
  return near[0];
}

/** One copy fewer of a card (the row goes when it reaches 0). */
export function withoutOne(cards: CutterCard[], oracleId: string): CutterCard[] {
  return cards.flatMap((c) => (c.commander || c.card.oracle_id !== oracleId ? [c] : c.quantity > 1 ? [{ ...c, quantity: c.quantity - 1 }] : []));
}

export type PlannedCut = { score: CardScore };

/**
 * Up to `n` cuts, picked one at a time: after each, the deck is scored again as if that card were gone, so cutting
 * one over-target Ramp card doesn't make every Ramp card look like a cut.
 */
export function planCuts(ctx: CutterContext, n: number): PlannedCut[] {
  const out: PlannedCut[] = [];
  let cards = ctx.cards;
  let themes = ctx.themes;
  for (let i = 0; i < n; i++) {
    const pick = weakestOf(keepScores({ ...ctx, cards, themes }));
    if (!pick) break;
    out.push({ score: pick });
    cards = withoutOne(cards, pick.entry.card.oracle_id);
    if (ctx.themesFor) themes = ctx.themesFor(cards);
  }
  return out;
}

export const deckCount = (cards: CutterCard[]) => cards.reduce((n, c) => n + c.quantity, 0);

export type CutterPlan =
  | { mode: "over"; size: number; cuts: PlannedCut[] }
  | { mode: "exact"; size: number; cuts: PlannedCut[] }
  | { mode: "under"; size: number; need: number; under: RoleFact[] };

/** What the Cutter shows: cuts down to 100, the 3 weakest at exactly 100, or the roles to fill under 100. */
export function suggestCuts(ctx: CutterContext, deckSize = 100): CutterPlan {
  const size = deckCount(ctx.cards);
  if (size > deckSize) return { mode: "over", size, cuts: planCuts(ctx, size - deckSize) };
  if (size === deckSize) return { mode: "exact", size, cuts: planCuts(ctx, CUTTER.shortlist) };
  const counts = roleCountsOf(ctx.cards);
  const under = ctx.roles
    .filter((r) => (counts[r.key] ?? 0) < r.target)
    .map((r) => ({ key: r.key, name: r.name, count: counts[r.key] ?? 0, target: r.target }));
  return { mode: "under", size, need: deckSize - size, under };
}

export type BelowTarget = { key: string; name: string; from: number; to: number; target: number };

/**
 * Roles a manual removal would put below target (Lands left out), for the editor's warning.
 * `removing`: oracle_id -> copies removed from the deck.
 */
export function belowTargetWarning(cards: CutterCard[], roles: ResolvedRole[], removing: Record<string, number>): BelowTarget[] {
  const counts = roleCountsOf(cards);
  const lost: Record<string, number> = {};
  for (const c of cards) {
    const n = Math.min(c.quantity, removing[c.card.oracle_id] ?? 0);
    if (!n || c.commander) continue;
    for (const k of c.roles) lost[k] = (lost[k] ?? 0) + n;
  }
  return roles
    .filter((r) => !r.land && lost[r.key])
    .map((r) => ({ key: r.key, name: r.name, from: counts[r.key] ?? 0, to: (counts[r.key] ?? 0) - lost[r.key], target: r.target }))
    .filter((r) => r.to < r.target);
}

/** "Board wipes would drop to 2 / 3" lines for the warning. */
export const belowTargetText = (rows: BelowTarget[]) =>
  rows.map((r) => `${r.name} would drop to ${r.to} / ${r.target}${r.from < r.target ? ` (already under, ${plural(r.from, "card")} now)` : ""}`);
