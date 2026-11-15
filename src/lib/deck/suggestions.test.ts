import { describe, expect, it } from "vitest";
import { entryKey, type CardSummary } from "./model";
import { cleanSuggestion, planSuggestion, readSuggestions, SUGGEST_CARDS_MAX, suggestionError, suggestionSummary } from "./suggestions";

const card = (name: string, extra: Partial<CardSummary> = {}): CardSummary => ({
  oracle_id: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  mana_cost: null,
  mana_value: 0,
  type_line: "Artifact",
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
});
const solRing = card("Sol Ring");
const tithe = card("Smothering Tithe");
const bolt = card("Lightning Bolt");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("readSuggestions", () => {
  it("keeps good rows and drops malformed ones and ids", () => {
    const list = readSuggestions([
      { id: "s1", adds: [A, "nope"], cuts: [B], note: " ", status: "applied", created_at: "2026-11-15T00:00:00Z", author: "Bea", mine: false },
      { adds: [A] },
      "x",
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "s1", adds: [A], cuts: [B], note: null, status: "applied", author: "Bea" });
    expect(readSuggestions(null)).toEqual([]);
    expect(readSuggestions([{ id: "s2", status: "weird" }])[0].status).toBe("open");
  });
});

describe("cleanSuggestion", () => {
  it("dedupes, never adds and cuts the same card, caps, and folds the note", () => {
    expect(cleanSuggestion([A, A], [A, B], "  more\n\n\n\ndraw  ")).toEqual({ adds: [A], cuts: [B], note: "more\n\ndraw" });
    expect(cleanSuggestion([], [], "hi")).toBeNull();
    const many = Array.from({ length: SUGGEST_CARDS_MAX + 5 }, (_, i) => `id-${i}`);
    expect(cleanSuggestion(many, [], "")!.adds).toHaveLength(SUGGEST_CARDS_MAX);
  });
});

describe("planSuggestion", () => {
  const entries = { [entryKey("main", solRing.oracle_id)]: 1, [entryKey("main", bolt.oracle_id)]: 1 };
  it("applies adds and cuts to the mainboard as one change", () => {
    const { plan, done } = planSuggestion(entries, [tithe], [bolt], "apply");
    expect(done).toBe(2);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.change.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ board: "main", oracle_id: tithe.oracle_id, from: 0, to: 1 }),
        expect.objectContaining({ board: "main", oracle_id: bolt.oracle_id, from: 1, to: 0 }),
      ]),
    );
  });
  it("only puts adds on the maybeboard, and skips cards already in the deck", () => {
    const { plan, done, skipped } = planSuggestion(entries, [tithe], [bolt], "maybe");
    expect(done).toBe(1);
    expect(plan.ok && plan.change.rows).toEqual([expect.objectContaining({ board: "maybe", oracle_id: tithe.oracle_id })]);
    const again = planSuggestion(entries, [solRing], [], "apply");
    expect(again.plan.ok).toBe(false);
    expect(again.skipped[0]).toMatch(/already in the deck/);
    expect(skipped).toEqual([]);
  });
});

describe("wording", () => {
  it("summarizes and filters errors", () => {
    expect(suggestionSummary({ adds: [A, B], cuts: [A] })).toBe("2 adds, 1 cut");
    expect(suggestionError("This is your own deck. Edit it directly.", "x")).toMatch(/own deck/);
    expect(suggestionError("function public.suggest_deck_changes does not exist", "Couldn't send.")).toBe("Couldn't send.");
  });
});
