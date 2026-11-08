import { describe, expect, it } from "vitest";
import type { CardSummary, DeckLine } from "@/lib/deck/model";
import { estimatePower, type PowerInput } from "./power";

const line = (id: string, mv: number, over: Partial<CardSummary> = {}, quantity = 1): DeckLine => ({
  board: "main",
  quantity,
  card: { oracle_id: id, name: id, mana_value: mv, type_line: "Sorcery", game_changer: false, ...over } as CardSummary,
});

const base = (lines: DeckLine[], roles: Record<string, string[]> = {}, over: Partial<PowerInput> = {}): PowerInput => ({
  lines,
  rolesOf: (l) => roles[l.card.oracle_id] ?? [],
  tagsOf: () => [],
  counterTags: new Set(["counterspell"]),
  topThemes: new Set(["o:tokens"]),
  themeKeysOf: () => [],
  estimate: { floor: 1, findings: [] },
  ...over,
});

describe("refined bracket estimate", () => {
  it("scores a slow, unfocused deck low", () => {
    const lines = Array.from({ length: 60 }, (_, i) => line(`c${i}`, 5));
    const p = estimatePower(base(lines));
    expect(p.score).toBe(0);
    expect(p.playsLike).toBe(1);
  });

  it("adds up fast mana, tutors, interaction, Game Changers, curve and cohesion", () => {
    const lines = [
      ...Array.from({ length: 10 }, (_, i) => line(`rock${i}`, 1)),
      ...Array.from({ length: 6 }, (_, i) => line(`tutor${i}`, 2)),
      ...Array.from({ length: 10 }, (_, i) => line(`kill${i}`, 1)),
      line("gc", 2, { game_changer: true }),
      line("Forest", 0, { type_line: "Basic Land — Forest" }, 30),
    ];
    const roles: Record<string, string[]> = {};
    lines.forEach((l) => {
      const id = l.card.oracle_id;
      if (id.startsWith("rock")) roles[id] = ["ramp"];
      if (id.startsWith("tutor")) roles[id] = ["tutors"];
      if (id.startsWith("kill")) roles[id] = ["removal"];
    });
    const p = estimatePower(base(lines, roles, { themeKeysOf: () => ["o:tokens"] }));
    const pts = Object.fromEntries(p.parts.map((x) => [x.key, x.points]));
    expect(pts).toMatchObject({ fast: 20, tutors: 15, interaction: 15, gc: 2, curve: 10, cohesion: 10 });
    expect(p.score).toBe(72);
    expect(p.playsLike).toBe(4);
  });

  it("never goes below the floor and ignores exhibition combos", () => {
    const lines = [line("a", 5), line("b", 5)];
    const combo = { id: "x", card_a: "a", card_b: "b", results: [], bracket_tag: "E", requires: 0, popularity: 1 };
    const p = estimatePower(base(lines, {}, { estimate: { floor: 3, findings: [{ kind: "combo", minBracket: 1, label: "", cards: ["a", "b"], combo }] } }));
    expect(p.parts.find((x) => x.key === "combos")!.points).toBe(0);
    expect(p.playsLike).toBe(3);
  });

  it("counts a counterspell as cheap interaction", () => {
    const p = estimatePower(base([line("cs", 2)], {}, { tagsOf: () => ["counterspell"] }));
    expect(p.parts.find((x) => x.key === "interaction")!.points).toBe(1.5);
  });
});
