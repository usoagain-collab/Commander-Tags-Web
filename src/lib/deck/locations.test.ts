import { describe, expect, it } from "vitest";
import type { OwnedRow } from "./collection";
import { ownedMatch, groupRows } from "./collection";
import { collectionItems } from "./collection-view";
import { binderPages, copiesByLocation, defaultStyle, deltaChanges, locationNameProblem, planMove, planMoveAll, readLocations, readLocationStyle, rowsIn } from "./locations";
import type { CardSummary } from "./model";

const A = "11111111-1111-1111-1111-111111111111";
const P = "22222222-2222-2222-2222-222222222222";
const BLUE = "33333333-3333-3333-3333-333333333333";
const TRADE = "44444444-4444-4444-4444-444444444444";
const row = (over: Partial<OwnedRow>): OwnedRow => ({ oracle_id: A, printing_id: P, finish: "nonfoil", quantity: 1, printing_info: null, location_id: null, ...over });

describe("readLocationStyle", () => {
  it("fills defaults and drops broken values", () => {
    const s = readLocationStyle({ color: "red", layout: "pages", pockets: "9x9", note: "x".repeat(200), cover: { oracle_id: "nope" } }, "box");
    expect(s.color).toBe(defaultStyle("box").color);
    expect(s.layout).toBe("pages");
    expect(s.pockets).toBe("3x3");
    expect(s.note).toHaveLength(80);
    expect(s.cover).toBeNull();
  });
  it("keeps a good cover", () => {
    expect(readLocationStyle({ cover: { oracle_id: A, printing_id: P, artist: "Mark Tedin" } }).cover).toEqual({ oracle_id: A, printing_id: P, image_v: null, artist: "Mark Tedin" });
  });
  it("binders start on binder pages, boxes on the grid", () => {
    expect(defaultStyle("binder").layout).toBe("pages");
    expect(defaultStyle("box").layout).toBe("grid");
  });
});

describe("readLocations", () => {
  it("orders by sort then name and skips junk", () => {
    const l = readLocations([{ id: "b", name: "Zed", kind: "box", sort: 1 }, { id: "a", name: "Alpha", kind: "weird", sort: 1 }, { name: "no id" }]);
    expect(l.map((x) => x.name)).toEqual(["Alpha", "Zed"]);
    expect(l[0].kind).toBe("other");
  });
});

describe("locationNameProblem", () => {
  const others = readLocations([{ id: "a", name: "Blue binder", kind: "binder", sort: 1 }]);
  it("refuses duplicates ignoring case, empty and reserved names", () => {
    expect(locationNameProblem(" blue BINDER ", others)).toMatch(/already/);
    expect(locationNameProblem("blue binder", others, "a")).toBeNull();
    expect(locationNameProblem("  ", others)).toMatch(/name/);
    expect(locationNameProblem("Unsorted", others)).toMatch(/taken/);
  });
});

describe("rows by location", () => {
  const rows = [row({ quantity: 3, location_id: BLUE }), row({ quantity: 1, location_id: TRADE }), row({ quantity: 2 })];
  it("filters and counts", () => {
    expect(rowsIn(rows, "all")).toHaveLength(3);
    expect(rowsIn(rows, "unsorted").map((r) => r.quantity)).toEqual([2]);
    expect(rowsIn(rows, BLUE).map((r) => r.quantity)).toEqual([3]);
    expect(copiesByLocation(rows)).toEqual(new Map([[BLUE, 3], [TRADE, 1], ["", 2]]));
  });
  it("decks still count every copy", () => {
    expect(ownedMatch(groupRows(rows), A, [{ printingId: P, foil: false, quantity: 4 }])).toEqual({ have: 6, exact: 4, need: 4 });
  });
  it("the page shows one item per printing across binders", () => {
    const card = { oracle_id: A, name: "Sol Ring", price_usd: 1, image_normal: null } as unknown as CardSummary;
    const items = collectionItems(rows, { [A]: card }, false);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(6);
  });
});

describe("planMove", () => {
  const rows = [row({ quantity: 3, location_id: BLUE }), row({ quantity: 1, location_id: TRADE })];
  it("shrinks the source and grows the row already there", () => {
    expect(planMove(rows, rows[0], TRADE, 2)).toEqual([
      { target: rows[0], quantity: 1 },
      { target: { ...rows[0], location_id: TRADE }, quantity: 3 },
    ]);
  });
  it("moves everything to Unsorted by default, and nothing onto itself", () => {
    expect(planMove(rows, rows[1], null).map((c) => c.quantity)).toEqual([0, 1]);
    expect(planMove(rows, rows[1], TRADE)).toEqual([]);
  });
});

describe("deltaChanges", () => {
  const rows = [row({ quantity: 3, location_id: BLUE }), row({ quantity: 1 })];
  const t = { oracle_id: A, printing_id: P, finish: "nonfoil" as const, printing_info: null };
  it("adds into the given location", () => {
    expect(deltaChanges(rows, t, 2, BLUE)).toEqual([{ target: { ...t, location_id: BLUE }, quantity: 5 }]);
    expect(deltaChanges(rows, t, 1, null)).toEqual([{ target: { ...t, location_id: null }, quantity: 2 }]);
  });
  it("removes from Unsorted first when no location is named", () => {
    expect(deltaChanges(rows, t, -2, undefined).map((c) => [c.target.location_id, c.quantity])).toEqual([
      [null, 0],
      [BLUE, 2],
    ]);
  });
  it("removes only from the named location", () => {
    expect(deltaChanges(rows, t, -5, BLUE).map((c) => c.quantity)).toEqual([0]);
  });
});

describe("binderPages", () => {
  it("splits into pockets per page and always has one page", () => {
    expect(binderPages([1, 2, 3, 4, 5], "2x2")).toEqual([[1, 2, 3, 4], [5]]);
    expect(binderPages([], "3x3")).toEqual([[]]);
  });
});

describe("planMoveAll", () => {
  const base = { oracle_id: A, printing_id: P, finish: "nonfoil" as const, printing_info: null };
  it("empties each source and adds up copies at the destination", () => {
    const a = { ...base, quantity: 2, location_id: "A" };
    const b = { ...base, quantity: 3, location_id: "B" };
    const c = { ...base, quantity: 1, location_id: "C" };
    const plan = planMoveAll([a, b, c], [a, b, c], "C");
    expect(plan).toHaveLength(3);
    expect(plan.find((p) => p.target.location_id === "A")?.quantity).toBe(0);
    expect(plan.find((p) => p.target.location_id === "B")?.quantity).toBe(0);
    expect(plan.find((p) => p.target.location_id === "C")?.quantity).toBe(6);
  });
  it("moves to Unsorted and skips rows already there", () => {
    const a = { ...base, quantity: 2, location_id: "A" };
    const u = { ...base, quantity: 1, location_id: null };
    const plan = planMoveAll([a, u], [a, u], null);
    expect(plan).toEqual([
      { target: a, quantity: 0 },
      { target: { ...a, location_id: null }, quantity: 3 },
    ]);
  });
  it("does nothing when everything is already there", () => {
    const a = { ...base, quantity: 2, location_id: "A" };
    expect(planMoveAll([a], [a], "A")).toEqual([]);
  });
});
