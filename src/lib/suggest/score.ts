// Suggestion scoring (Phase 4), ported exactly from the prototype's scorePool:
//   fit        = the deck theme-tag weight a card shares / the total theme weight, normalized to the best
//                candidate, + 0.12 per under-target role it fills (capped at 1)
//   popularity = 1 - min(EDHREC rank, 20000) / 20000 (unranked = 0)
//   styles     = Best fit, Hidden gems, Budget, Custom (CLAUDE.md, Phase 4 plan)
// Role mode (the 💡 on a role row; David, Nov 7, 2026): the question is "the best card for this job", so staples like
// Sol Ring can't sink for sharing no themes. Fit = 5/9 theme fit + 4/9 cheap to cast, popularity on a log scale
// (rank 1 and rank 1,000 are far apart, not 0.05 apart), and Best fit = 0.45 fit + 0.55 popularity.
import type { CardSummary } from "@/lib/deck/model";
import type { TagKey, ThemeTag } from "@/lib/tags/themes";

/** A card from suggestion_pool(): its summary plus its oracle tag slugs. */
export type PoolCard = CardSummary & { tags: string[] };

export type SuggestStyle = "best" | "gems" | "budget" | "custom";
export const STYLE_LABELS: Record<SuggestStyle, string> = {
  best: "Best fit",
  gems: "Hidden gems",
  budget: "Budget",
  custom: "Custom",
};
/** Custom weights: fit and price are 0..1; popularity is -1..1 (negative = favor less-played cards). */
export type SuggestWeights = { fit: number; pop: number; price: number };
export type SuggestSettings = { style: SuggestStyle; priceCap: number; weights: SuggestWeights };
export const DEFAULT_SUGGEST: SuggestSettings = { style: "best", priceCap: 5, weights: { fit: 0.6, pop: 0.4, price: 0 } };

export type Scored = {
  card: PoolCard;
  /** Deck theme tags this card shares, most central first. */
  shared: ThemeTag[];
  /** Under-target roles it would fill. */
  fills: string[];
  fitRaw: number;
  fit: number;
  pop: number;
  price: number | null;
  score: number;
};

export type ScoreContext = {
  /** The deck's top theme tags (the prototype uses 15). */
  themes: ThemeTag[];
  /** A candidate's tag keys, matching how the themes were counted (Specific or Broad). */
  keysOf: (card: PoolCard) => TagKey[];
  /** Roles a candidate fills. */
  rolesOf: (card: PoolCard) => string[];
  /** Keys of roles under their target (lands excluded). */
  under: Set<string>;
  settings: SuggestSettings;
  /** Hidden: cards dismissed for this deck. */
  dismissed?: Set<string>;
  limit?: number;
  /** Suggesting for one role: every candidate already does the job, so rank by how well (see the top). */
  role?: boolean;
};

export const popularity = (rank: number | null) => (rank ? 1 - Math.min(rank, 20000) / 20000 : 0);
/** Popularity on a log scale: rank 1 = 1, rank 100 ≈ 0.54, rank 1,000 ≈ 0.30, 20,000+ = 0 (unranked = 0). */
export const logPopularity = (rank: number | null) => (rank ? 1 - Math.log(Math.min(Math.max(rank, 1), 20000)) / Math.log(20000) : 0);
/** 1 for a free spell, 0 at mana value 6 or more. */
export const cheapToCast = (mv: number) => 1 - Math.min(Math.max(mv, 0), 6) / 6;

export function scorePool(pool: PoolCard[], ctx: ScoreContext): Scored[] {
  const { themes, settings } = ctx;
  const weight = new Map(themes.map((t) => [t.key, t]));
  const totalW = themes.reduce((n, t) => n + t.score, 0) || 1;

  const rows = pool
    .filter((c) => !ctx.dismissed?.has(c.oracle_id))
    .map((card) => {
      const shared = ctx
        .keysOf(card)
        .flatMap((k) => (weight.has(k) ? [weight.get(k)!] : []))
        .sort((a, b) => b.score - a.score);
      const fitRaw = shared.reduce((n, t) => n + t.score, 0) / totalW;
      const fills = ctx.rolesOf(card).filter((k) => ctx.under.has(k));
      const price = card.price_usd == null ? null : Number(card.price_usd);
      const pop = ctx.role ? logPopularity(card.edhrec_rank) : popularity(card.edhrec_rank);
      return { card, shared, fitRaw, fills, price, pop, fit: 0, score: 0 };
    });

  const maxFit = Math.max(0.0001, ...rows.map((r) => r.fitRaw));
  for (const r of rows) {
    const theme = r.fitRaw / maxFit;
    const base = ctx.role ? (5 * theme + 4 * cheapToCast(r.card.mana_value)) / 9 : theme;
    r.fit = Math.min(1, base + 0.12 * r.fills.length);
    const cheap = r.price == null ? 0.5 : 1 - Math.min(r.price, 20) / 20;
    if (settings.style === "best") r.score = ctx.role ? 0.45 * r.fit + 0.55 * r.pop : 0.6 * r.fit + 0.4 * r.pop;
    else if (settings.style === "gems") r.score = 0.65 * r.fit + 0.35 * (1 - r.pop);
    else if (settings.style === "budget")
      r.score = 0.6 * r.fit + 0.25 * r.pop + 0.15 * (r.price == null ? 0.5 : 1 - r.price / Math.max(0.01, settings.priceCap));
    else {
      const w = settings.weights;
      const sum = Math.abs(w.fit) + Math.abs(w.pop) + Math.abs(w.price) || 1;
      const popTerm = w.pop >= 0 ? r.pop : 1 - r.pop;
      r.score = (w.fit * r.fit + Math.abs(w.pop) * popTerm + w.price * cheap) / sum;
    }
  }

  let out = rows;
  if (settings.style === "budget") out = out.filter((r) => r.price != null && r.price <= settings.priceCap);
  // Hidden gems needs at least two shared theme tags, so "least played" doesn't mean "random" (one shared tag
  // let filler through in the Phase 4c EDHREC check; David, Oct 19, 2026). For a role, doing the job is the first
  // match, so one shared theme is enough.
  if (settings.style === "gems") out = out.filter((r) => r.shared.length >= (ctx.role ? 1 : 2));
  return out.sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name)).slice(0, ctx.limit ?? 24);
}

/**
 * Staples (overall Suggest): the most-played cards that fill a role the deck is short on, by EDHREC rank alone,
 * so Sol Ring and Arcane Signet show even when they share none of the deck's themes. Each short role gets a fair
 * share of the slots first (ramp staples are the most played, so they'd fill the row), then the rest go by rank.
 */
export function pickStaples(pool: PoolCard[], ctx: Pick<ScoreContext, "rolesOf" | "under" | "dismissed">, limit = 8): Scored[] {
  const ranked = pool
    .filter((c) => c.edhrec_rank != null && !ctx.dismissed?.has(c.oracle_id))
    .map((card) => ({ card, fills: ctx.rolesOf(card).filter((k) => ctx.under.has(k)) }))
    .filter((r) => r.fills.length > 0)
    .sort((a, b) => a.card.edhrec_rank! - b.card.edhrec_rank! || a.card.name.localeCompare(b.card.name));
  const share = Math.max(1, Math.ceil(limit / new Set(ranked.map((r) => r.fills[0])).size));
  const perRole = new Map<string, number>();
  const fair = ranked.filter((r) => {
    const n = perRole.get(r.fills[0]) ?? 0;
    perRole.set(r.fills[0], n + 1);
    return n < share;
  });
  const picked = new Set(fair.slice(0, limit));
  for (const r of ranked) if (picked.size < limit) picked.add(r);
  return ranked
    .filter((r) => picked.has(r))
    .map(({ card, fills }) => {
      const pop = logPopularity(card.edhrec_rank);
      const price = card.price_usd == null ? null : Number(card.price_usd);
      return { card, shared: [], fills, fitRaw: 0, fit: 0, pop, price, score: pop };
    });
}

const clamp =(n: unknown, lo: number, hi: number, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;

/** decks.suggest_settings, read defensively (it's JSON from the database). Empty = defaults. */
export function readSuggestSettings(saved: unknown): SuggestSettings {
  const s = (saved ?? {}) as Partial<{ style: unknown; priceCap: unknown; weights: Partial<Record<keyof SuggestWeights, unknown>> }>;
  const w = s.weights ?? {};
  return {
    style: typeof s.style === "string" && s.style in STYLE_LABELS ? (s.style as SuggestStyle) : DEFAULT_SUGGEST.style,
    priceCap: clamp(s.priceCap, 0.25, 100, DEFAULT_SUGGEST.priceCap),
    weights: {
      fit: clamp(w.fit, 0, 1, DEFAULT_SUGGEST.weights.fit),
      pop: clamp(w.pop, -1, 1, DEFAULT_SUGGEST.weights.pop),
      price: clamp(w.price, 0, 1, DEFAULT_SUGGEST.weights.price),
    },
  };
}
