import { describe, expect, it } from "vitest";
import { csvFields, mergeImported, ownedState, parseCollection, unownedPrice } from "./collection";
import type { CardSummary } from "./model";

describe("collection", () => {
  it("splits CSV with quoted commas", () => {
    expect(csvFields('"4","Jace, the Mind Sculptor",foil')).toEqual(["4", "Jace, the Mind Sculptor", "foil"]);
    expect(csvFields('1,"Say ""hi""",x')).toEqual(["1", 'Say "hi"', "x"]);
  });

  it("reads a Moxfield collection export", () => {
    const csv =
      '"Count","Tradelist Count","Name","Edition","Condition","Language","Foil"\n"2","0","Sol Ring","cmr","Near Mint","English",""\n"1","0","Jace, the Mind Sculptor","2xm","Near Mint","English","foil"';
    expect(parseCollection(csv).cards).toEqual([
      { name: "Sol Ring", quantity: 2, foil: false, scryfallId: undefined },
      { name: "Jace, the Mind Sculptor", quantity: 1, foil: true, scryfallId: undefined },
    ]);
  });

  it("reads ManaBox and Archidekt columns", () => {
    const manabox = "Name,Set code,Foil,Quantity,Scryfall ID\nForest,m21,normal,10,abc\nOpt,xln,foil,2,def";
    expect(parseCollection(manabox).cards.map((c) => [c.name, c.quantity, c.foil, c.scryfallId])).toEqual([
      ["Forest", 10, false, "abc"],
      ["Opt", 2, true, "def"],
    ]);
    expect(parseCollection("Quantity,Name,Finish\n3,Island,Etched").cards[0]).toMatchObject({ quantity: 3, foil: true });
  });

  it("reads a plain list and counts what it skipped", () => {
    expect(parseCollection("4 Lightning Bolt\n1x Sol Ring (CMR) 472 *F*\nnot a card")).toEqual({
      cards: [
        { name: "Lightning Bolt", quantity: 4, foil: false },
        { name: "Sol Ring", quantity: 1, foil: true },
      ],
      skipped: 1,
    });
  });

  it("adds up printings of the same card", () => {
    const m = mergeImported([
      { oracleId: "a", quantity: 2, foil: false },
      { oracleId: "a", quantity: 1, foil: true },
      { oracleId: "a", quantity: 1, foil: false },
    ]);
    expect(m.get("a")).toEqual({ quantity: 3, foil_quantity: 1 });
  });

  it("knows what a deck still needs, skipping basics", () => {
    const c = new Map([["a", { quantity: 1, foil_quantity: 0 }]]);
    const card = (id: string, price: number, type_line = "Artifact") => ({ oracle_id: id, price_usd: price, type_line }) as CardSummary;
    expect(ownedState(c, { quantity: 2, card: card("a", 5) })).toBe("some");
    expect(ownedState(c, { quantity: 1, card: card("a", 5) })).toBe("all");
    expect(
      unownedPrice(c, [
        { quantity: 2, card: card("a", 5) },
        { quantity: 1, card: card("b", 3) },
        { quantity: 9, card: card("f", 1, "Basic Land — Forest") },
      ]),
    ).toBe(8);
  });
});
