import { describe, expect, it } from "vitest";
import { groupLines, readViewSettings, sortLines } from "./grouping";
import type { CardSummary, DeckLine } from "./model";

const line = (name: string, extra: Partial<CardSummary> = {}, quantity = 1): DeckLine => ({
  board: "main",
  quantity,
  card: {
    oracle_id: name,
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
  },
});

const sol = line("Sol Ring", { mana_value: 1, price_usd: 2 });
const forest = line("Forest", { type_line: "Basic Land — Forest" }, 30);
const witness = line("Eternal Witness", { type_line: "Creature — Human Shaman", mana_value: 3, color_identity: ["G"], price_usd: 3 });
const pucas = line("Putrefy", { type_line: "Instant", mana_value: 3, color_identity: ["B", "G"], price_usd: 0.5 });
const big = line("Craterhoof Behemoth", { type_line: "Creature — Beast", mana_value: 8, color_identity: ["G"], price_usd: 40 });
const deck = [sol, forest, witness, pucas, big];
const summary = (g: ReturnType<typeof groupLines>) => g.map((s) => `${s.title}:${s.count}`);

describe("grouping", () => {
  it("by type: creatures, artifacts, enchantments, sorceries, instants, then lands at the bottom", () => {
    expect(summary(groupLines(deck, "type", "name"))).toEqual(["Creature:2", "Artifact:1", "Instant:1", "Land:30"]);
  });

  it("by mana value, capping at 7+ and putting lands last", () => {
    expect(summary(groupLines(deck, "mv", "name"))).toEqual(["Mana value 1:1", "Mana value 3:2", "Mana value 7+:1", "Lands:30"]);
  });

  it("by color identity: mono colors, then multicolor, colorless, lands", () => {
    expect(summary(groupLines(deck, "color", "name"))).toEqual(["Green:2", "Multicolor:1", "Colorless:1", "Lands:30"]);
  });

  it("by role: roles in order, then Other, then Lands at the bottom", () => {
    const roles = {
      roleOrder: [
        { key: "lands", name: "Lands" },
        { key: "ramp", name: "Ramp" },
        { key: "recursion", name: "Recursion" },
      ],
      rolesOf: (l: DeckLine) =>
        ({ Forest: ["lands"], "Sol Ring": ["ramp"], "Eternal Witness": ["recursion"] })[l.card.name] ?? [],
    };
    expect(summary(groupLines(deck, "role", "name", roles))).toEqual(["Ramp:1", "Recursion:1", "Other:2", "Lands:30"]);
  });
});

describe("sorting", () => {
  it("by name, mana value (then name), or price (highest first)", () => {
    expect(sortLines(deck, "name").map((l) => l.card.name)[0]).toBe("Craterhoof Behemoth");
    expect(sortLines([witness, pucas, sol], "mv").map((l) => l.card.name)).toEqual(["Sol Ring", "Eternal Witness", "Putrefy"]);
    expect(sortLines(deck, "price").map((l) => l.card.name)).toEqual([
      "Craterhoof Behemoth",
      "Eternal Witness",
      "Sol Ring",
      "Putrefy",
      "Forest", // no price sorts last
    ]);
  });
});

describe("saved view settings", () => {
  it("falls back to defaults for missing or unknown values", () => {
    expect(readViewSettings(null)).toEqual({ view: "text", group: "type", sort: "mv" });
    expect(readViewSettings({ view: "grid", group: "bogus" })).toEqual({ view: "grid", group: "type", sort: "mv" });
  });
});

describe("role subgroups", () => {
  const rampA = line("Sol Ring", { mana_value: 1 });
  const rampB = line("Arcane Signet", { mana_value: 2 });
  const rampC = line("Birds of Paradise", { type_line: "Creature — Bird", mana_value: 1 });
  const rampD = line("Llanowar Elves", { type_line: "Creature — Elf Druid", mana_value: 1 });
  const rampE = line("Cultivate", { type_line: "Sorcery", mana_value: 3 });
  const sub: Record<string, { key: string; title: string } | null> = {
    "Sol Ring": { key: "mana-rock", title: "Mana rock" },
    "Arcane Signet": { key: "mana-rock", title: "Mana rock" },
    "Birds of Paradise": { key: "mana-dork", title: "Mana dork" },
    "Llanowar Elves": { key: "mana-dork", title: "Mana dork" },
    Cultivate: null,
  };
  const roles = {
    roleOrder: [{ key: "ramp", name: "Ramp" }],
    rolesOf: () => ["ramp"],
    subgroupOf: (l: DeckLine) => sub[l.card.name],
  };

  it("splits a role into subgroups under it, biggest first, Other last", () => {
    const g = groupLines([rampA, rampB, rampC, rampD, rampE], "role", "name", roles);
    expect(g.map((s) => `${s.parent?.title} › ${s.title}:${s.count}`)).toEqual([
      "Ramp › Mana dork:2",
      "Ramp › Mana rock:2",
      "Ramp › Other ramp:1",
    ]);
    expect(g[0].parent).toEqual({ key: "ramp", title: "Ramp", count: 5 });
  });

  it("doesn't split a role that would only have one subgroup", () => {
    const g = groupLines([rampA, rampB], "role", "name", roles);
    expect(g.map((s) => s.title)).toEqual(["Ramp"]);
  });
});
