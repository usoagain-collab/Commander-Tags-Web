import { describe, expect, it } from "vitest";
import { cardRecord, cleanGame, localToday, summarize, type DeckGame } from "./game-log";

const game = (over: Partial<DeckGame> = {}): DeckGame => ({
  id: "g",
  played_on: "2026-11-10",
  result: "win",
  pod_size: 4,
  opponents: null,
  note: null,
  standouts: [],
  flops: [],
  ...over,
});

describe("cleanGame", () => {
  it("trims text, checks the pod size and keeps a card out of both lists", () => {
    const g = cleanGame({ ...game(), opponents: "  Atraxa,\n Krenko ", pod_size: 12, standouts: ["a", "a", "b"], flops: ["b", "c"] }, "2026-11-15");
    expect(g).toMatchObject({ opponents: "Atraxa, Krenko", pod_size: null, standouts: ["a", "b"], flops: ["c"] });
  });
  it("won't take a date in the future or an unknown result", () => {
    const g = cleanGame({ ...game(), played_on: "2027-01-01", result: "maybe" as never }, "2026-11-15");
    expect(g).toMatchObject({ played_on: "2026-11-15", result: "loss" });
  });
});

describe("summarize", () => {
  it("counts results and the win rate", () => {
    expect(summarize([game(), game({ result: "loss" }), game({ result: "draw" }), game()])).toEqual({ games: 4, wins: 2, losses: 1, draws: 1, winRate: 0.5 });
    expect(summarize([]).winRate).toBeNull();
  });
});

describe("cardRecord", () => {
  it("tallies standouts and flops, most mentioned first", () => {
    const r = cardRecord([game({ standouts: ["a"], flops: ["b"] }), game({ standouts: ["a"] }), game({ flops: ["c", "b"] })]);
    expect(r).toEqual([
      { oracle_id: "b", stood: 0, flopped: 2 },
      { oracle_id: "a", stood: 2, flopped: 0 },
      { oracle_id: "c", stood: 0, flopped: 1 },
    ]);
  });
});

describe("localToday", () => {
  it("gives a date", () => expect(localToday(new Date("2026-11-15T12:00:00Z"))).toMatch(/^2026-11-1[45]$/));
});
