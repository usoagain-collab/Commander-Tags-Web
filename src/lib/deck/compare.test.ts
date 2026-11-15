import { describe, expect, it } from "vitest";
import { compareDecks, compareRoles, type CompareRow } from "./compare";

const row = (oracle_id: string, quantity = 1, board: CompareRow["board"] = "main"): CompareRow => ({ oracle_id, board, quantity });

describe("compareDecks", () => {
  it("splits cards into both, only mine and only theirs, with copies", () => {
    const c = compareDecks([row("cmd", 1, "commander"), row("sol"), row("forest", 10)], [row("cmd", 1, "commander"), row("forest", 14), row("cultivate")]);
    expect(c.both).toEqual([
      { oracle_id: "cmd", mine: 1, theirs: 1 },
      { oracle_id: "forest", mine: 10, theirs: 14 },
    ]);
    expect(c.onlyMine).toEqual([{ oracle_id: "sol", mine: 1, theirs: 0 }]);
    expect(c.onlyTheirs).toEqual([{ oracle_id: "cultivate", mine: 0, theirs: 1 }]);
  });

  it("leaves the maybeboard out on both sides", () => {
    const c = compareDecks([row("a"), row("b", 1, "maybe")], [row("b"), row("a", 1, "maybe")]);
    expect(c.both).toEqual([]);
    expect(c.onlyMine.map((l) => l.oracle_id)).toEqual(["a"]);
    expect(c.onlyTheirs.map((l) => l.oracle_id)).toEqual(["b"]);
  });

  it("works out overlap without basic lands", () => {
    const c = compareDecks([row("forest", 30), row("a"), row("b")], [row("forest", 30), row("a")], (id) => id === "forest");
    expect(c.overlap).toBe(0.5);
    expect(compareDecks([], [row("a")]).overlap).toBe(0);
  });
});

describe("compareRoles", () => {
  it("keeps role order and drops roles neither deck fills", () => {
    const roles = [
      { key: "ramp", name: "Ramp" },
      { key: "draw", name: "Card draw" },
      { key: "wipes", name: "Board wipes" },
    ];
    expect(compareRoles(roles, { ramp: 10, draw: 0 }, { ramp: 8, wipes: 2 })).toEqual([
      { key: "ramp", name: "Ramp", mine: 10, theirs: 8 },
      { key: "wipes", name: "Board wipes", mine: 0, theirs: 2 },
    ]);
  });
});
