import { describe, expect, it } from "vitest";
import {
  csvFields,
  exportCollectionCsv,
  groupRows,
  mergeImported,
  ownedMatch,
  ownedState,
  parseCollection,
  rowUnitPrice,
  unownedPrice,
  type OwnedRow,
} from "./collection";
import type { CardSummary } from "./model";

const row = (oracle_id: string, printing_id: string | null, quantity: number, finish: OwnedRow["finish"] = "nonfoil"): OwnedRow => ({
  oracle_id,
  printing_id,
  finish,
  quantity,
  printing_info: null,
});

describe("collection", () => {
  it("splits CSV with quoted commas", () => {
    expect(csvFields('"4","Jace, the Mind Sculptor",foil')).toEqual(["4", "Jace, the Mind Sculptor", "foil"]);
    expect(csvFields('1,"Say ""hi""",x')).toEqual(["1", 'Say "hi"', "x"]);
  });

  it("reads a Moxfield collection export with its printings", () => {
    const csv =
      '"Count","Tradelist Count","Name","Edition","Condition","Language","Foil","Tags","Last Modified","Collector Number"\n' +
      '"2","0","Sol Ring","cmr","Near Mint","English","","","2026-01-01","472"\n' +
      '"1","0","Jace, the Mind Sculptor","2xm","Near Mint","English","foil","","2026-01-01","50"\n' +
      '"1","0","Sol Ring","c21","Near Mint","English","etched","","2026-01-01","263"';
    expect(parseCollection(csv).cards).toEqual([
      { name: "Sol Ring", quantity: 2, finish: "nonfoil", set: "cmr", number: "472" },
      { name: "Jace, the Mind Sculptor", quantity: 1, finish: "foil", set: "2xm", number: "50" },
      { name: "Sol Ring", quantity: 1, finish: "etched", set: "c21", number: "263" },
    ]);
  });

  it("reads ManaBox and Archidekt columns, and ignores set names", () => {
    const id = "0afa0e33-4804-4b00-b625-c2d6b61090fc";
    const manabox = `Name,Set code,Collector number,Foil,Quantity,Scryfall ID\nForest,m21,280,normal,10,${id}\nOpt,xln,65,foil,2,not-an-id`;
    expect(parseCollection(manabox).cards).toEqual([
      { name: "Forest", quantity: 10, finish: "nonfoil", scryfallId: id, set: "m21", number: "280" },
      { name: "Opt", quantity: 2, finish: "foil", set: "xln", number: "65" },
    ]);
    expect(parseCollection("Quantity,Name,Finish\n3,Island,Etched").cards[0]).toMatchObject({ quantity: 3, finish: "etched" });
    expect(parseCollection("Count,Name,Edition,Card Number\n1,Opt,Ixalan,65").cards[0].set).toBeUndefined();
  });

  it("reads a plain list and counts what it skipped", () => {
    expect(parseCollection("4 Lightning Bolt\n1x Sol Ring (CMR) 472 *F*\n2 Opt (XLN)\nnot a card")).toEqual({
      cards: [
        { name: "Lightning Bolt", quantity: 4, finish: "nonfoil" },
        { name: "Sol Ring", quantity: 1, finish: "foil", set: "cmr", number: "472" },
        { name: "Opt", quantity: 2, finish: "nonfoil" },
      ],
      skipped: 1,
    });
  });

  it("adds up copies of the same printing and finish only", () => {
    const m = mergeImported([row("a", "p1", 2), row("a", "p1", 1, "foil"), row("a", "p1", 1), row("a", null, 3)]);
    expect(m.map((r) => [r.printing_id, r.finish, r.quantity])).toEqual([
      ["p1", "nonfoil", 3],
      ["p1", "foil", 1],
      [null, "nonfoil", 3],
    ]);
  });

  it("tells the exact printing from another one", () => {
    const c = groupRows([row("a", "p1", 1), row("a", "p2", 1), row("a", null, 1), row("b", "p9", 1, "etched")]);
    const want = (printingId: string | null, quantity: number, foil = false) => [{ printingId, foil, quantity }];
    expect(ownedState(ownedMatch(c, "a", want("p1", 1)))).toBe("exact");
    expect(ownedState(ownedMatch(c, "a", want("p1", 3)))).toBe("other");
    expect(ownedState(ownedMatch(c, "a", want("p3", 1)))).toBe("other");
    expect(ownedState(ownedMatch(c, "a", want("p1", 1, true)))).toBe("other"); // foil wanted, plain owned
    expect(ownedState(ownedMatch(c, "a", want("p1", 4)))).toBe("some");
    expect(ownedState(ownedMatch(c, "z", want("p1", 1)))).toBe("none");
    expect(ownedState(ownedMatch(c, "b", want("p9", 1, true)))).toBe("exact"); // etched counts as foil
    // Mixed copies: both printings wanted, both owned.
    expect(ownedMatch(c, "a", [...want("p1", 1), ...want("p2", 1)])).toEqual({ have: 3, exact: 2, need: 2 });
    // A foil-only printing matches a row that never asked for foil (Maze's End, Foundations).
    const fdn = { set: "fdn", set_name: "Foundations", number: "1", illustration_id: null, finishes: ["foil"], usd: null, usd_foil: 1, usd_etched: null };
    expect(ownedState(ownedMatch(groupRows([{ ...row("m", "f1", 1, "foil"), printing_info: fdn }]), "m", want("f1", 1)))).toBe("exact");
    // Two parts of the same printing can't both claim one owned copy.
    expect(ownedMatch(c, "a", [...want("p1", 1), ...want("p1", 1)]).exact).toBe(1);
  });

  it("knows what a deck still needs, skipping basics", () => {
    const c = groupRows([row("a", "p1", 1)]);
    const card = (id: string, price: number, type_line = "Artifact") => ({ oracle_id: id, price_usd: price, type_line }) as CardSummary;
    expect(
      unownedPrice(c, [
        { quantity: 2, card: card("a", 5) },
        { quantity: 1, card: card("b", 3) },
        { quantity: 9, card: card("f", 1, "Basic Land — Forest") },
      ]),
    ).toBe(8);
  });

  it("prices a row by its own printing and finish", () => {
    const info = { set: "cmr", set_name: "Commander Legends", number: "472", illustration_id: null, finishes: ["nonfoil", "foil"], usd: 1, usd_foil: 4, usd_etched: null };
    expect(rowUnitPrice({ ...row("a", "p", 1), printing_info: info }, 9)).toBe(1);
    expect(rowUnitPrice({ ...row("a", "p", 1, "foil"), printing_info: info }, 9)).toBe(4);
    expect(rowUnitPrice(row("a", null, 1), 9)).toBe(9);
  });

  it("exports a CSV that names each printing", () => {
    const info = { set: "cmr", set_name: "Commander Legends", number: "472", illustration_id: null, finishes: ["foil"], usd: null, usd_foil: 4, usd_etched: null };
    const csv = exportCollectionCsv([{ ...row("a", "p", 2, "foil"), printing_info: info }, row("a", null, 1)], () => "Sol Ring");
    expect(csv.split("\n")).toEqual(["Count,Name,Edition,Collector Number,Foil", '2,"Sol Ring",cmr,"472",foil', '1,"Sol Ring",,,']);
    expect(parseCollection(csv).cards[0]).toMatchObject({ quantity: 2, finish: "foil", set: "cmr", number: "472" });
  });
});
