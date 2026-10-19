import { describe, expect, it } from "vitest";
import { applyCategories, applyChange, toSavePayload } from "./model";
import { diffDecks, diffSummary, planRestore, readSnapshot } from "./versions";

describe("readSnapshot", () => {
  it("reads rows and categories, skipping broken ones", () => {
    expect(
      readSnapshot([
        ["sol", "main", 1, "draw"],
        ["forest", "main", 30, null],
        ["x", "sideboard", 1, null],
        "junk",
      ]),
    ).toEqual({ entries: { "main|sol": 1, "main|forest": 30 }, categories: { "main|sol": "draw" } });
  });
});

describe("diffDecks", () => {
  const before = { entries: { "main|sol": 1, "main|forest": 30, "maybe|bolt": 1 }, categories: {} };
  const after = { entries: { "main|sol": 1, "main|forest": 28, "main|bolt": 1, "main|wrath": 1 }, categories: { "main|sol": "draw" } };
  it("lists added, removed and changed copies per board", () => {
    const d = diffDecks(before, after);
    expect(d.added.map((l) => `${l.board}:${l.oracle_id}`).sort()).toEqual(["main:bolt", "main:wrath"]);
    expect(d.removed).toEqual([{ oracle_id: "bolt", board: "maybe", from: 1, to: 0 }]);
    expect(d.changed).toEqual([{ oracle_id: "forest", board: "main", from: 30, to: 28 }]);
    expect(d.categorized).toBe(1);
    expect(diffSummary(d)).toEqual({ plus: 2, minus: 3 });
  });
});

describe("planRestore", () => {
  it("brings the deck back to the version in one undoable change, saving a version first", () => {
    const current = { entries: { "main|sol": 1, "main|wrath": 1 }, categories: { "main|sol": "draw" } };
    const target = { entries: { "main|sol": 1, "main|bolt": 1 }, categories: {} };
    const plan = planRestore(current, target, "Restore v1", "Before restoring v1");
    if (!plan.ok) throw new Error("plan failed");
    expect(applyChange(current.entries, plan.change)).toEqual(target.entries);
    expect(applyCategories(current.categories, plan.change)).toEqual({});
    expect(applyChange(applyChange(current.entries, plan.change), plan.change, "back")).toEqual(current.entries);
    expect(toSavePayload(plan.change).snapshot_name).toBe("Before restoring v1");
    expect(toSavePayload(plan.change, "back").snapshot_name).toBeUndefined();
  });

  it("says so when the deck already matches", () => {
    const s = { entries: { "main|sol": 1 }, categories: {} };
    expect(planRestore(s, s, "x", "y").ok).toBe(false);
  });
});
