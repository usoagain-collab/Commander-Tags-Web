import { describe, expect, it } from "vitest";
import type { CardSummary, DeckLine } from "@/lib/deck/model";
import { bandWords, bracketRolesOf, estimatePower, POWER, type PowerInput } from "./power";
import { TagTree } from "@/lib/tags/tree";

const line = (id: string, mv: number, over: Partial<CardSummary> = {}, quantity = 1, board: DeckLine["board"] = "main"): DeckLine => ({
  board,
  quantity,
  card: { oracle_id: id, name: id, mana_value: mv, type_line: "Sorcery", game_changer: false, edhrec_rank: null, ...over } as CardSummary,
});

const base = (lines: DeckLine[], roles: Record<string, string[]> = {}, over: Partial<PowerInput> = {}): PowerInput => ({
  lines,
  rolesOf: (l) => roles[l.card.oracle_id] ?? [],
  tagsOf: () => [],
  estimate: { floor: 1, findings: [] },
  ...over,
});

const pts = (p: ReturnType<typeof estimatePower>) => Object.fromEntries(p.parts.map((x) => [x.key, x.points]));

const tree = (tags: [string, number[]][]) =>
  new TagTree({ n: 1000, art_n: 1000, tags: tags.map(([s, parents]) => [s, s, 10, parents]) } as unknown as ConstructorParameters<typeof TagTree>[0]);

describe("refined bracket estimate", () => {
  it("describes the bands from the constants", () => {
    expect(bandWords()).toBe("Under 10 plays like 1, 10-49 like 2, 50-69 like 3, 70+ like 4.");
  });

  it("has Speed and five parts that add up to 100", () => {
    const p = estimatePower(base([line("a", 3)]));
    expect(p.parts.map((x) => x.key)).toEqual(["speed", "consistency", "interaction", "resilience", "quality", "commander"]);
    expect(p.parts.reduce((n, x) => n + x.max, 0)).toBe(100);
    expect(POWER.consistency.max + POWER.interaction.max + POWER.resilience.max + POWER.quality.max + POWER.commander.max).toBe(60);
  });

  it("scores a slow, unfocused deck low", () => {
    const lines = Array.from({ length: 60 }, (_, i) => line(`c${i}`, 5));
    const p = estimatePower(base(lines));
    expect(p.score).toBeLessThan(10);
    expect(p.playsLike).toBe(1);
    expect(p.speed).toBeNull();
  });

  it("weighs tutors by cost, with half value past six", () => {
    const cheap = Array.from({ length: 4 }, (_, i) => line(`t${i}`, 1));
    const dear = Array.from({ length: 4 }, (_, i) => line(`d${i}`, 4));
    const roles = Object.fromEntries([...cheap, ...dear].map((l) => [l.card.oracle_id, ["tutors"]]));
    const p = estimatePower(base([...cheap, ...dear], roles));
    // 4 x 1.0 + 2 x 0.4 at full value, then 2 x 0.4 at half: 5.2 units x 0.75 = 3.9
    expect(p.parts.find((x) => x.key === "consistency")!.detail).toContain("8 tutors (3.9)");
  });

  it("counts free and cheap interaction above expensive removal, and stax up to 5", () => {
    const t = tree([["tax", []], ["hatebear", []]]);
    const lines = [
      line("Force of Will", 5, { name: "Force of Will" }),
      line("bolt", 1, { instant_speed: true }),
      line("slow", 5),
      line("wrath", 4),
      ...Array.from({ length: 7 }, (_, i) => line(`stax${i}`, 2, { type_line: "Creature — Human" })),
    ];
    const roles: Record<string, string[]> = { "Force of Will": ["removal"], bolt: ["removal"], slow: ["removal"], wrath: ["wipes"] };
    const p = estimatePower(base(lines, roles, { tagsOf: (id) => (id.startsWith("stax") ? ["hatebear"] : []), tree: t }));
    const part = p.parts.find((x) => x.key === "interaction")!;
    // 1.5 free + 1.15 instant + 0.25 slow = 2.9; wipe 0.5; stax 7 pieces capped at 5
    expect(part.points).toBe(8.4);
    expect(part.detail).toContain("1 of them free");
    expect(part.detail).toContain("slows the table: 7 stax pieces (5)");
  });

  it("scores resilience from protection, recursion, rebuilding and a cheap commander", () => {
    const lines = [line("cmd", 3, { type_line: "Legendary Creature — Elf" }, 1, "commander"), line("boots", 1, { type_line: "Artifact" }), line("raise", 2)];
    const p = estimatePower(base(lines, { boots: ["protection"], raise: ["recursion"] }));
    expect(pts(p).resilience).toBe(2.3); // 0.75 + 0.5 + 1, shown to one decimal
  });

  it("scores card quality from EDHREC rank and Game Changers", () => {
    const lines = [
      ...Array.from({ length: 6 }, (_, i) => line(`top${i}`, 2, { edhrec_rank: 100 + i })),
      ...Array.from({ length: 4 }, (_, i) => line(`low${i}`, 2, { edhrec_rank: 20000 })),
      line("gc", 2, { game_changer: true, edhrec_rank: 50 }),
    ];
    const p = estimatePower(base(lines));
    const part = p.parts.find((x) => x.key === "quality")!;
    expect(part.detail).toContain("64% of nonland cards");
    expect(part.points).toBe(8 + 0.5);
  });

  it("gives the commander points for what it does by itself", () => {
    const lines = [line("kinnan", 2, { name: "Kinnan", type_line: "Legendary Creature — Human" }, 1, "commander"), line("x", 3)];
    const p = estimatePower(base(lines, { kinnan: ["ramp", "draw"] }));
    const part = p.parts.find((x) => x.key === "commander")!;
    expect(part.points).toBe(6);
    expect(part.detail).toContain("Kinnan makes mana (3)");
  });

  it("never goes below the floor, and says which part would lift the points", () => {
    const p = estimatePower(base([line("a", 5)], {}, { estimate: { floor: 3, findings: [] } }));
    expect(p.playsLike).toBe(3);
    expect(p.whyNotHigher).toBeNull(); // the rules floor decides, not the points
    const q = estimatePower(base([line("a", 5)]));
    expect(q.playsLike).toBe(1);
    expect(q.whyNotHigher).toMatch(/more points would make it play like 2; Speed has the most room/);
  });

  it("finds tutors from card tags alone, whatever the deck's role settings", () => {
    // tutor > tutor-creature; tutor > tutor-land > tutor-land-basic (land tutors are Ramp, not Tutors)
    const t = new TagTree({
      n: 1000,
      art_n: 1000,
      tags: [
        ["tutor", "tutor", 0, []],
        ["tutor-creature", "tutor creature", 50, [0]],
        ["tutor-land", "tutor land", 0, [0]],
        ["tutor-land-basic", "tutor land basic", 80, [2]],
        ["ramp", "ramp", 500, []],
      ],
    } as unknown as ConstructorParameters<typeof TagTree>[0]);
    const tagsOf = (id: string) => ({ worldly: ["tutor-creature"], cultivate: ["tutor-land-basic", "ramp"] })[id] ?? [];
    const rolesOf = bracketRolesOf(t, tagsOf);
    expect(rolesOf(line("worldly", 1))).toContain("tutors");
    expect(rolesOf(line("cultivate", 3))).not.toContain("tutors");
    const p = estimatePower(base([line("worldly", 1), line("cultivate", 3)], {}, { rolesOf, tagsOf }));
    expect(p.parts.find((x) => x.key === "consistency")!.cards).toEqual(["worldly"]);
  });
});
