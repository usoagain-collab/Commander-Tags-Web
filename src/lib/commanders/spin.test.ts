import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TagTree } from "@/lib/tags/tree";
import { archetypesFor, leadsFromFront, shownTags, spinCommanders } from "./spin";
import type { Archetype } from "@/lib/cutter/archetypes";

const tree = new TagTree({
  n: 1000,
  art_n: 0,
  tags: [
    ["recursion", "recursion", 500, []], // 0
    ["reanimate", "reanimate", 100, [0]], // 1
    ["reanimate-creature", "reanimate creature", 50, [1]], // 2
    ["token-generator", "token generator", 400, []], // 3
    ["activated-ability", "activated ability", 9000, []], // 4
  ],
});

describe("spin the wheel", () => {
  it("only lets a legendary front face lead", () => {
    expect(leadsFromFront({ type_line: "Legendary Creature — Elf" })).toBe(true);
    expect(leadsFromFront({ type_line: "Creature — Rat Rogue // Legendary Creature — Rat Spirit" })).toBe(false);
  });

  it("names the archetypes a commander's tags point to, strongest first", () => {
    const list: Archetype[] = [
      { key: "general", name: "General", signals: [], curve: [0, 0, 0, 0, 0, 0, 0] },
      { key: "gy", name: "Graveyard", signals: [{ kind: "tags", slugs: ["reanimate"], weight: 3 }], curve: [0, 0, 0, 0, 0, 0, 0] },
      { key: "tok", name: "Tokens", signals: [{ kind: "tags", slugs: ["token-generator"], weight: 2 }], curve: [0, 0, 0, 0, 0, 0, 0] },
    ];
    expect(archetypesFor(["reanimate-creature", "token-generator"], tree, list)).toEqual(["Graveyard", "Tokens"]);
    expect(archetypesFor(["activated-ability"], tree, list)).toEqual([]);
  });

  it("shows gameplay tags deepest first, without ability-kind noise", () => {
    expect(shownTags(["recursion", "reanimate-creature", "activated-ability"], tree)).toEqual(["reanimate-creature", "recursion"]);
  });

  it("returns distinct commanders and skips flip cards and repeats", async () => {
    const cards = [
      { oracle_id: "a", type_line: "Legendary Creature — Elf" },
      { oracle_id: "a", type_line: "Legendary Creature — Elf" },
      { oracle_id: "b", type_line: "Creature — Rat // Legendary Creature — Spirit" },
      { oracle_id: "c", type_line: "Legendary Planeswalker — Teferi" },
      { oracle_id: "d", type_line: "Legendary Creature — Dragon" },
    ];
    let i = 0;
    const query = { select: () => query, eq: () => query, not: () => query, gte: () => query, order: () => query, limit: async () => ({ data: [cards[i++ % cards.length]], error: null }) };
    const supabase = { from: () => query } as unknown as SupabaseClient;
    const picked = await spinCommanders(supabase, { count: 3, random: () => 0.5 });
    expect(picked.map((c) => c.oracle_id)).toEqual(["a", "c", "d"]);
  });
});
