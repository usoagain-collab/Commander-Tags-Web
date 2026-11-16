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
    ["ritual", "ritual", 60, []], // 12
    ["cantrip", "cantrip", 688, []], // 13
    ["cost-reducer-instant", "cost reducer instant", 40, []], // 14
    ["storm-count-matters", "storm count matters", 30, []], // 15
    ["gives-double-strike", "gives double strike", 60, []], // 16
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
    expect(s.route.median).toBeLessThan(s.routes.find((r) => r.key === "board")!.median);
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

  it("puts a low-curve creature deck with ramp and draw ahead of the fair deck, not behind it", () => {
    // Laptop check, Nov 15: counting raw mana value left cheap-creature decks (Edgar, Lathril) with no win by turn 12.
    const lines = [
      commander,
      ...many("guy", 28, 2, "Creature — Vampire"),
      ...many("rock", 15, 2, "Artifact"),
      ...many("draw", 8, 2, "Sorcery"),
      ...many("spell", 13, 1, "Instant"),
      ...lands(34),
    ];
    const aggro = estimateSpeed(input(lines, { rock: ["mana-rock"] }, { rock: ["ramp"], draw: ["draw"] }));
    const fairLines = [commander, ...many("guy", 30, 4, "Creature — Soldier"), ...many("spell", 33, 3, "Instant"), ...lands(36)];
    const fair = estimateSpeed(input(fairLines, {}));
    expect(aggro.route.key).toBe("board");
    expect(aggro.turn).toBeLessThanOrEqual(8);
    expect(aggro.turn).toBeLessThan(fair.turn);
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

  it("finds a spell chain: rituals, cantrips and cost reducers into a storm finisher", () => {
    const lines = [
      commander,
      main(card("Grapeshot", 2, "Sorcery"), 8), // test-only copies, standing in for the tutors a real deck would run
      ...many("ritual", 8, 1, "Instant"),
      ...many("cantrip", 30, 1, "Sorcery"),
      ...many("reducer", 4, 2, "Artifact"),
      ...many("filler", 13, 4, "Creature — Wizard"),
      ...lands(36),
    ];
    const s = estimateSpeed(input(lines, { ritual: ["ritual"], cantrip: ["cantrip"], reducer: ["cost-reducer-instant"] }));
    const chain = s.routes.find((r) => r.key === "chain")!;
    const board = s.routes.find((r) => r.key === "board")!;
    expect(chain).toBeDefined();
    expect(chain.label).toBe("spell chain");
    expect(chain.median).toBeLessThan(board.median);
    expect(chain.cards).toEqual(expect.arrayContaining(["Grapeshot", "reducer0"]));
    expect(chain.pieces).toBe("1 finisher and 42 cheap spells, rituals and cost reducers");
  });

  it("leaves the spell chain off without a finisher, or with too few cheap spells unless the deck plays as Spellslinger", () => {
    const none = [commander, ...many("cantrip", 30, 1, "Sorcery"), ...many("filler", 33, 4, "Creature — Wizard"), ...lands(36)];
    expect(estimateSpeed(input(none, { cantrip: ["cantrip"] })).routes.map((r) => r.key)).not.toContain("chain");
    const thin = [commander, main(card("Grapeshot", 2, "Sorcery")), ...many("cantrip", 4, 1, "Sorcery"), ...many("filler", 58, 4, "Creature — Wizard"), ...lands(36)];
    expect(estimateSpeed(input(thin, { cantrip: ["cantrip"] })).routes.map((r) => r.key)).not.toContain("chain");
    const slinger = ARCHETYPES.find((x) => x.key === "spellslinger")!;
    expect(estimateSpeed(input(thin, { cantrip: ["cantrip"] }, {}, { archetype: { archetype: slinger, picked: true } })).routes.map((r) => r.key)).toContain("chain");
  });

  it("finds a commander damage route: a cheap commander, equipment and protection", () => {
    const champ = main(card("Champion", 3, "Legendary Creature — Human Soldier"));
    champ.board = "commander";
    const lines = [
      champ,
      ...many("sword", 18, 2, "Artifact — Equipment"),
      ...many("ward", 8, 1, "Instant"),
      ...many("rock", 6, 2, "Artifact"),
      ...many("filler", 31, 4, "Sorcery"),
      ...lands(36),
    ];
    const s = estimateSpeed(input(lines, { rock: ["mana-rock"] }, { ward: ["protection"], rock: ["ramp"] }));
    expect(s.route.key).toBe("voltron");
    expect(s.route.label).toBe("commander damage");
    expect(s.route.median).toBeLessThan(s.routes.find((r) => r.key === "board")!.median);
    expect(s.route.cards).toEqual(expect.arrayContaining(["Champion", "sword0"]));
    expect(s.route.pieces).toBe("Champion with 18 equipment and auras");
  });

  it("counts double strike as doubling the commander's damage", () => {
    const champ = main(card("Champion", 3, "Legendary Creature — Human Soldier"));
    champ.board = "commander";
    const base = [champ, ...many("ward", 8, 1, "Instant"), ...many("filler", 40, 4, "Sorcery"), ...lands(36)];
    const plain = estimateSpeed(input([...base, ...many("sword", 15, 2, "Artifact — Equipment")], {}, { ward: ["protection"] }));
    const doubled = estimateSpeed(input([...base, ...many("sword", 12, 2, "Artifact — Equipment"), ...many("strike", 3, 2, "Artifact — Equipment")], { strike: ["gives-double-strike"] }, { ward: ["protection"] }));
    const at = (x: typeof plain) => x.routes.find((r) => r.key === "voltron")!.median;
    expect(at(doubled)).toBeLessThanOrEqual(at(plain));
  });

  it("leaves commander damage off with only a few equipment unless the deck plays as Voltron", () => {
    const champ = main(card("Champion", 3, "Legendary Creature — Human Soldier"));
    champ.board = "commander";
    const lines = [champ, ...many("sword", 3, 2, "Artifact — Equipment"), ...many("filler", 60, 4, "Sorcery"), ...lands(36)];
    expect(estimateSpeed(input(lines, {})).routes.map((r) => r.key)).not.toContain("voltron");
    const voltron = ARCHETYPES.find((x) => x.key === "voltron")!;
    expect(estimateSpeed(input(lines, {}, {}, { archetype: { archetype: voltron, picked: true } })).routes.map((r) => r.key)).toContain("voltron");
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
