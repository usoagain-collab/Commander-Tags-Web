import { describe, expect, it } from "vitest";
import type { CardSummary, DeckLine } from "./model";
import { castTurn, commanderTurn, curveCard, rampStep, type CurveCard } from "./commander-turn";

const line = (name: string, extra: Partial<CardSummary>, quantity = 1): DeckLine => ({
  board: "main",
  quantity,
  card: {
    oracle_id: name,
    name,
    mana_cost: null,
    mana_value: 0,
    type_line: "Instant",
    color_identity: [],
    image_normal: null,
    image_art_crop: null,
    price_usd: null,
    edhrec_rank: null,
    commander_legal: true,
    game_changer: false,
    max_copies: 1,
    can_be_commander: false,
    layout: "normal",
    counts_as_land: false,
    ...extra,
  },
});

const L: CurveCard = { land: true, mv: 0, tap: 0, now: false, once: 0, quantity: 1 };
const X: CurveCard = { land: false, mv: 3, tap: 0, now: false, once: 0, quantity: 1 };
const rock = (mv: number, tap = 1): CurveCard => ({ land: false, mv, tap, now: true, once: 0, quantity: 1 });
const dork = (mv: number): CurveCard => ({ land: false, mv, tap: 1, now: false, once: 0, quantity: 1 });

describe("castTurn", () => {
  it("casts on curve with a land every turn", () => {
    expect(castTurn(Array(20).fill(L), 4, false)).toBe(4);
  });

  it("misses land drops when lands run out", () => {
    const deck = [L, L, X, X, X, X, X, X, L, X, X, X, X];
    // Two lands in the opener; on the play the next land is the 2nd draw (turn 3).
    expect(castTurn(deck, 3, false)).toBe(3);
    expect(castTurn([L, L, ...Array(20).fill(X)], 3, false)).toBeNull();
  });

  it("a rock is ready the turn it's cast, a dork the turn after", () => {
    const withRock = [L, L, L, rock(2), X, X, X, ...Array(10).fill(X)];
    expect(castTurn(withRock, 4, false)).toBe(3); // turn 2: Signet, 1 left +1 = 1; turn 3: 3 lands + 1 = 4
    expect(castTurn([L, L, rock(1, 2), X, X, X, X, ...Array(10).fill(X)], 4, false)).toBe(2); // Sol Ring turn 1
    const withDork = [L, L, L, dork(1), X, X, X, ...Array(10).fill(X)];
    expect(castTurn(withDork, 3, false)).toBe(2); // turn 1: dork; turn 2: 2 lands + dork
  });
});

describe("commanderTurn", () => {
  it("is cumulative and the draw is never worse", () => {
    const lib = [{ ...L, quantity: 38 }, { ...X, quantity: 51 }, { ...rock(2), quantity: 10 }];
    const r = commanderTurn(lib, 4, 300);
    expect(r.games).toBe(300);
    for (let t = 2; t <= 10; t++) expect(r.play[t]).toBeGreaterThanOrEqual(r.play[t - 1]);
    expect(r.draw[4]).toBeGreaterThanOrEqual(r.play[4] - 0.05);
    expect(r.play[4]).toBeGreaterThan(0.4);
    expect(r.play[10]).toBeGreaterThan(0.9);
  });

  it("needs a real library", () => {
    expect(commanderTurn([L], 3).games).toBe(0);
  });
});

describe("curveCard", () => {
  it("reads fast mana amounts by name", () => {
    expect(curveCard(line("Sol Ring", { mana_value: 1, type_line: "Artifact" }), true)).toMatchObject({ tap: 2, now: true });
    expect(curveCard(line("Dark Ritual", { mana_value: 1 }), true)).toMatchObject({ tap: 0, once: 3 });
    expect(curveCard(line("Llanowar Elves", { mana_value: 1, type_line: "Creature — Elf Druid" }), true)).toMatchObject({ tap: 1, now: false });
    expect(curveCard(line("Forest", { type_line: "Basic Land — Forest", counts_as_land: true }), true)).toMatchObject({ land: true, tap: 0 });
    expect(curveCard(line("Bolt", { mana_value: 1 }), false).tap).toBe(0);
  });
});

describe("rampStep", () => {
  it("splits ramp into on the step and as costly as the commander", () => {
    const lines = [
      line("Signet", { mana_value: 2 }),
      line("Cultivate", { mana_value: 3 }),
      line("Explosive Vegetation", { mana_value: 4 }),
      line("Sol Ring", { mana_value: 1 }),
      line("Bolt", { mana_value: 1 }),
    ];
    const r = rampStep(lines, (l) => l.card.name !== "Bolt", 4);
    expect(r.onStep.map((l) => l.card.name)).toEqual(["Signet", "Cultivate"]);
    expect(r.tooLate.map((l) => l.card.name)).toEqual(["Explosive Vegetation"]);
    expect(r.pattern).toEqual([2, 4]);
    expect(rampStep(lines, () => true, 5).pattern).toEqual([1, 3, 5]);
  });
});
