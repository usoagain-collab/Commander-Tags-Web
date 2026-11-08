// Smart Cutter swaps (docs/spec.md → Smart Cutter, section 3): a card from suggestion_pool to replace a cut
// (one-for-one at exactly 100), and two single-role cards → one card that fills both roles (power user).
// Pure: the caller fetches the pool and screens it for bracket issues.
import type { CardSummary } from "@/lib/deck/model";
import { DEFAULT_SUGGEST, scorePool, type PoolCard } from "@/lib/suggest/score";
import type { CutterCard } from "./archetype";
import { keepScores, roleCountsOf, withoutOne, type CardScore, type CutterContext } from "./score";

export type SwapPick = { card: CardSummary; tags: string[]; keep: number; fromFloor: boolean; replaces: string[] };

export type SwapOptions = {
  /** Roles a card from the pool fills (visible roles, like the deck's). */
  rolesFor: (card: CardSummary, tags: string[]) => string[];
  /** Leave these out: dismissed from Suggest, above the bracket target, already in the deck. */
  skip: (card: PoolCard) => boolean;
  /** Cards on this visit's cutting-room floor: looked at first. */
  floor?: CutterCard[];
  /** How many of the best-fitting candidates to test against the deck. */
  tries?: number;
};

const asEntry = (card: CardSummary, tags: string[], roles: string[]): CutterCard => ({ card, quantity: 1, commander: false, tags, roles });

/** Keep score of `entry` in the deck with `out` removed and it added. */
function keepAfterSwap(ctx: CutterContext, out: string[], entry: CutterCard): number {
  let cards = ctx.cards;
  for (const id of out) cards = withoutOne(cards, id);
  const next = [...cards, entry];
  const s = keepScores({ ...ctx, cards: next, themes: ctx.themesFor ? ctx.themesFor(next) : ctx.themes }).at(-1)!;
  return s.keep;
}

/**
 * Candidates in the order to try them: floor cards first, then the pool ranked with Best fit. A candidate may refill
 * the roles in `own` (the ones the cut cards filled), but never adds to another role already at or over target
 * (Omo was offered Migration Path, Ramp too, for a Card advantage cut while Ramp sat at 26 / 10; tuning, Nov 8, 2026).
 */
function ranked(
  ctx: CutterContext,
  out: string[],
  pool: PoolCard[],
  opts: SwapOptions,
  own: string[],
  wanted: (roles: string[], c: CutterCard) => boolean,
) {
  const remaining = out.reduce((cards, id) => withoutOne(cards, id), ctx.cards);
  const counts = roleCountsOf(remaining);
  const under = new Set(ctx.roles.filter((r) => !r.land && (counts[r.key] ?? 0) < r.target).map((r) => r.key));
  const full = new Set(ctx.roles.filter((r) => !r.land && !own.includes(r.key) && (counts[r.key] ?? 0) >= r.target).map((r) => r.key));
  const fits = (roles: string[], c: CutterCard) => !roles.some((k) => full.has(k)) && wanted(roles, c);
  const fromFloor = (opts.floor ?? []).filter((c) => !out.includes(c.card.oracle_id) && fits(c.roles, c));
  const inDeck = new Set(ctx.cards.map((c) => c.card.oracle_id));
  const usable = pool.filter((c) => !inDeck.has(c.oracle_id) && !opts.skip(c));
  const entryOf = new Map(usable.map((c) => [c.oracle_id, asEntry(c, c.tags, opts.rolesFor(c, c.tags))]));
  const scored = scorePool(
    usable.filter((c) => fits(entryOf.get(c.oracle_id)!.roles, entryOf.get(c.oracle_id)!)),
    {
      themes: ctx.themes,
      keysOf: (c) => ctx.keysOf(entryOf.get(c.oracle_id)!),
      rolesOf: (c) => entryOf.get(c.oracle_id)!.roles,
      under,
      settings: DEFAULT_SUGGEST,
      limit: opts.tries ?? 8,
    },
  );
  return [...fromFloor.map((c) => ({ entry: c, fromFloor: true })), ...scored.map((r) => ({ entry: entryOf.get(r.card.oracle_id)!, fromFloor: false }))];
}

/**
 * One-for-one: the first candidate that fills one of the cut card's roles (or, for a card with no role, shares one
 * of its themes) and keeps a higher score in the deck than the cut card had.
 */
export function pickSwap(ctx: CutterContext, cut: CardScore, pool: PoolCard[], opts: SwapOptions): SwapPick | null {
  const id = cut.entry.card.oracle_id;
  const cutRoles = cut.facts.roles.map((r) => r.key);
  const cutThemes = new Set(cut.facts.themes.map((t) => t.key));
  const wanted = (roles: string[], c: CutterCard) =>
    cutRoles.length ? roles.some((k) => cutRoles.includes(k)) : ctx.keysOf(c).some((k) => cutThemes.has(k));
  for (const { entry, fromFloor } of ranked(ctx, [id], pool, opts, cutRoles, wanted)) {
    const keep = keepAfterSwap(ctx, [id], entry);
    if (keep > cut.keep) return { card: entry.card, tags: entry.tags, keep, fromFloor, replaces: [id] };
  }
  return null;
}

export type Pair = { a: CardScore; b: CardScore; roles: [string, string] };

/** Pairs of cuttable cards that each fill exactly one role, different ones, weakest pairs first. */
export function twoForOnePairs(scores: CardScore[], limit = 3): Pair[] {
  const single = scores.filter((s) => !s.protect && s.facts.roles.length === 1);
  const pairs: Pair[] = [];
  for (let i = 0; i < single.length; i++)
    for (let j = i + 1; j < single.length; j++) {
      const [a, b] = [single[i], single[j]];
      if (a.facts.roles[0].key !== b.facts.roles[0].key) pairs.push({ a, b, roles: [a.facts.roles[0].key, b.facts.roles[0].key] });
    }
  const used = new Set<string>();
  return pairs
    .sort((x, y) => x.a.keep + x.b.keep - (y.a.keep + y.b.keep))
    .filter((p) => {
      const ids = [p.a.entry.card.oracle_id, p.b.entry.card.oracle_id];
      if (ids.some((x) => used.has(x))) return false;
      ids.forEach((x) => used.add(x));
      return true;
    })
    .slice(0, limit);
}

/** One pool card filling both roles of the pair, scoring above both cards it replaces. */
export function pickTwoForOne(ctx: CutterContext, pair: Pair, pool: PoolCard[], opts: SwapOptions): SwapPick | null {
  const out = [pair.a.entry.card.oracle_id, pair.b.entry.card.oracle_id];
  const wanted = (roles: string[]) => pair.roles.every((k) => roles.includes(k));
  for (const { entry, fromFloor } of ranked(ctx, out, pool, { ...opts, floor: [] }, pair.roles, wanted)) {
    const keep = keepAfterSwap(ctx, out, entry);
    if (keep > Math.max(pair.a.keep, pair.b.keep)) return { card: entry.card, tags: entry.tags, keep, fromFloor, replaces: out };
  }
  return null;
}
