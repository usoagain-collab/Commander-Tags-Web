import { describe, expect, it } from "vitest";
import {
  applyChange,
  deckIdentity,
  deckSize,
  groupByType,
  linesFor,
  outsideIdentity,
  planAdd,
  planMove,
  planRemove,
  planSetQuantity,
  qty,
  toSaveRows,
  typeSection,
  type CardSummary,
  type Entries,
} from "./model";

const card = (name: string, extra: Partial<CardSummary> = {}): CardSummary => ({
  oracle_id: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  mana_cost: null,
  mana_value: 0,
  type_line: "Artifact",
  color_identity: [],
  image_normal: null,
  image_art_crop: null,
  price_usd: null,
  edhrec_rank: null,
  commander_legal: true,
  game_changer: false,
  max_copies: 1,
  can_be_commander: false,
  ...extra,
});

const solRing = card("Sol Ring", { mana_value: 1, price_usd: 2 });
const forest = card("Forest", { type_line: "Basic Land — Forest", max_copies: 99 });
const dwarves = card("Seven Dwarves", { type_line: "Creature — Dwarf", max_copies: 7 });
const meren = card("Meren of Clan Nel Toth", {
  type_line: "Legendary Creature — Human Shaman",
  color_identity: ["B", "G"],
  can_be_commander: true,
});
const bolt = card("Lightning Bolt", { type_line: "Instant", color_identity: ["R"] });

function run(entries: Entries, plan: ReturnType<typeof planAdd>) {
  if (!plan.ok) throw new Error(plan.reason);
  return applyChange(entries, plan.change);
}

describe("adding cards", () => {
  it("adds a card to the mainboard", () => {
    const e = run({}, planAdd({}, solRing, "main"));
    expect(qty(e, "main", solRing.oracle_id)).toBe(1);
  });

  it("refuses a second copy of a singleton card", () => {
    const e = run({}, planAdd({}, solRing, "main"));
    const again = planAdd(e, solRing, "main");
    expect(again.ok).toBe(false);
  });

  it("counts the commander toward the singleton rule", () => {
    const e = run({}, planAdd({}, meren, "commander"));
    expect(planAdd(e, meren, "main").ok).toBe(false);
  });

  it("allows many basic lands, up to seven Seven Dwarves", () => {
    let e: Entries = {};
    for (let i = 0; i < 30; i++) e = run(e, planAdd(e, forest, "main"));
    expect(qty(e, "main", forest.oracle_id)).toBe(30);
    for (let i = 0; i < 7; i++) e = run(e, planAdd(e, dwarves, "main"));
    expect(planAdd(e, dwarves, "main").ok).toBe(false);
  });

  it("allows the maybeboard to hold a card that is also in the deck", () => {
    const e = run({}, planAdd({}, solRing, "main"));
    expect(planAdd(e, solRing, "maybe").ok).toBe(true);
  });
});

describe("quantities and removal", () => {
  it("clamps quantity to the copy limit", () => {
    let e = run({}, planAdd({}, dwarves, "main"));
    e = run(e, planSetQuantity(e, dwarves, "main", 50));
    expect(qty(e, "main", dwarves.oracle_id)).toBe(7);
  });

  it("removes a card", () => {
    let e = run({}, planAdd({}, solRing, "main"));
    e = run(e, planRemove(e, solRing, "main"));
    expect(e).toEqual({});
  });
});

describe("moving between boards", () => {
  it("moves a card from the mainboard to the commander zone", () => {
    let e = run({}, planAdd({}, meren, "main"));
    e = run(e, planMove(e, meren, "main", "commander"));
    expect(qty(e, "main", meren.oracle_id)).toBe(0);
    expect(qty(e, "commander", meren.oracle_id)).toBe(1);
  });

  it("moves only one copy into the commander zone", () => {
    let e = run({}, planSetQuantity({}, forest, "main", 5));
    e = run(e, planMove(e, forest, "main", "commander"));
    expect(qty(e, "main", forest.oracle_id)).toBe(4);
    expect(qty(e, "commander", forest.oracle_id)).toBe(1);
  });

  it("won't move a maybeboard card into the deck past its limit", () => {
    let e = run({}, planAdd({}, solRing, "main"));
    e = run(e, planAdd(e, solRing, "maybe"));
    expect(planMove(e, solRing, "maybe", "main").ok).toBe(false);
  });
});

describe("undo and redo", () => {
  it("restores the exact previous state, and redoes it", () => {
    let e = run({}, planSetQuantity({}, forest, "main", 3));
    const before = e;
    const plan = planMove(e, forest, "main", "maybe");
    if (!plan.ok) throw new Error(plan.reason);
    e = applyChange(e, plan.change);
    expect(applyChange(e, plan.change, "back")).toEqual(before);
    expect(applyChange(applyChange(e, plan.change, "back"), plan.change)).toEqual(e);
  });

  it("sends final counts to the database, and the old counts on undo", () => {
    const plan = planMove(run({}, planAdd({}, meren, "main")), meren, "main", "commander");
    if (!plan.ok) throw new Error(plan.reason);
    expect(toSaveRows(plan.change)).toEqual([
      { oracle_id: meren.oracle_id, board: "main", quantity: 0 },
      { oracle_id: meren.oracle_id, board: "commander", quantity: 1 },
    ]);
    expect(toSaveRows(plan.change, "back")).toEqual([
      { oracle_id: meren.oracle_id, board: "main", quantity: 1 },
      { oracle_id: meren.oracle_id, board: "commander", quantity: 0 },
    ]);
  });
});

describe("reading the deck", () => {
  const cards = Object.fromEntries([solRing, forest, meren, bolt].map((c) => [c.oracle_id, c]));

  it("files modal double-faced cards under their front face", () => {
    expect(typeSection("Instant // Land")).toBe("Instant");
    expect(typeSection("Artifact Creature — Golem")).toBe("Creature");
    expect(typeSection("Artifact Land")).toBe("Land");
  });

  it("groups the mainboard by type, cheapest first", () => {
    let e = run({}, planAdd({}, solRing, "main"));
    e = run(e, planSetQuantity(e, forest, "main", 2));
    const groups = groupByType(linesFor(e, cards, "main"));
    expect(groups.map((g) => [g.section, g.count])).toEqual([
      ["Land", 2],
      ["Artifact", 1],
    ]);
  });

  it("counts commander plus mainboard toward 100, not the maybeboard", () => {
    let e = run({}, planAdd({}, meren, "commander"));
    e = run(e, planSetQuantity(e, forest, "main", 10));
    e = run(e, planAdd(e, bolt, "maybe"));
    expect(deckSize(e)).toBe(11);
  });

  it("flags cards outside the commander's colors", () => {
    const e = run({}, planAdd({}, meren, "commander"));
    const identity = deckIdentity(e, cards);
    expect(outsideIdentity(bolt, identity)).toBe(true);
    expect(outsideIdentity(solRing, identity)).toBe(false);
    expect(outsideIdentity(bolt, deckIdentity({}, cards))).toBe(false); // no commander yet: no warnings
  });
});
