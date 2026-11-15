import { describe, expect, it } from "vitest";
import type { CardSummary, DeckLine } from "@/lib/deck/model";
import { TagTree } from "@/lib/tags/tree";
import { ARCHETYPES } from "@/lib/cutter/archetypes";
import type { BracketEstimate } from "./evaluate";
import { clearSpeedCache, estimateSpeed, speedPoints, SPEED, type SpeedInput } from "./speed";

const tree = new TagTree({
  n: 1000,
  art_n: 1000,
  tags: [
    ["recursion", "recursion", 0, []], // 0
    ["reanimate", "reanimate", 10, [0]], // 1
    ["reanimate-creature", "reanimate creature", 500, [1]], // 2
    ["sneak", "sneak", 290, []], // 3
    ["tutor", "tutor", 0, []], // 4
    ["tutor-to-graveyard", "tutor to graveyard", 20, [4]], // 5
    ["tutor-creature", "tutor creature", 50, [4]], // 6
    ["ramp", "ramp", 500, []], // 7
    ["mana-rock", "mana rock", 300, [7]], // 8
    ["discard-outlet", "discard outlet", 1400, []], // 9
    ["mill", "mill", 0, []], // 10
    ["mill-self", "mill self", 1100, [10]], // 11
  ],
} as unknown as ConstructorParameters<typeof TagTree>[0]);

const card = (name: string, mv: number, typeLine: string, over: Partial<CardSummary> = {}): CardSummary =>
  ({ oracle_id: name, name, mana_value: mv, type_line: typeLine, game_changer: false, counts_as_land: /Land/.test(typeLine), ...over }) as CardSummary;
const main = (c: CardSummary, quantity = 1): DeckLine => ({ board: "main", quantity, card: c });
const many = (prefix: string, n: number, mv: number, typeLine: string) => Array.from({ length: n }, (_, i) => main(card(`${prefix}${i}`, mv, typeLine)));
const lands = (n: number) => [main(card("Swamp", 0, "Basic Land — Swamp"), n)];
const commander = main(card("Commander", 4, "Legendary Creature — Human"));
commander.board = "commander";
const noEstimate: BracketEstimate = { floor: 1, findings: [] };

function input(lines: DeckLine[], tags: Record<string, string[]>, roles: Record<string, string[]> = {}, over: Partial<SpeedInput> = {}): SpeedInput {
  const tagsOf = (id: string) => Object.entries(tags).find(([p]) => id.startsWith(p))?.[1] ?? [];
  return {
    lines,
    tagsOf,
    rolesOf: (l) => Object.entries(roles).find(([p]) => l.card.oracle_id.startsWith(p))?.[1] ?? [],
    tree,
    estimate: noEstimate,
    ...over,
  };
}

describe("sample games (speed)", () => {
  it("scores the threat turn: full at turn 4, none at turn 10", () => {
    expect(speedPoints(4)).toBe(40);
    expect(speedPoints(3)).toBe(40);
    expect(speedPoints(7)).toBe(20);
    expect(speedPoints(10)).toBe(0);
    expect(speedPoints(SPEED.maxTurn + 1)).toBe(0);
  });

  it("finds a fast reanimator route: cheap enablers, Entombs, self-mill and 6+ payoffs", () => {
    const lines = [
      commander,
      ...many("reanimate", 12, 1, "Sorcery"),
      ...many("entomb", 3, 1, "Instant"),
      ...many("loot", 6, 1, "Sorcery"),
      ...many("draw", 8, 2, "Sorcery"),
      ...many("mill", 6, 1, "Creature — Zombie"),
      ...many("fatty", 5, 8, "Creature — Demon"),
      ...many("filler", 23, 3, "Instant"),
      ...lands(36),
    ];
    const s = estimateSpeed(
      input(lines, { reanimate: ["reanimate-creature"], entomb: ["tutor-to-graveyard", "tutor-creature"], loot: ["discard-outlet"], mill: ["mill-self"] }, { entomb: ["tutors"], draw: ["draw"] }),
    );
    expect(s.route.key).toBe("cheat");
    // A casual reanimator: ready by turn 7 in half the games and by turn 4 in the fastest quarter, whatever its
    // 8-drops do to the average mana value.
    expect(s.turn).toBeLessThanOrEqual(7);
    expect(s.fast).toBeLessThanOrEqual(4);
    expect(s.points).toBeGreaterThanOrEqual(20);
    expect(s.route.cards).toEqual(expect.arrayContaining(["reanimate0", "fatty0"]));
  });

  it("gives a Meren-style deck no cheat route when it only brings back small creatures", () => {
    const lines = [commander, ...many("reanimate", 6, 2, "Sorcery"), ...many("bear", 30, 3, "Creature — Bear"), ...many("filler", 27, 3, "Instant"), ...lands(36)];
    const s = estimateSpeed(input(lines, { reanimate: ["reanimate-creature"] }));
    expect(s.routes.map((r) => r.key)).toEqual(["board"]);
    expect(s.turn).toBeGreaterThanOrEqual(7);
  });

  it("puts a fair creature deck at the board route around turns 8-10", () => {
    const lines = [commander, ...many("guy", 30, 4, "Creature — Soldier"), ...many("spell", 33, 3, "Instant"), ...lands(36)];
    const s = estimateSpeed(input(lines, {}));
    expect(s.route.key).toBe("board");
    expect(s.turn).toBeGreaterThanOrEqual(8);
    expect(s.turn).toBeLessThanOrEqual(10);
  });

  it("counts fast mana and tutors toward a cheap two-card combo", () => {
    const a = card("pieceA", 2, "Creature — Wizard");
    const b = card("pieceB", 2, "Instant");
    const combo = { id: "c", card_a: "pieceA", card_b: "pieceB", results: ["Win the game"], bracket_tag: "R", requires: 0, popularity: 1 };
    const estimate: BracketEstimate = { floor: 4, findings: [{ kind: "combo", minBracket: 4, label: "", cards: ["pieceA", "pieceB"], combo }] };
    const lines = [
      commander,
      main(a),
      main(b),
      ...many("tutor", 12, 1, "Sorcery"),
      ...many("rock", 8, 1, "Artifact"),
      ...many("draw", 10, 1, "Instant"),
      ...many("filler", 31, 3, "Instant"),
      ...lands(36),
    ];
    const s = estimateSpeed(input(lines, { rock: ["mana-rock"] }, { tutor: ["tutors"], rock: ["ramp"], draw: ["draw"] }, { estimate }));
    expect(s.route.key).toBe("combo");
    expect(s.turn).toBeLessThanOrEqual(6);
    expect(s.fast).toBeLessThanOrEqual(4);
    expect(s.route.cards.sort()).toEqual(["pieceA", "pieceB"]);
  });

  it("checks Exhibition combos only when the deck plays as Combo", () => {
    const combo = { id: "c", card_a: "pieceA", card_b: "pieceB", results: [], bracket_tag: "E", requires: 0, popularity: 1 };
    const estimate: BracketEstimate = { floor: 1, findings: [{ kind: "combo", minBracket: 1, label: "", cards: ["pieceA", "pieceB"], combo }] };
    const lines = [commander, main(card("pieceA", 3, "Artifact")), main(card("pieceB", 3, "Artifact")), ...many("filler", 61, 3, "Instant"), ...lands(36)];
    const plain = estimateSpeed(input(lines, {}, {}, { estimate }));
    expect(plain.routes.map((r) => r.key)).not.toContain("combo");
    const comboArch = ARCHETYPES.find((x) => x.key === "combo")!;
    const picked = estimateSpeed(input(lines, {}, {}, { estimate, archetype: { archetype: comboArch, picked: true } }));
    expect(picked.routes.map((r) => r.key)).toContain("combo");
    expect(picked.archetype).toMatchObject({ key: "combo", picked: true });
  });

  it("turns the cheat route on with fewer enablers when the deck plays as a graveyard deck", () => {
    const lines = [commander, ...many("reanimate", 2, 1, "Sorcery"), ...many("fatty", 4, 8, "Creature — Demon"), ...many("filler", 57, 3, "Instant"), ...lands(36)];
    const tags = { reanimate: ["reanimate-creature"] };
    expect(estimateSpeed(input(lines, tags)).routes.map((r) => r.key)).not.toContain("cheat");
    const graveyard = ARCHETYPES.find((x) => x.key === "graveyard")!;
    expect(estimateSpeed(input(lines, tags, {}, { archetype: { archetype: graveyard, picked: true } })).routes.map((r) => r.key)).toContain("cheat");
  });

  it("gives the same answer every time for the same deck", () => {
    const lines = [commander, ...many("guy", 30, 4, "Creature — Soldier"), ...many("spell", 33, 3, "Instant"), ...lands(36)];
    const a = estimateSpeed(input(lines, {}));
    clearSpeedCache();
    const b = estimateSpeed(input(lines.map((l) => ({ ...l })), {}));
    expect(b.turn).toBe(a.turn);
    expect(b.fast).toBe(a.fast);
  });
});
