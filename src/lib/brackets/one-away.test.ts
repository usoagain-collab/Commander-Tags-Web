import { describe, expect, it } from "vitest";
import type { ComboRow } from "./evaluate";
import { combosOneAway } from "./one-away";

const combo = (id: string, card_a: string, card_b: string, popularity: number | null = 10, requires = 0): ComboRow => ({
  id,
  card_a,
  card_b,
  results: ["Infinite mana"],
  bracket_tag: "S",
  requires,
  popularity,
});

describe("combosOneAway", () => {
  const deck = new Set(["altar", "gravecrawler", "oracle"]);
  const any = () => true;

  it("lists combos where the deck has exactly one card, grouped by the missing card", () => {
    const groups = combosOneAway(
      [combo("1", "altar", "pit", 50), combo("2", "gravecrawler", "pit", 90), combo("3", "consult", "oracle", 70), combo("4", "altar", "gravecrawler")],
      deck,
      any,
    );
    expect(groups.map((g) => g.missing)).toEqual(["pit", "consult"]); // pit finishes two combos, so it comes first
    expect(groups[0].combos.map((c) => c.have)).toEqual(["gravecrawler", "altar"]); // most played combo first
    expect(groups[0].popularity).toBe(90);
  });

  it("skips combos that need an extra piece, missing cards that aren't allowed, repeats and pairs with neither card", () => {
    const groups = combosOneAway(
      [combo("1", "altar", "pit", 5, 1), combo("2", "oracle", "red-card"), combo("3", "nobody", "else"), combo("5", "consult", "oracle"), combo("5", "consult", "oracle")],
      deck,
      (id) => id !== "red-card",
    );
    expect(groups).toEqual([{ missing: "consult", combos: [{ combo: combo("5", "consult", "oracle"), have: "oracle" }], popularity: 10 }]);
  });

  it("keeps the most useful few", () => {
    const rows = Array.from({ length: 20 }, (_, i) => combo(String(i), "altar", `card${String(i).padStart(2, "0")}`, i));
    expect(combosOneAway(rows, deck, any, 3).map((g) => g.missing)).toEqual(["card19", "card18", "card17"]);
  });
});
