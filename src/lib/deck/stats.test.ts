import { describe, expect, it } from "vitest";
import type { CardSummary, DeckLine } from "./model";
import { colorBalance, manaCurve, pipsOf, typeCounts } from "./stats";

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

const krasis = line("Hydroid Krasis", { mana_cost: "{X}{G}{U}", mana_value: 2, type_line: "Creature — Jellyfish Hydra Beast" });
const reach = line("Kodama's Reach", { mana_cost: "{2}{G}", mana_value: 3, type_line: "Sorcery" });
const sink = line("Sink into Stupor // Soporific Springs", {
  mana_cost: "{1}{U}{U} // ",
  mana_value: 3,
  type_line: "Instant // Land",
  layout: "modal_dfc",
  counts_as_land: true,
  produced_mana: ["U"],
});
const pool = line("Breeding Pool", { type_line: "Land — Forest Island", counts_as_land: true, produced_mana: ["G", "U"] });
const forest = line("Forest", { type_line: "Basic Land — Forest", counts_as_land: true, produced_mana: ["G"] }, 10);
const wilds = line("Evolving Wilds", { type_line: "Land", counts_as_land: true, produced_mana: [] });
const overseer = line("Steel Overseer", { mana_cost: "{2}", mana_value: 2, type_line: "Artifact Creature — Construct" });
const deck = [krasis, reach, sink, pool, forest, wilds, overseer];

describe("pipsOf", () => {
  it("counts colored symbols on the front face, hybrid for both colors", () => {
    expect(pipsOf("{X}{G}{U}")).toEqual({ G: 1, U: 1 });
    expect(pipsOf("{G/U}{G/P}{2/W}{C}")).toEqual({ G: 2, U: 1, W: 1 });
    expect(pipsOf("{1}{U}{U} // {3}{G}")).toEqual({ U: 2 });
    expect(pipsOf(null)).toEqual({});
  });
});

describe("manaCurve", () => {
  it("buckets spells by mana value, splitting creatures, and averages them", () => {
    const c = manaCurve(deck);
    expect(c.spells).toBe(4); // Krasis, Reach, Sink (an MDFC spell), Overseer
    expect(c.buckets[2]).toMatchObject({ creatures: 2, other: 0 });
    expect(c.buckets[3]).toMatchObject({ creatures: 0, other: 2 });
    expect(c.average).toBe(2.5);
  });
});

describe("colorBalance", () => {
  it("compares pips with land sources for the deck's colors", () => {
    const b = colorBalance(deck, new Set(["G", "U"]));
    expect(b.rows.map((r) => [r.color, r.pips, r.sources])).toEqual([
      ["U", 3, 2],
      ["G", 2, 11],
    ]);
    expect(b.rows[0].pipShare).toBeCloseTo(0.6);
    expect(b.rows[1].sourceShare).toBeCloseTo(11 / 13);
    expect(b.lands).toBe(13);
    expect(b.colorlessLands).toBe(1);
  });
});

describe("typeCounts", () => {
  it("counts every type a card has", () => {
    expect(typeCounts(deck)).toEqual([
      { type: "Creature", count: 2 },
      { type: "Artifact", count: 1 },
      { type: "Sorcery", count: 1 },
      { type: "Instant", count: 1 },
      { type: "Land", count: 12 },
    ]);
  });
});
