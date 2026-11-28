// PR 1 gate: turn cycle tests with lands and vanilla creatures (docs: tab 7, "PR 1. Engine skeleton").
import { describe, expect, it } from "vitest";
import { chars } from "./chars";
import { step } from "./engine";
import { createGame } from "./setup";
import { act, atStep, byId, handCard, names, pass, passUntil, stacked } from "./test-helpers";
import { BEARS, deckOf, FOREST, HILL_GIANT, ISLAND, PLAINS, PLANESWALKER, QUICK_SPELL, SAVANNAH_LIONS, SLOW_SPELL, WALL_OF_NOTHING } from "./test-cards";
import type { GameEvent, GameState, Step } from "./types";

const forests = (n: number) => deckOf([FOREST, n]);

/** Passes everything for one full turn and records each step that got priority. */
function stepsOfOneTurn(s0: GameState): { steps: Step[]; s: GameState } {
  const turn = s0.turn.number;
  const steps: Step[] = [];
  let s = s0;
  while (s.turn.number === turn) {
    if (steps[steps.length - 1] !== s.turn.step) steps.push(s.turn.step);
    s = pass(s);
  }
  return { steps, s };
}

describe("turn structure", () => {
  it("runs every step in order and skips the first player's first draw in a two-player game (103.8a)", () => {
    const s = stacked([forests(20), forests(20)]);
    expect(s.turn).toMatchObject({ number: 1, activeSeat: 0, step: "upkeep" });
    const first = stepsOfOneTurn(s);
    // untap and cleanup give no priority; combat with no attackers skips blockers and damage (508.8)
    expect(first.steps).toEqual(["upkeep", "main1", "beginCombat", "declareAttackers", "endCombat", "main2", "end"]);
    expect(first.s.turn).toMatchObject({ number: 2, activeSeat: 1, step: "upkeep" });
    const second = stepsOfOneTurn(first.s);
    // seat 1 drew to 8, so cleanup asks for a discard (514.1)
    expect(second.steps).toEqual(["upkeep", "draw", "main1", "beginCombat", "declareAttackers", "endCombat", "main2", "end", "cleanup"]);
    expect(second.s.zones.hand[1]).toHaveLength(7);
    expect(second.s.zones.graveyard[1]).toHaveLength(1);
    expect(second.s.zones.hand[0]).toHaveLength(7);
  });

  it("gives every player their first draw in multiplayer (103.8c)", () => {
    const s = stacked([forests(20), forests(20), forests(20)]);
    const { steps } = stepsOfOneTurn(s);
    expect(steps).toContain("draw");
  });

  it("deals seven to each player and puts the rest in the library", () => {
    const s = stacked([forests(20), forests(20)]);
    expect(s.zones.hand[0]).toHaveLength(7);
    expect(s.zones.library[0]).toHaveLength(13);
    expect(s.seats[0].life).toBe(40);
  });

  it("passes priority around the table in turn order, active player first (117.3a, 117.4)", () => {
    let s = stacked([forests(20), forests(20), forests(20), forests(20)]);
    const order: number[] = [];
    for (let i = 0; i < 4; i++) {
      order.push(s.pendingDecision!.seat);
      expect(s.turn.step).toBe("upkeep");
      s = pass(s);
    }
    expect(order).toEqual([0, 1, 2, 3]);
    expect(s.turn.step).toBe("draw");
  });

  it("moves the turn to the next player and counts turns", () => {
    let s = stacked([forests(30), forests(30), forests(30)]);
    for (let i = 0; i < 6; i++) s = stepsOfOneTurn(s).s;
    expect(s.turn.number).toBe(7);
    expect(s.turn.activeSeat).toBe(0);
    expect(s.gameMemory.turnsTaken).toEqual({ 0: 3, 1: 2, 2: 2 });
  });

  it("refuses an action from a seat that isn't deciding, and returns the same state", () => {
    const s = stacked([forests(20), forests(20)]);
    const r = step(s, 1, { kind: "pass" });
    expect(r.error).toMatch(/waiting for seat 0/);
    expect(r.state).toBe(s);
  });
});

describe("lands and mana", () => {
  it("plays one land a turn, only in your main phase with an empty stack (305.2)", () => {
    let s = stacked([forests(20), forests(20)]);
    const f1 = handCard(s, 0, "Forest");
    expect(step(s, 0, { kind: "playLand", object: f1 }).error).toMatch(/main phase/); // upkeep
    s = passUntil(s, atStep(0, "main1"));
    s = act(s, { kind: "playLand", object: f1 });
    expect(names(s, s.zones.battlefield)).toEqual(["Forest"]);
    expect(s.pendingDecision!.seat).toBe(0); // keeps priority after a special action
    const f2 = handCard(s, 0, "Forest");
    expect(step(s, 0, { kind: "playLand", object: f2 }).error).toMatch(/already played a land/);
    expect(s.pendingDecision!.options.some((o) => o.kind === "playLand")).toBe(false);
  });

  it("can't play a land on someone else's turn", () => {
    let s = stacked([forests(20), forests(20)]);
    s = passUntil(s, (x) => x.turn.step === "main1" && x.pendingDecision!.seat === 1);
    const f = handCard(s, 1, "Forest");
    expect(step(s, 1, { kind: "playLand", object: f }).error).toMatch(/own turn/);
  });

  it("taps a basic land for its color (305.6); the pool empties at the end of the step (500.4)", () => {
    let s = stacked([forests(20), forests(20)]);
    s = passUntil(s, atStep(0, "main1"));
    s = act(s, { kind: "playLand", object: handCard(s, 0, "Forest") });
    const land = s.zones.battlefield[0];
    s = act(s, { kind: "activateMana", object: land, ability: 0 });
    expect(s.seats[0].pool.G).toBe(1);
    expect(byId(s, land).status.tapped).toBe(true);
    expect(step(s, 0, { kind: "activateMana", object: land, ability: 0 }).error).toMatch(/already tapped/);
    s = pass(pass(s)); // both pass: main1 ends
    expect(s.turn.step).toBe("beginCombat");
    expect(s.seats[0].pool.G).toBe(0);
  });

  it("untaps the active player's permanents in their untap step (502.3)", () => {
    let s = stacked([forests(20), forests(20)]);
    s = passUntil(s, atStep(0, "main1"));
    s = act(s, { kind: "playLand", object: handCard(s, 0, "Forest") });
    s = act(s, { kind: "activateMana", object: s.zones.battlefield[0], ability: 0 });
    s = passUntil(s, (x) => x.turn.activeSeat === 1);
    expect(byId(s, s.zones.battlefield[0]).status.tapped).toBe(true); // not seat 1's land
    s = passUntil(s, (x) => x.turn.activeSeat === 0);
    expect(byId(s, s.zones.battlefield[0]).status.tapped).toBe(false);
  });
});

describe("casting and resolving", () => {
  const deck = () => deckOf([FOREST, 3], [BEARS, 2], [QUICK_SPELL, 1], [ISLAND, 1], [FOREST, 13]);

  function withTwoLands(): GameState {
    let s = stacked([deck(), deckOf([ISLAND, 3], [QUICK_SPELL, 4], [ISLAND, 13])]);
    s = passUntil(s, atStep(0, "main1"));
    s = act(s, { kind: "playLand", object: handCard(s, 0, "Forest") });
    s = passUntil(s, atStep(1, "main1"));
    s = act(s, { kind: "playLand", object: handCard(s, 1, "Island") });
    s = passUntil(s, atStep(0, "main1"));
    return act(s, { kind: "playLand", object: handCard(s, 0, "Forest") });
  }

  it("casts a creature with auto-pay, keeps priority, and resolves it when everyone passes", () => {
    let s = withTwoLands();
    const bears = handCard(s, 0, "Grizzly Bears");
    s = act(s, { kind: "cast", object: bears });
    expect(s.pendingDecision!.kind).toBe("payCost");
    s = act(s, { kind: "answer", decision: s.pendingDecision!.id, choice: { pay: "auto" } });
    expect(names(s, s.zones.stack)).toEqual(["Grizzly Bears"]);
    expect(s.pendingDecision).toMatchObject({ kind: "priority", seat: 0 }); // 117.3c
    expect(s.zones.battlefield.filter((id) => byId(s, id).status.tapped)).toHaveLength(2);
    s = pass(s); // seat 0
    expect(s.pendingDecision!.seat).toBe(1);
    s = pass(s); // seat 1: resolves
    expect(s.zones.stack).toEqual([]);
    const onField = s.zones.battlefield.find((id) => byId(s, id).def === BEARS)!;
    expect(chars(s, onField)).toMatchObject({ name: "Grizzly Bears", power: 2, toughness: 2, manaValue: 2, controller: 0 });
    expect(byId(s, onField).summoningSick).toBe(true);
    expect(s.pendingDecision).toMatchObject({ kind: "priority", seat: 0 }); // 117.3b
    expect(s.turn.step).toBe("main1");
  });

  it("gives an object a new id each time it changes zones (400.7)", () => {
    let s = withTwoLands();
    const inHand = handCard(s, 0, "Grizzly Bears");
    const card = byId(s, inHand).cardId;
    s = act(s, { kind: "cast", object: inHand });
    const onStack = s.zones.stack[0];
    expect(onStack).not.toBe(inHand);
    expect(byId(s, onStack).cardId).toBe(card);
  });

  it("lets an instant be cast on an opponent's turn and in response", () => {
    let s = withTwoLands();
    s = act(s, { kind: "cast", object: handCard(s, 0, "Grizzly Bears") });
    s = act(s, { kind: "answer", decision: s.pendingDecision!.id, choice: { pay: "auto" } });
    s = pass(s);
    // seat 1 responds with an instant
    const quick = handCard(s, 1, "Quick Thought");
    s = act(s, { kind: "cast", object: quick });
    s = act(s, { kind: "answer", decision: s.pendingDecision!.id, choice: { pay: "auto" } });
    expect(names(s, s.zones.stack)).toEqual(["Grizzly Bears", "Quick Thought"]);
    s = pass(pass(s)); // seat 1, seat 0: top resolves (instant to graveyard)
    expect(names(s, s.zones.stack)).toEqual(["Grizzly Bears"]);
    expect(names(s, s.zones.graveyard[1])).toEqual(["Quick Thought"]);
    expect(s.pendingDecision!.seat).toBe(0);
  });

  it("refuses sorcery-speed spells with something on the stack or on another turn (307.1)", () => {
    let s = withTwoLands();
    s = act(s, { kind: "cast", object: handCard(s, 0, "Grizzly Bears") });
    s = act(s, { kind: "answer", decision: s.pendingDecision!.id, choice: { pay: "auto" } });
    const other = handCard(s, 0, "Grizzly Bears");
    expect(step(s, 0, { kind: "cast", object: other }).error).toMatch(/main phase with an empty stack/);
  });

  it("lists only legal starting actions with priority", () => {
    const s = withTwoLands();
    const kinds = s.pendingDecision!.options.map((o) => o.kind);
    expect(kinds[0]).toBe("pass");
    expect(kinds).toContain("cast");
    expect(kinds).toContain("activateMana");
    expect(kinds).not.toContain("playLand"); // already played one
  });

  it("offers no pay option when the lands can't make the colors", () => {
    let s = stacked([deckOf([SLOW_SPELL, 1], [PLAINS, 1], [ISLAND, 1], [FOREST, 17]), forests(20)]);
    s = passUntil(s, atStep(0, "main1"));
    s = act(s, { kind: "playLand", object: handCard(s, 0, "Plains") });
    s = passUntil(s, (x) => x.turn.activeSeat === 1);
    s = passUntil(s, atStep(0, "main1"));
    s = act(s, { kind: "playLand", object: handCard(s, 0, "Island") });
    // {1}{B} with no black source can't be paid: the options say so
    s = act(s, { kind: "cast", object: handCard(s, 0, "Slow Thought") });
    const kinds = s.pendingDecision!.options.map((o) => ("choice" in o ? Object.keys(o.choice)[0] : o.kind));
    expect(kinds).not.toContain("pay");
  });
});

describe("state-based actions (704)", () => {
  it("a player who draws from an empty library loses (704.5b) and the last player wins", () => {
    let s = stacked([forests(8), forests(8)]);
    const events: GameEvent[] = [];
    for (let i = 0; i < 400 && !s.over; i++) {
      const r = step(s, s.pendingDecision!.seat, s.pendingDecision!.kind === "priority" ? { kind: "pass" } : discardAny(s));
      events.push(...r.events);
      s = r.state;
    }
    expect(s.over).toBe(true);
    expect(s.winner).toBe(0); // seat 1 draws first from an empty library (seat 0 skipped turn 1's draw)
    expect(s.seats[1].lossReason).toMatch(/empty library/);
    expect(events.some((e) => e.type === "gameOver")).toBe(true);
    expect(step(s, 0, { kind: "pass" }).error).toMatch(/over/);
  });

  it("a creature with 0 toughness goes to the graveyard (704.5f)", () => {
    let s = stacked([deckOf([WALL_OF_NOTHING, 1], [SAVANNAH_LIONS, 0], [FOREST, 19]), forests(20)]);
    s = { ...s }; // swamp needed: give seat 0 black mana straight into the pool for this check
    s = passUntil(s, atStep(0, "main1"));
    s = { ...s, seats: { ...s.seats, 0: { ...s.seats[0], pool: { ...s.seats[0].pool, B: 1 } } } };
    s = act(s, { kind: "cast", object: handCard(s, 0, "Shade of Nothing") });
    s = act(s, { kind: "answer", decision: s.pendingDecision!.id, choice: { pay: "pool" } });
    s = pass(pass(s));
    expect(s.zones.battlefield).toEqual([]);
    expect(names(s, s.zones.graveyard[0])).toEqual(["Shade of Nothing"]);
  });

  it("a planeswalker enters with its loyalty (306.5b)", () => {
    let s = stacked([deckOf([PLANESWALKER, 1], [FOREST, 19]), forests(20)]);
    s = passUntil(s, atStep(0, "main1"));
    s = { ...s, seats: { ...s.seats, 0: { ...s.seats[0], pool: { ...s.seats[0].pool, W: 3 } } } };
    s = act(s, { kind: "cast", object: handCard(s, 0, "Test Walker") });
    s = act(s, { kind: "answer", decision: s.pendingDecision!.id, choice: { pay: "pool" } });
    s = pass(pass(s));
    expect(byId(s, s.zones.battlefield[0]).counters.loyalty).toBe(3);
  });

  it("life 0 or less loses (704.5a)", () => {
    let s = stacked([forests(20), forests(20), forests(20)]);
    s = { ...s, seats: { ...s.seats, 2: { ...s.seats[2], life: 0 } } };
    s = pass(s); // the next priority runs state checks
    expect(s.seats[2].lost).toBe(true);
    expect(s.zones.hand[2]).toEqual([]);
    expect(s.over).toBe(false);
  });
});

describe("cleanup", () => {
  it("discards down to seven (514.1)", () => {
    let s = stacked([forests(20), forests(20)]);
    s = passUntil(s, (x) => x.turn.activeSeat === 1); // seat 0 had 7, skipped draw
    for (let i = 0; i < 500 && s.pendingDecision?.kind !== "chooseObjects"; i++) s = act(s, { kind: "pass" });
    expect(s.pendingDecision).toMatchObject({ seat: 1, min: 1, max: 1, purpose: "discard" });
    const d = s.pendingDecision!;
    expect(step(s, 1, { kind: "answer", decision: d.id, choice: { objects: [] } }).error).toMatch(/exactly/);
    s = act(s, { kind: "answer", decision: d.id, choice: { objects: [d.candidates![0]] } });
    expect(s.zones.hand[1]).toHaveLength(7);
    expect(s.zones.graveyard[1]).toHaveLength(1);
    expect(s.turn.activeSeat).toBe(0);
  });
});

describe("conceding", () => {
  it("a player can concede at any time; the turn moves on if it was theirs", () => {
    let s = stacked([forests(20), forests(20), forests(20)]);
    s = act(s, { kind: "concede" }, 0); // active player concedes during their upkeep
    expect(s.seats[0].lost).toBe(true);
    expect(s.turn.activeSeat).toBe(1);
    s = act(s, { kind: "concede" }, 2); // not deciding; still allowed
    expect(s.over).toBe(true);
    expect(s.winner).toBe(1);
  });
});

describe("multiplayer game start", () => {
  it("the seed picks who goes first when no seat is given (103.1)", () => {
    const firsts = new Set<number>();
    for (let seed = 0; seed < 40; seed++)
      firsts.add(createGame({ seed, seats: [0, 1, 2, 3].map(() => ({ deck: forests(20) })) }).state.turn.activeSeat);
    expect(firsts.size).toBe(4);
  });

  it("holds bigger hands than 7 until cleanup", () => {
    let s = stacked([deckOf([HILL_GIANT, 20]), forests(20)]);
    s = passUntil(s, atStep(0, "main1"));
    expect(s.pendingDecision!.options.filter((o) => o.kind === "cast")).toHaveLength(7); // offered, cost checked later
  });
});

function discardAny(s: GameState) {
  const d = s.pendingDecision!;
  return { kind: "answer" as const, decision: d.id, choice: { objects: d.candidates!.slice(0, d.min) } };
}
