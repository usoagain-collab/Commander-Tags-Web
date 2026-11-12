// Prices per store (v2, Nov 11, 2026; docs/spec.md → "Prices from MTGJSON", option A). Pure logic, shared by the
// browser and the nightly scripts/import-prices.mts.
//
// TCGplayer is the price we always had: Scryfall's USD price is TCGplayer's. Card Kingdom, Mana Pool and Cardmarket
// come from MTGJSON's daily price file and are stored compactly (migration 0053): on `cards.store_prices` for the
// cheapest printing of each card, and on a chosen printing's `printing_info.stores` for that exact printing.
//
// A viewer picks where prices come from (Settings → Prices, `tag_view.priceSource`). Everything that shows a price
// reads it through `priceCards` / `pricePrintings` at the point where a page loads its cards, so the totals, sorts,
// stats and caps further down need no changes of their own.
import type { ChosenPrinting } from "./printing";

/** Stores MTGJSON adds. ck = Card Kingdom, mp = Mana Pool (USD), cm = Cardmarket (EUR). */
export type StoreKey = "ck" | "mp" | "cm";
/** Retail normal / foil / etched, and for Card Kingdom what it pays (buylist) normal / foil. */
export type StoreQuote = { n?: number; f?: number; e?: number; bn?: number; bf?: number };
export type StorePrices = Partial<Record<StoreKey, StoreQuote>>;
/** Change of the cheapest TCGplayer price: fractions (0.4 = +40%) and the old prices. */
export type PriceTrend = { d7?: number; d30?: number; was7?: number; was30?: number };

/** Where totals and every shown price come from. Cardmarket is euros, so it shows in lists but can't be a source. */
export type PriceSource = "tcgplayer" | "cardkingdom" | "manapool" | "cheapest";
export const PRICE_SOURCES: { key: PriceSource; label: string; about: string }[] = [
  { key: "tcgplayer", label: "TCGplayer", about: "The usual US market price (from Scryfall)." },
  { key: "cardkingdom", label: "Card Kingdom", about: "Card Kingdom's retail price, often a bit higher." },
  { key: "manapool", label: "Mana Pool", about: "Mana Pool's retail price." },
  { key: "cheapest", label: "Cheapest store", about: "The lowest of TCGplayer, Card Kingdom and Mana Pool for each card." },
];
export const STORE_NAMES: Record<StoreKey | "tcg", string> = { tcg: "TCGplayer", ck: "Card Kingdom", mp: "Mana Pool", cm: "Cardmarket" };

export function readPriceSource(prefs: Record<string, unknown>): PriceSource {
  const v = prefs.priceSource;
  return PRICE_SOURCES.some((s) => s.key === v) ? (v as PriceSource) : "tcgplayer";
}

export const priceSourceLabel = (s: PriceSource) => PRICE_SOURCES.find((p) => p.key === s)?.label ?? "TCGplayer";

type Finish = "n" | "f" | "e";
const pos = (n: unknown): number | null => (typeof n === "number" && n > 0 ? n : null);

/** A store's price for a finish. Etched falls back to foil (and foil to etched), as deck prices already treat them. */
export function quoteFor(q: StoreQuote | undefined, finish: Finish): number | null {
  if (!q) return null;
  if (finish === "n") return pos(q.n);
  return finish === "f" ? (pos(q.f) ?? pos(q.e)) : (pos(q.e) ?? pos(q.f));
}

/**
 * The price for a source, given the TCGplayer price (Scryfall's) and the MTGJSON stores. A store with no price for
 * this card falls back to TCGplayer, so a total never drops a card. Returns null only when nobody has a price.
 */
export function priceFrom(source: PriceSource, tcg: number | null, stores: StorePrices | null | undefined, finish: Finish): number | null {
  const t = pos(tcg);
  if (source === "tcgplayer" || !stores) return t;
  const ck = quoteFor(stores.ck, finish);
  const mp = quoteFor(stores.mp, finish);
  if (source === "cardkingdom") return ck ?? t;
  if (source === "manapool") return mp ?? t;
  const all = [t, ck, mp].filter((x): x is number => x !== null);
  return all.length ? Math.min(...all) : null;
}

type Priced = { price_usd: number | null; store_prices?: StorePrices | null; tcg_usd?: number | null };

/**
 * Cards as the chosen source prices them (the cheapest printing at that store). `price_usd` is replaced; the
 * original TCGplayer price stays on `tcg_usd` for the card sheet's store list. TCGplayer returns the same objects.
 */
export function priceCard<C extends Priced>(card: C, source: PriceSource): C & { tcg_usd?: number | null } {
  // Safe to run twice: a card priced before (it has tcg_usd) starts again from its TCGplayer price.
  const already = "tcg_usd" in card;
  const raw = already ? card.tcg_usd : card.price_usd;
  const tcg = raw == null ? null : Number(raw);
  if (source === "tcgplayer" || !card.store_prices) return already ? { ...card, price_usd: tcg } : card;
  // A card with no regular price anywhere (some promos) is priced by its foil, as the nightly import does.
  const p = priceFrom(source, tcg, card.store_prices, "n") ?? priceFrom(source, null, card.store_prices, "f");
  return { ...card, price_usd: p ?? card.price_usd, tcg_usd: tcg };
}

export function priceCards<C extends Priced>(cards: Record<string, C>, source: PriceSource): Record<string, C> {
  if (source === "tcgplayer") return cards;
  return Object.fromEntries(Object.entries(cards).map(([k, c]) => [k, priceCard(c, source)]));
}

/** A chosen printing with its usd / foil / etched prices from the chosen source (no change when it has no stores). */
export function pricePrinting<P extends ChosenPrinting | undefined>(p: P, source: PriceSource): P {
  if (!p || source === "tcgplayer" || !p.stores) return p;
  return {
    ...p,
    usd: priceFrom(source, p.usd, p.stores, "n"),
    usd_foil: priceFrom(source, p.usd_foil, p.stores, "f"),
    usd_etched: priceFrom(source, p.usd_etched, p.stores, "e"),
  };
}

export function pricePrintings<T extends Record<string, ChosenPrinting>>(printings: T, source: PriceSource): T {
  if (source === "tcgplayer") return printings;
  return Object.fromEntries(Object.entries(printings).map(([k, p]) => [k, pricePrinting(p, source)])) as T;
}

/** Every store's price for one card or printing, for the card sheet: TCGplayer first, Cardmarket (€) last. */
export function storeList(tcg: number | null, stores: StorePrices | null | undefined, foil: boolean) {
  const finish: Finish = foil ? "f" : "n";
  const rows: { key: StoreKey | "tcg"; name: string; price: number | null; currency: "$" | "€" }[] = [
    { key: "tcg", name: STORE_NAMES.tcg, price: pos(tcg), currency: "$" },
    { key: "ck", name: STORE_NAMES.ck, price: quoteFor(stores?.ck, finish), currency: "$" },
    { key: "mp", name: STORE_NAMES.mp, price: quoteFor(stores?.mp, finish), currency: "$" },
    { key: "cm", name: STORE_NAMES.cm, price: quoteFor(stores?.cm, finish), currency: "€" },
  ];
  const buylist = pos(foil ? stores?.ck?.bf : stores?.ck?.bn);
  return { rows: rows.filter((r) => r.price !== null), buylist };
}

/** A trend worth a mark: moved 20%+ in 30 days and by at least 50 cents, so a $0.10 card doubling stays quiet. */
export const TREND_MIN_SHARE = 0.2;
export const TREND_MIN_DOLLARS = 0.5;

export function trendMark(trend: PriceTrend | null | undefined): { up: boolean; share: number; was: number } | null {
  if (!trend || trend.d30 == null || trend.was30 == null) return null;
  if (Math.abs(trend.d30) < TREND_MIN_SHARE || Math.abs(trend.was30 * trend.d30) < TREND_MIN_DOLLARS) return null;
  return { up: trend.d30 > 0, share: trend.d30, was: trend.was30 };
}

export const trendText = (share: number) => `${share > 0 ? "↑" : "↓"} ${Math.round(Math.abs(share) * 100)}% in 30 days`;

/** A deck's total for every source, as `deck_price_history.totals` stores it: t, ck, mp, min. */
export const HISTORY_KEYS: Record<PriceSource, string> = { tcgplayer: "t", cardkingdom: "ck", manapool: "mp", cheapest: "min" };

export type HistoryPoint = { day: string; total: number };

/** One source's line from history rows (oldest first), skipping days with no total for it. */
export function historyLine(rows: { day: string; totals: Record<string, number> }[], source: PriceSource): HistoryPoint[] {
  const key = HISTORY_KEYS[source];
  return rows
    .filter((r) => typeof r.totals?.[key] === "number")
    .map((r) => ({ day: r.day, total: r.totals[key] }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
