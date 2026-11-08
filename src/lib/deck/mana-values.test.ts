import { describe, expect, it } from "vitest";
import { applyManaValues, readManaValues, withManaValue } from "./mana-values";
import type { CardSummary } from "./model";

const card = (id: string, mv: number) => ({ oracle_id: id, name: id, mana_value: mv }) as CardSummary;

describe("change mana cost", () => {
  it("reads whole numbers 0-20 and drops junk", () => {
    expect(readManaValues({ a: 3.4, b: "x", c: 99, d: -1 })).toEqual({ a: 3, c: 20, d: 0 });
    expect(readManaValues(null)).toEqual({});
  });
  it("swaps in the counted mana value and leaves other cards alone", () => {
    const cards = { a: card("a", 1), b: card("b", 2) };
    const out = applyManaValues(cards, { a: 5, z: 3 });
    expect(out.a.mana_value).toBe(5);
    expect(out.b).toBe(cards.b);
    expect(applyManaValues(cards, {})).toBe(cards);
  });
  it("clears an override set back to the card's own value", () => {
    expect(withManaValue({}, "a", 4, 1)).toEqual({ a: 4 });
    expect(withManaValue({ a: 4 }, "a", 1, 1)).toEqual({});
    expect(withManaValue({ a: 4 }, "a", null, 1)).toEqual({});
  });
});
