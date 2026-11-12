// A deck's price for every source (v2, Nov 11, 2026), the same way the deck page adds it up: chosen printings, then
// the owner's default printings, mixed copies priced copy by copy. Used by the nightly deck price history.
import { effectivePrintings, type CardSummary, type Entries, type Printings, type PreferredPrintings } from "./model";
import { totalPriceWithSplits, type Splits } from "./splits";
import { HISTORY_KEYS, PRICE_SOURCES, priceCards, pricePrinting, pricePrintings, type PriceSource } from "./store-prices";

export function priceSplits(splits: Splits, source: PriceSource): Splits {
  if (source === "tcgplayer") return splits;
  return Object.fromEntries(Object.entries(splits).map(([k, parts]) => [k, parts.map((p) => ({ ...p, printing: pricePrinting(p.printing, source) }))]));
}

export function deckTotal(entries: Entries, cards: Record<string, CardSummary>, printings: Printings, preferred: PreferredPrintings, splits: Splits, source: PriceSource) {
  const shown = effectivePrintings(entries, printings, preferred);
  return totalPriceWithSplits(entries, priceCards(cards, source), pricePrintings(shown, source), priceSplits(splits, source));
}

/** `deck_price_history.totals`: every source, rounded to cents. */
export function deckTotals(entries: Entries, cards: Record<string, CardSummary>, printings: Printings, preferred: PreferredPrintings, splits: Splits) {
  return Object.fromEntries(
    PRICE_SOURCES.map((s) => [HISTORY_KEYS[s.key], Math.round(deckTotal(entries, cards, printings, preferred, splits, s.key) * 100) / 100]),
  );
}
