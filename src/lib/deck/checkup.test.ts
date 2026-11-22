import { describe, expect, it } from "vitest";
import { balanceCheck, curveCheck, offPlan, overlapCheck, type CheckCard } from "./checkup";

const c = (name: string, mana_value: number, extra: Partial<CheckCard> = {}): CheckCard => ({
  oracle_id: name,
  name,
  quantity: 1,
  mana_value,
  spell: true,
  commander: false,
  roles: [],
  themes: 1,
  cheat: false,
  ...extra,
});

describe("curveCheck", () => {
  it("averages spells only and lists the heavy ones you cast yourself", () => {
    const r = curveCheck([c("Two", 2), c("Seven", 7), c("Cheated", 8, { cheat: true }), c("Boss", 6, { commander: true }), c("Forest", 0, { spell: false })]);
    expect(r.spells).toBe(4);
    expect(r.average).toBeCloseTo((2 + 7 + 8 + 6) / 4, 5);
    expect(r.heavy.map((x) => x.name)).toEqual(["Seven"]);
    expect(r.ok).toBe(false);
  });

  it("is fine for a low curve", () => {
    expect(curveCheck([c("One", 1), c("Three", 3)]).ok).toBe(true);
  });
});

describe("balanceCheck", () => {
  const many = (role: string, n: number) => Array.from({ length: n }, (_, i) => c(`${role}${i}`, 2, { roles: [role] }));

  it("flags the short side when one is under 60% of the other", () => {
    expect(balanceCheck([...many("ramp", 12), ...many("draw", 5)])).toEqual({ ramp: 12, draw: 5, even: false, short: "draw" });
  });

  it("calls 10 and 8 even, and won't call small decks", () => {
    expect(balanceCheck([...many("ramp", 10), ...many("draw", 8)]).even).toBe(true);
    expect(balanceCheck([...many("ramp", 5), ...many("draw", 1)]).even).toBe(true);
  });
});

describe("overlapCheck and offPlan", () => {
  it("counts spells with two or more roles", () => {
    const r = overlapCheck([c("Rock", 2, { roles: ["ramp", "draw"] }), c("Bolt", 1, { roles: ["removal"] }), c("Cmdr", 4, { commander: true, roles: ["ramp", "draw"] })]);
    expect(r.multi.map((x) => x.name)).toEqual(["Rock"]);
    expect(r.spells).toBe(2);
    expect(r.share).toBe(0.5);
  });

  it("lists spells with no role and no shared theme", () => {
    const r = offPlan([c("Stray", 4, { themes: 0 }), c("Themed", 4), c("Role", 2, { themes: 0, roles: ["ramp"] }), c("Forest", 0, { spell: false, themes: 0 })]);
    expect(r.map((x) => x.name)).toEqual(["Stray"]);
  });
});
