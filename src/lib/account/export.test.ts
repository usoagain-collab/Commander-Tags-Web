import { describe, expect, it } from "vitest";
import { cardLine, formatExport } from "./export";

describe("cardLine", () => {
  it("writes the import format", () => {
    expect(cardLine({ quantity: 1, name: "Sol Ring" })).toBe("1 Sol Ring");
    expect(cardLine({ quantity: 2, name: "Forest", set: "neo", number: "292", foil: true })).toBe("2 Forest (NEO) 292 *F*");
    expect(cardLine({ quantity: 1, name: "Atraxa", set: "one", number: "1", foil: true, etched: true })).toBe("1 Atraxa (ONE) 1 *E*");
  });
});

describe("formatExport", () => {
  it("lists every section, decks by board", () => {
    const text = formatExport(
      {
        name: "David",
        email: "d@example.com",
        joined: "2026-10-18T00:00:00Z",
        decks: [
          {
            name: "Omo",
            visibility: "private",
            bracket: 3,
            created: "2026-10-18T00:00:00Z",
            updated: "2026-11-01T00:00:00Z",
            boards: { main: [{ quantity: 1, name: "Sol Ring" }], commander: [{ quantity: 1, name: "Omo, Queen of Vesuva" }] },
          },
        ],
        myTags: [{ name: "Pet cards", scope: "all decks", cards: ["Sol Ring"] }],
        wishlist: [{ quantity: 1, name: "Mana Crypt", note: "someday" }],
        collection: [{ quantity: 4, name: "Forest" }],
      },
      new Date("2026-11-09T00:00:00Z"),
    );
    expect(text).toContain("Downloaded 2026-11-09");
    expect(text).toContain("--- Omo ---");
    expect(text.indexOf("Commander\n1 Omo")).toBeLessThan(text.indexOf("Deck\n1 Sol Ring"));
    expect(text).toContain("Pet cards (all decks): Sol Ring");
    expect(text).toContain("1 Mana Crypt (note: someday)");
    expect(text).toContain("4 cards in your collection");
  });
  it("says when sections are empty", () => {
    const text = formatExport({ name: null, email: null, joined: null, decks: [], myTags: [], wishlist: [], collection: [] });
    expect(text).toContain("No decks.");
    expect(text).toContain("Empty.");
  });
});
