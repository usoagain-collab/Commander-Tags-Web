// PR 1 gate: mid-cast rollback. A spell you can't pay for returns everything to exactly before the cast (601.2, 733).
import { describe, expect, it } from "vitest";
import { stateDigest } from "./digest";
import { step } from "./engine";
import { act, atStep, byId, handCard, passUntil, stacked } from "./test-helpers";
import { COLOSSUS, deckOf, FOREST, MDFC, ADVENTURER, SPLIT, TRANSFORMER, X_SPELL, ORNITHOPTER, PLAINS } from "./test-cards";
import { chars, computeChars } from "./chars";
import type { GameState } from "./types";

function mainWithForest(deck = deckOf([FOREST, 1], [COLOSSUS, 1], [FOREST, 18])): GameState {
  let s = stacked([deck, deckOf([FOREST, 20])]);
  s = passUntil(s, atStep(0, "main1"));
  return act(s, { kind: "playLand", object: handCard(s, 0, "Forest") });
}

describe("mid-cast rollback (733)", () => {
  it("paying a spell you can't afford returns the exact earlier state", () => {
    const before = mainWithForest();
    let s = act(before, { kind: "cast", object: handCard(before, 0, "Big Colossus") });
    expect(s.zones.stack).toHaveLength(1);
    const r = step(s, 0, { kind: "answer", decision: s.pendingDecision!.id, choice: { pay: "auto" } });
    expect(r.state).toBe(before); // the very same state object
    expect(r.events).toEqual([{ type: "castRolledBack", seat: 0, reason: "can't pay {7}" }]);
    s = r.state;
    expect(s.zones.stack).toEqual([]);
  });

  it("undoes mana abilities used during the cast", () => {
    const before = mainWithForest();
    let s = act(before, { kind: "cast", object: handCard(before, 0, "Big Colossus") });
    const tap = s.pendingDecision!.options.find((o) => o.kind === "activateMana")!;
    s = act(s, tap);
    expect(s.seats[0].pool.G).toBe(1);
    expect(s.pendingDecision!.kind).toBe("payCost"); // still paying (601.2g)
    s = act(s, { kind: "answer", decision: s.pendingDecision!.id, choice: { pay: "pool" } });
    expect(stateDigest(s)).toBe(stateDigest(before));
    expect(s.seats[0].pool.G).toBe(0);
    expect(byId(s, s.zones.battlefield[0]).status.tapped).toBe(false);
  });

  it("cancelling a cast is the same rollback", () => {
    const before = mainWithForest();
    const s = act(before, { kind: "cast", object: handCard(before, 0, "Big Colossus") });
    expect(act(s, { kind: "answer", decision: s.pendingDecision!.id, choice: { cancel: true } })).toBe(before);
  });

  it("a {0} spell needs no payment", () => {
    const before = mainWithForest(deckOf([FOREST, 1], [ORNITHOPTER, 1], [FOREST, 18]));
    const s = act(before, { kind: "cast", object: handCard(before, 0, "Ornithopter") });
    expect(s.pendingDecision!.kind).toBe("priority");
    expect(s.zones.stack).toHaveLength(1);
  });

  it("only the seat paying can answer, and other actions wait", () => {
    const before = mainWithForest();
    const s = act(before, { kind: "cast", object: handCard(before, 0, "Big Colossus") });
    expect(step(s, 1, { kind: "pass" }).error).toMatch(/waiting for seat 0/);
    expect(step(s, 0, { kind: "pass" }).error).toMatch(/answer the payment/);
  });

  it("refuses {X} costs as not yet built", () => {
    const s = mainWithForest(deckOf([FOREST, 1], [X_SPELL, 1], [FOREST, 18]));
    expect(step(s, 0, { kind: "cast", object: handCard(s, 0, "Fireball-ish") }).error).toMatch(/not yet.*\{X\}/);
  });
});

describe("multi-face cards (shape, and the layouts PR 1 plays)", () => {
  it("a modal DFC can be played as its land face or cast as its spell face (712.8f)", () => {
    let s = stacked([deckOf([MDFC, 2], [FOREST, 18]), deckOf([FOREST, 20])]);
    s = passUntil(s, atStep(0, "main1"));
    const card = handCard(s, 0, "Spell Side");
    expect(chars(s, card).name).toBe("Spell Side"); // front face off the battlefield (712.8a)
    const opts = s.pendingDecision!.options.filter((o) => "object" in o && o.object === card);
    expect(opts).toEqual([
      { kind: "playLand", object: card, face: 1 },
      { kind: "cast", object: card, face: 0 },
    ]);
    s = act(s, { kind: "playLand", object: card, face: 1 });
    const land = s.zones.battlefield[0];
    expect(chars(s, land)).toMatchObject({ name: "Land Side", types: ["Land"], subtypes: ["Forest"] });
    expect(s.pendingDecision!.options).toContainEqual({ kind: "activateMana", object: land, ability: 0 });
  });

  it("an adventurer can be cast as its Adventure and goes to exile on resolution (715.4)", () => {
    let s = stacked([deckOf([ADVENTURER, 1], [PLAINS, 19]), deckOf([FOREST, 20])]);
    s = passUntil(s, atStep(0, "main1"));
    s = act(s, { kind: "playLand", object: handCard(s, 0, "Plains") });
    const card = handCard(s, 0, "Brave Knight");
    expect(step(s, 0, { kind: "cast", object: card }).error).toMatch(/choose which face/);
    s = act(s, { kind: "cast", object: card, face: 1 });
    expect(chars(s, s.zones.stack[0]).name).toBe("Quick Quest");
    s = act(s, { kind: "answer", decision: s.pendingDecision!.id, choice: { pay: "auto" } });
    s = act(act(s, { kind: "pass" }), { kind: "pass" });
    expect(s.zones.exile.map((id) => chars(s, id).name)).toEqual(["Brave Knight"]);
  });

  it("a split card has both halves combined off the stack (709.4)", () => {
    const s = stacked([deckOf([SPLIT, 1], [FOREST, 19]), deckOf([FOREST, 20])]);
    const c = chars(s, handCard(s, 0, "Fire"));
    expect(c.name).toBe("Fire // Ice");
    expect(c.manaValue).toBe(4);
    expect(c.colors).toEqual(["R", "U"]);
  });

  it("a transforming DFC shows its front face in hand; its back face has the front's mana value (712.8e)", () => {
    const s = stacked([deckOf([TRANSFORMER, 1], [FOREST, 19]), deckOf([FOREST, 20])]);
    const id = handCard(s, 0, "Day Wolf");
    expect(chars(s, id).name).toBe("Day Wolf");
    const o = byId(s, id);
    const flipped = { ...o, zone: "battlefield" as const, status: { ...o.status, upFace: 1, transformed: true } };
    expect(computeChars(flipped)).toMatchObject({ name: "Night Wolf", power: 4, manaValue: 2 });
  });
});
