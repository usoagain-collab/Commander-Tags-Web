import { describe, expect, it } from "vitest";
import type { CardSummary, DeckLine } from "./model";
import type { ChosenPrinting } from "./printing";
import { artCount, expandLines, readSplit, rowPrice, splitParts } from "./splits";

const print = (id: string, usd: number, foil = false): ChosenPrinting => ({
  id,
  set: "abc",
  set_name: "ABC",
  number: id,
  illustration_id: null,
  finishes: ["nonfoil", "foil"],
  usd,
  usd_foil: usd * 3,
  usd_etched: null,
  foil,
});
const forest = { oracle_id: "f", name: "Forest", price_usd: 0.1, type_line: "Basic Land — Forest" } as CardSummary;

describe("mixed copies", () => {
  it("reads only parts with a printing and copies", () => {
    expect(readSplit([{ printing: print("1", 1), quantity: 2 }, { printing: null, quantity: 3 }, { printing: print("2", 1), quantity: 0 }])).toHaveLength(1);
    expect(readSplit("x")).toBeNull();
    expect(readSplit([])).toBeNull();
  });

  it("puts split copies first and the rest in the row's printing, never more than the row holds", () => {
    const split = [
      { printing: print("1", 1), quantity: 3 },
      { printing: print("2", 2), quantity: 5 },
    ];
    expect(splitParts(10, undefined, split).map((p) => [p.printing?.id ?? "default", p.quantity])).toEqual([
      ["1", 3],
      ["2", 5],
      ["default", 2],
    ]);
    expect(splitParts(4, undefined, split).map((p) => [p.printing?.id, p.quantity])).toEqual([
      ["1", 3],
      ["2", 1],
    ]);
  });

  it("prices each copy at its own printing, foil included", () => {
    const split = [{ printing: print("1", 1, true), quantity: 2 }];
    expect(rowPrice(forest, 5, undefined, split)).toBeCloseTo(2 * 3 + 3 * 0.1);
  });

  it("breaks a mixed row into one export line per printing", () => {
    const line: DeckLine = { board: "main", quantity: 5, card: forest };
    const out = expandLines([line], { "main|f": [{ printing: print("9", 1), quantity: 2 }] }, { f: forest });
    expect(out.map((l) => [l.quantity, l.printing?.number ?? null])).toEqual([
      [2, "9"],
      [3, null],
    ]);
    expect(artCount(5, undefined, [{ printing: print("9", 1), quantity: 2 }])).toBe(2);
  });
});
