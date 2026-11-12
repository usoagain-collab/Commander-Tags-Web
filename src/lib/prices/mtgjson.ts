// Reading MTGJSON price files (v2, Nov 11, 2026) into the compact shapes of src/lib/deck/store-prices.ts. Pure
// logic for scripts/import-prices.mts, tested in mtgjson.test.ts.
//
// AllPricesToday / AllPrices: { data: { <mtgjson uuid>: { paper?: { <provider>: { currency, retail?, buylist? } } } } }
// where retail and buylist are { normal?, foil?, etched? } and each finish is { "YYYY-MM-DD": price }.
import type { PriceTrend, StorePrices, StoreQuote } from "../deck/store-prices";

type DatePrices = Record<string, number>;
type FinishPrices = { normal?: DatePrices; foil?: DatePrices; etched?: DatePrices };
type ProviderPrices = { currency?: string; retail?: FinishPrices; buylist?: FinishPrices };
export type MtgjsonCardPrices = { paper?: Record<string, ProviderPrices | undefined> };

const PROVIDERS: Record<"ck" | "mp" | "cm", string> = { ck: "cardkingdom", mp: "manapool", cm: "cardmarket" };

/** The newest price in a date map (today's file has one date; the 90-day file many). */
export function latest(prices: DatePrices | undefined): number | undefined {
  if (!prices) return undefined;
  let day = "";
  for (const d of Object.keys(prices)) if (d > day) day = d;
  const v = day ? prices[day] : undefined;
  return typeof v === "number" && v > 0 ? round(v) : undefined;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** One printing's store prices from today's file. Undefined when no store we keep has a price. */
export function printingStores(card: MtgjsonCardPrices | undefined): StorePrices | undefined {
  const out: StorePrices = {};
  for (const [key, name] of Object.entries(PROVIDERS) as ["ck" | "mp" | "cm", string][]) {
    const p = card?.paper?.[name];
    if (!p) continue;
    const q: StoreQuote = {};
    const set = (k: keyof StoreQuote, v: number | undefined) => {
      if (v !== undefined) q[k] = v;
    };
    set("n", latest(p.retail?.normal));
    set("f", latest(p.retail?.foil));
    set("e", latest(p.retail?.etched));
    if (key === "ck") {
      set("bn", latest(p.buylist?.normal));
      set("bf", latest(p.buylist?.foil ?? p.buylist?.etched));
    }
    if (Object.keys(q).length) out[key] = q;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Cheapest printing per store and finish across a card's printings (what `cards.store_prices` holds). Buylist offers
 * are left out: they only mean something for one exact printing (a collector printing of Sol Ring is offered
 * thousands), so they show only for printings someone picked.
 */
export function cheapestStores(printings: (StorePrices | undefined)[]): StorePrices | undefined {
  const out: StorePrices = {};
  for (const sp of printings) {
    if (!sp) continue;
    for (const [store, q] of Object.entries(sp) as ["ck" | "mp" | "cm", StoreQuote][]) {
      if (q.n === undefined && q.f === undefined && q.e === undefined) continue;
      const o = (out[store] ??= {});
      for (const k of ["n", "f", "e"] as const) if (q[k] !== undefined && !(o[k]! <= q[k]!)) o[k] = q[k];
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** A date `days` before `day` (YYYY-MM-DD, UTC). */
export function daysBefore(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** The price on `day`, or the closest earlier day within 3 days (MTGJSON skips the odd day). */
export function priceOn(prices: DatePrices | undefined, day: string): number | undefined {
  if (!prices) return undefined;
  for (let back = 0; back <= 3; back++) {
    const v = prices[daysBefore(day, back)];
    if (typeof v === "number" && v > 0) return v;
  }
  return undefined;
}

/** Running cheapest TCGplayer normal price per card on three days: today, 7 and 30 days ago. */
export type TrendAcc = { now?: number; was7?: number; was30?: number };

export function addToTrend(acc: TrendAcc, card: MtgjsonCardPrices | undefined, today: string) {
  const normal = card?.paper?.tcgplayer?.retail?.normal;
  if (!normal) return;
  const keep = (k: keyof TrendAcc, v: number | undefined) => {
    if (v !== undefined && !(acc[k]! <= v)) acc[k] = v;
  };
  keep("now", priceOn(normal, today));
  keep("was7", priceOn(normal, daysBefore(today, 7)));
  keep("was30", priceOn(normal, daysBefore(today, 30)));
}

export function trendOf(acc: TrendAcc): PriceTrend | undefined {
  if (acc.now === undefined) return undefined;
  const out: PriceTrend = {};
  const share = (was: number) => Math.round(((acc.now! - was) / was) * 1000) / 1000;
  if (acc.was7) Object.assign(out, { d7: share(acc.was7), was7: round(acc.was7) });
  if (acc.was30) Object.assign(out, { d30: share(acc.was30), was30: round(acc.was30) });
  return Object.keys(out).length ? out : undefined;
}

/** cardIdentifiers.csv: header, then plain comma-separated ids (no quoting needed; quotes are stripped anyway). */
export function identifierColumns(header: string) {
  const cols = header.split(",").map((c) => c.replace(/"/g, "").trim());
  const at = (name: string) => {
    const i = cols.indexOf(name);
    if (i < 0) throw new Error(`cardIdentifiers.csv has no ${name} column`);
    return i;
  };
  return { uuid: at("uuid"), scryfall: at("scryfallId"), oracle: at("scryfallOracleId") };
}
