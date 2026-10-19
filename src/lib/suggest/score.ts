// Suggestion scoring (Phase 4), ported exactly from the prototype's scorePool:
//   fit        = the deck theme-tag weight a card shares / the total theme weight, normalized to the best
//                candidate, + 0.12 per under-target role it fills (capped at 1)
//   popularity = 1 - min(EDHREC rank, 20000) / 20000 (unranked = 0)
//   styles     = Best fit, Hidden gems, Budget, Custom (CLAUDE.md, Phase 4 plan)
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
};

export const popularity = (rank: number | null) => (rank ? 1 - Math.min(rank, 20000) / 20000 : 0);

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
      return { card, shared, fitRaw, fills, price, pop: popularity(card.edhrec_rank), fit: 0, score: 0 };
    });

  const maxFit = Math.max(0.0001, ...rows.map((r) => r.fitRaw));
  for (const r of rows) {
    r.fit = Math.min(1, r.fitRaw / maxFit + 0.12 * r.fills.length);
    const cheap = r.price == null ? 0.5 : 1 - Math.min(r.price, 20) / 20;
    if (settings.style === "best") r.score = 0.6 * r.fit + 0.4 * r.pop;
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
  // Hidden gems only shows cards with some fit, so "least played" doesn't mean "random".
  if (settings.style === "gems") out = out.filter((r) => r.fitRaw > 0 || r.fills.length > 0);
  return out.sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name)).slice(0, ctx.limit ?? 24);
}
