import { describe, expect, it } from "vitest";
import { historyLine, priceCard, priceFrom, pricePrinting, readPriceSource, storeList, trendMark, trendText } from "./store-prices";
import { addToTrend, cheapestStores, daysBefore, identifierColumns, latest, printingStores, trendOf, type TrendAcc } from "../prices/mtgjson";
import { deckTotals } from "./deck-totals";
import type { CardSummary } from "./model";
import type { ChosenPrinting } from "./printing";

const stores = { ck: { n: 0.35, f: 0.49, bn: 0.1 }, mp: { n: 0.15, f: 0.19 }, cm: { n: 0.04, f: 0.2 } };

describe("priceFrom", () => {
  it("keeps TCGplayer as Scryfall's price", () => expect(priceFrom("tcgplayer", 0.24, stores, "n")).toBe(0.24));
  it("reads a store", () => {
    expect(priceFrom("cardkingdom", 0.24, stores, "n")).toBe(0.35);
    expect(priceFrom("manapool", 0.24, stores, "f")).toBe(0.19);
  });
  it("falls back to TCGplayer when the store has no price", () => expect(priceFrom("cardkingdom", 0.24, {}, "n")).toBe(0.24));
  it("cheapest skips Cardmarket's euros", () => expect(priceFrom("cheapest", 0.24, stores, "n")).toBe(0.15));
  it("etched falls back to foil", () => expect(priceFrom("cardkingdom", null, stores, "e")).toBe(0.49));
  it("reads an unknown setting as TCGplayer", () => expect(readPriceSource({ priceSource: "ebay" })).toBe("tcgplayer"));
});

describe("cards and printings", () => {
  const card = { oracle_id: "a", price_usd: 0.24, store_prices: stores } as CardSummary;
  it("replaces price_usd and keeps the TCGplayer price", () => {
    expect(priceCard(card, "cardkingdom")).toMatchObject({ price_usd: 0.35, tcg_usd: 0.24 });
    expect(priceCard(card, "tcgplayer")).toBe(card);
  });
  it("prices a printing by finish", () => {
    const p = { id: "p", usd: 1, usd_foil: 2, usd_etched: null, foil: true, finishes: ["nonfoil", "foil"], stores } as unknown as ChosenPrinting;
    expect(pricePrinting(p, "cardkingdom")).toMatchObject({ usd: 0.35, usd_foil: 0.49 });
  });
  it("lists stores, Cardmarket in euros, and Card Kingdom's buylist", () => {
    const { rows, buylist } = storeList(0.24, stores, false);
    expect(rows.map((r) => `${r.name} ${r.currency}${r.price}`)).toEqual(["TCGplayer $0.24", "Card Kingdom $0.35", "Mana Pool $0.15", "Cardmarket €0.04"]);
    expect(buylist).toBe(0.1);
  });
});

describe("trend", () => {
  it("marks a real move only", () => {
    expect(trendMark({ d30: 0.5, was30: 4 })).toMatchObject({ up: true });
    expect(trendMark({ d30: 1, was30: 0.1 })).toBeNull(); // 10 cents doubling stays quiet
    expect(trendMark({ d30: 0.1, was30: 20 })).toBeNull();
    expect(trendText(-0.25)).toBe("↓ 25% in 30 days");
  });
  it("builds the cheapest TCGplayer price on three days", () => {
    const acc: TrendAcc = {};
    const day = "2026-11-11";
    addToTrend(acc, { paper: { tcgplayer: { retail: { normal: { [day]: 6, [daysBefore(day, 7)]: 5, [daysBefore(day, 30)]: 4 } } } } }, day);
    addToTrend(acc, { paper: { tcgplayer: { retail: { normal: { [day]: 8, [daysBefore(day, 31)]: 2 } } } } }, day); // a missing day reads the day before
    expect(acc).toEqual({ now: 6, was7: 5, was30: 2 });
    expect(trendOf(acc)).toEqual({ d7: 0.2, was7: 5, d30: 2, was30: 2 });
  });
});

describe("MTGJSON files", () => {
  it("reads a printing's stores and drops TCGplayer and buylists elsewhere", () => {
    const day = "2026-11-11";
    const card = {
      paper: {
        tcgplayer: { retail: { normal: { [day]: 0.24 } } },
        cardkingdom: { retail: { normal: { [day]: 0.35 } }, buylist: { normal: { [day]: 0.1 } } },
        cardmarket: { retail: { foil: { [day]: 0.2 } }, buylist: { normal: { [day]: 0.01 } } },
      },
    };
    expect(printingStores(card)).toEqual({ ck: { n: 0.35, bn: 0.1 }, cm: { f: 0.2 } });
    expect(printingStores({ paper: { tcgplayer: { retail: { normal: { [day]: 1 } } } } })).toBeUndefined();
    expect(latest({ "2026-11-10": 1, "2026-11-11": 2.004 })).toBe(2);
  });
  it("keeps the cheapest retail across printings and no buylist", () => {
    expect(cheapestStores([{ ck: { n: 2, bn: 2020 } }, { ck: { n: 1, bn: 0.2 }, mp: { n: 3 } }, { cm: { bn: 5 } }, undefined])).toEqual({ ck: { n: 1 }, mp: { n: 3 } });
  });
  it("finds the identifier columns", () => expect(identifierColumns("uuid,scryfallId,scryfallOracleId,x")).toEqual({ uuid: 0, scryfall: 1, oracle: 2 }));
});

describe("deck totals and history", () => {
  it("adds up every source like the deck page", () => {
    const cards = {
      a: { oracle_id: "a", price_usd: 1, store_prices: { ck: { n: 2 }, mp: { n: 0.5 } } },
      b: { oracle_id: "b", price_usd: 3, store_prices: null },
    } as unknown as Record<string, CardSummary>;
    expect(deckTotals({ "commander|a": 1, "main|b": 2, "maybe|a": 4 }, cards, {}, {}, {})).toEqual({ t: 7, ck: 8, mp: 6.5, min: 6.5 });
  });
  it("reads one source's line, oldest first", () => {
    const rows: { day: string; totals: Record<string, number> }[] = [{ day: "2026-11-12", totals: { t: 2, ck: 3 } }, { day: "2026-11-11", totals: { t: 1 } }];
    expect(historyLine(rows, "tcgplayer")).toEqual([{ day: "2026-11-11", total: 1 }, { day: "2026-11-12", total: 2 }]);
    expect(historyLine(rows, "cardkingdom")).toEqual([{ day: "2026-11-12", total: 3 }]);
  });
});
