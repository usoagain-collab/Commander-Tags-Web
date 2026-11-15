import { describe, expect, it } from "vitest";
import { guestSavePayload, guestSnapshot, readGuestDeck } from "./guest-deck";
import type { CardSummary } from "./model";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const card = (id: string) => ({ oracle_id: id, name: id === A ? "Sol Ring" : "Atraxa" }) as CardSummary;

describe("guest deck", () => {
  it("reads back what it wrote", () => {
    const deck = guestSnapshot("Test", { [`main|${A}`]: 1, [`commander|${B}`]: 1 }, { [`main|${A}`]: "ramp" }, {}, { [A]: card(A), [B]: card(B) });
    expect(readGuestDeck(JSON.stringify(deck))).toEqual(deck);
  });

  it("drops bad rows and anything that isn't a deck", () => {
    expect(readGuestDeck(null).entries).toEqual({});
    expect(readGuestDeck("not json").entries).toEqual({});
    expect(readGuestDeck(JSON.stringify({ v: 2, entries: { [`main|${A}`]: 1 } })).entries).toEqual({});
    const raw = JSON.stringify({
      v: 1,
      name: "  ",
      entries: { [`main|${A}`]: 1, "main|nope": 1, [`side|${A}`]: 1, [`maybe|${B}`]: 500 },
      categories: { [`main|${A}`]: "ramp", [`main|${B}`]: "draw" },
      printings: { [`main|${A}`]: { id: "bad" } },
      cards: { [A]: card(A), [B]: card(B) },
    });
    const deck = readGuestDeck(raw);
    expect(deck.entries).toEqual({ [`main|${A}`]: 1 });
    expect(deck.categories).toEqual({ [`main|${A}`]: "ramp" });
    expect(deck.printings).toEqual({});
    expect(Object.keys(deck.cards)).toEqual([A]);
    expect(deck.name).toBe("My first deck");
  });

  it("keeps card details only for cards still in the deck", () => {
    expect(Object.keys(guestSnapshot("x", { [`main|${A}`]: 1 }, {}, {}, { [A]: card(A), [B]: card(B) }).cards)).toEqual([A]);
  });

  it("turns the deck into one save call", () => {
    const p = guestSavePayload(guestSnapshot("x", { [`main|${A}`]: 2, [`commander|${B}`]: 1 }, { [`main|${A}`]: "ramp" }, {}, {}));
    expect(p.rows).toEqual([
      { oracle_id: A, board: "main", quantity: 2 },
      { oracle_id: B, board: "commander", quantity: 1 },
    ]);
    expect(p.categories).toEqual([{ oracle_id: A, board: "main", category: "ramp" }]);
    expect(p.printings).toEqual([]);
  });
});
