import { describe, expect, it } from "vitest";
import { castableFaces, LAYOUT_SUPPORT, parseTypeLine, playableLandFaces } from "./cards";
import { intrinsicMana, manaValue, parseCost, payFromPool, planAutoPay, emptyPool } from "./mana";
import { SPECIAL_ACTIONS } from "./special";
import { step } from "./engine";
import { stacked } from "./test-helpers";
import { ADVENTURER, deckOf, FOREST, MDFC, ROOM, SPLIT, TRANSFORMER } from "./test-cards";

describe("printed card data", () => {
  it("reads type lines", () => {
    expect(parseTypeLine("Legendary Artifact Creature — Elf Druid")).toEqual({
      supertypes: ["Legendary"],
      types: ["Artifact", "Creature"],
      subtypes: ["Elf", "Druid"],
    });
    expect(parseTypeLine("Instant")).toEqual({ supertypes: [], types: ["Instant"], subtypes: [] });
  });

  it("knows which faces can be cast and which played as a land", () => {
    expect([castableFaces(MDFC), playableLandFaces(MDFC)]).toEqual([[0], [1]]);
    expect(castableFaces(ADVENTURER)).toEqual([0, 1]);
    expect(castableFaces(SPLIT)).toEqual([0, 1]);
    expect(castableFaces(TRANSFORMER)).toEqual([0]);
    expect(playableLandFaces(FOREST)).toEqual([0]);
  });

  it("says which layouts are only shape so far", () => {
    const shapeOnly = Object.entries(LAYOUT_SUPPORT).filter(([, v]) => v === "shape").map(([k]) => k);
    expect(shapeOnly).toEqual(["flip", "room", "meld", "prototype", "class", "case", "leveler", "omen", "emblem"]);
    expect(ROOM.faces).toHaveLength(2); // both halves are stored
  });
});

describe("mana", () => {
  it("parses costs and mana values", () => {
    expect(parseCost("{2}{W}{W}")).toMatchObject({ generic: 2, symbols: { W: 2 }, unsupported: [] });
    expect(parseCost("{X}{R}")).toMatchObject({ x: 1, unsupported: [] });
    expect(manaValue("{X}{R}")).toBe(1);
    expect(manaValue("{2/W}{G/U}")).toBe(3);
    expect(intrinsicMana(["Plains", "Island"])).toEqual(["W", "U"]);
  });

  it("pays from a pool, colored first", () => {
    const pool = { ...emptyPool(), G: 2, C: 1 };
    expect(payFromPool(pool, parseCost("{1}{G}"))).toEqual({ ...emptyPool(), G: 1 });
    expect(payFromPool(pool, parseCost("{U}"))).toBeNull();
  });

  it("auto-pay finds a working assignment of dual lands", () => {
    const sources = [
      { object: 1, options: [{ ability: 0, bundle: ["W" as const] }, { ability: 1, bundle: ["U" as const] }] },
      { object: 2, options: [{ ability: 0, bundle: ["W" as const] }] },
    ];
    // a greedy pick of land 1 for W would leave no U
    expect(planAutoPay(emptyPool(), parseCost("{W}{U}"), sources)).toEqual([
      { object: 1, ability: 1, bundle: ["U"] },
      { object: 2, ability: 0, bundle: ["W"] },
    ]);
    expect(planAutoPay(emptyPool(), parseCost("{U}{U}"), sources)).toBeNull();
    expect(planAutoPay({ ...emptyPool(), U: 1 }, parseCost("{1}{U}"), sources)).toHaveLength(1);
  });
});

describe("special actions (116.2)", () => {
  it("has a slot for all twelve; none but playing a land work yet", () => {
    expect(Object.values(SPECIAL_ACTIONS).map((r) => r.rule)).toEqual([
      "116.2b", "116.2c", "116.2d", "116.2e", "116.2f", "116.2g", "116.2h", "116.2i", "116.2j", "116.2k", "116.2m",
    ]);
    const s = stacked([deckOf([FOREST, 20]), deckOf([FOREST, 20])]);
    expect(step(s, 0, { kind: "special", special: "foretell" }).error).toMatch(/not yet: Foretell \(116.2h\)/);
    expect(step(s, 0, { kind: "activate", object: s.zones.hand[0][0], ability: 0 }).error).toMatch(/no such ability/);
    expect(step(s, 0, { kind: "rewind", toAction: 0 }).error).toMatch(/PR 5/);
  });
});
