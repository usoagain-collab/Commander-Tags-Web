import { describe, expect, it } from "vitest";
import type { OwnedRow, PrintingInfo } from "./collection";
import { collectionItems, collectionSections, matchesQuery, readCollectionPrefs, sortItems } from "./collection-view";
import type { CardSummary } from "./model";

const card = (oracle_id: string, name: string, type_line = "Artifact", color_identity: string[] = [], price_usd = 1) =>
  ({ oracle_id, name, type_line, color_identity, price_usd, image_normal: `img-${oracle_id}` }) as CardSummary;
const info = (set: string, number: string, usd: number, set_name = set.toUpperCase() + " set"): PrintingInfo => ({
  set,
  set_name,
  number,
  illustration_id: null,
  finishes: ["nonfoil", "foil"],
  usd,
  usd_foil: usd * 2,
  usd_etched: null,
});
const row = (oracle_id: string, printing_id: string | null, quantity: number, p: PrintingInfo | null, finish: OwnedRow["finish"] = "nonfoil", added_at = "2026-01-01"): OwnedRow => ({
  oracle_id,
  printing_id,
  finish,
  quantity,
  printing_info: p,
  added_at,
});

const cards = { a: card("a", "Sol Ring"), b: card("b", "Forest", "Basic Land — Forest", ["G"], 0.1), c: card("c", "Opt", "Instant", ["U"]) };
const rows = [
  row("a", "a1", 2, info("cmr", "472", 2)),
  row("a", "a2", 1, info("c21", "263", 5), "foil", "2026-03-01"),
  row("a", null, 1, null),
  row("b", "b1", 10, info("m21", "280", 0.1)),
  row("c", "c1", 1, info("xln", "65", 0.2)),
];

describe("collection view", () => {
  it("shows each printing, or one item per card", () => {
    const each = collectionItems(rows, cards, false);
    expect(each).toHaveLength(5);
    expect(each[1]).toMatchObject({ label: "C21 #263 · foil", unitPrice: 10, value: 10, image: "https://cards.scryfall.io/normal/front/a/2/a2.jpg", foil: true });
    expect(each[2]).toMatchObject({ label: "Printing unknown", image: "img-a", unitPrice: 1 });
    const sol = collectionItems(rows, cards, true).find((i) => i.card.oracle_id === "a")!;
    expect(sol).toMatchObject({ quantity: 4, label: "3 printings", unitPrice: 10, value: 2 * 2 + 10 + 1, foil: false, added: "2026-03-01" });
    expect(sol.image).toContain("a1"); // the printing you own most of
  });

  it("filters foil and unknown printings", () => {
    expect(collectionItems(rows, cards, false, "foil").map((i) => i.key)).toEqual(["a|a2|foil"]);
    expect(collectionItems(rows, cards, false, "unknown").map((i) => i.key)).toEqual(["a||nonfoil"]);
  });

  it("finds cards by name, set code or set name", () => {
    const items = collectionItems(rows, cards, false);
    expect(items.filter((i) => matchesQuery(i, "ring"))).toHaveLength(3);
    expect(items.filter((i) => matchesQuery(i, "XLN")).map((i) => i.card.name)).toEqual(["Opt"]);
    expect(items.filter((i) => matchesQuery(i, "m21 set")).map((i) => i.card.name)).toEqual(["Forest"]);
  });

  it("sorts by set and number, price and newest", () => {
    const items = collectionItems(rows, cards, false);
    expect(sortItems(items, "set").map((i) => i.label)).toEqual(["C21 #263 · foil", "CMR #472", "M21 #280", "XLN #65", "Printing unknown"]);
    expect(sortItems(items, "price")[0].label).toBe("C21 #263 · foil");
    expect(sortItems(items, "added")[0].label).toBe("C21 #263 · foil");
  });

  it("groups by set (unknown last), type and color", () => {
    const each = collectionItems(rows, cards, false);
    expect(collectionSections(each, "set", "name").map((s) => s.title)).toEqual(["C21 set (C21)", "CMR set (CMR)", "M21 set (M21)", "XLN set (XLN)", "Printing unknown"]);
    // A whole card shows under each set it has.
    const perCard = collectionItems(rows, cards, true);
    expect(collectionSections(perCard, "set", "name").find((s) => s.key === "?")!.items.map((i) => i.card.name)).toEqual(["Sol Ring"]);
    expect(collectionSections(each, "type", "name").map((s) => s.title)).toEqual(["Artifact", "Instant", "Land"]);
    expect(collectionSections(each, "color", "name").map((s) => [s.title, s.count])).toEqual([
      ["Blue", 1],
      ["Colorless", 4],
      ["Lands", 10],
    ]);
  });

  it("reads saved preferences", () => {
    expect(readCollectionPrefs(undefined)).toEqual({ view: "grid", group: "none", sort: "name", perCard: false });
    expect(readCollectionPrefs({ view: "stacks", group: "set", sort: "bogus", perCard: true })).toEqual({ view: "stacks", group: "set", sort: "name", perCard: true });
  });
});
