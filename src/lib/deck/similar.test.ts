import { describe, expect, it } from "vitest";
import { rankSimilar, type SimilarCandidate } from "./similar";
import type { CompareRow } from "./compare";

const row = (oracle_id: string, quantity = 1, board: CompareRow["board"] = "main"): CompareRow => ({ oracle_id, board, quantity });
const deck = (id: string, cards: string[], updated_at = "2026-11-01", extra: CompareRow[] = []): SimilarCandidate => ({
  id,
  name: id,
  precon: false,
  updated_at,
  rows: [...cards.map((c) => row(c)), ...extra],
});
const isBasic = (id: string) => id === "forest";
const mine = [row("cmd", 1, "commander"), row("a"), row("b"), row("c"), row("d"), row("forest", 30)];

describe("rankSimilar", () => {
  it("puts the deck sharing the most of my cards first", () => {
    const out = rankSimilar(mine, [deck("few", ["cmd", "a"]), deck("many", ["cmd", "a", "b", "c"])], isBasic);
    expect(out.map((d) => d.id)).toEqual(["many", "few"]);
    expect(out[0]).toMatchObject({ shared: 4, overlap: 4 / 5 });
  });

  it("ignores basic lands and the maybeboard", () => {
    const out = rankSimilar(mine, [deck("lands", [], "2026-11-01", [row("forest", 36), row("a", 1, "maybe")])], isBasic);
    expect(out).toEqual([]);
  });

  it("breaks ties by the newest change and keeps to the limit", () => {
    const out = rankSimilar(mine, [deck("old", ["a"], "2026-10-01"), deck("new", ["b"], "2026-11-10"), deck("mid", ["c"], "2026-11-05")], isBasic, 2);
    expect(out.map((d) => d.id)).toEqual(["new", "mid"]);
  });
});
