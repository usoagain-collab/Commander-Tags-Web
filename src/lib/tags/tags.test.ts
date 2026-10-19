import { describe, expect, it } from "vitest";
import { isLand, resolveRoles, rolesOf, STANDARD_ROLES } from "./roles";
import { TagTree, type TagTreePayload } from "./tree";

// A tiny tree shaped like the real one (positions are indexes into this list).
const payload: TagTreePayload = {
  n: 1000,
  art_n: 2000,
  tags: [
    ["triggered-ability", "triggered ability", 9000, []], // 0
    ["death-trigger", "death trigger", 590, [0]], // 1
    ["ramp", "ramp", 549, []], // 2
    ["mana-rock", "mana rock", 107, [2]], // 3
    ["removal", "removal", 0, []], // 4
    ["spot-removal", "spot removal", 5511, [4]], // 5
    ["sweeper", "sweeper", 741, [4]], // 6 (board wipes sit under removal in the real data too)
    ["recursion", "recursion", 0, []], // 7
    ["reanimate", "reanimate", 11, [7]], // 8
    ["reanimate-creature", "reanimate creature", 559, [8]], // 9
    ["draw", "draw", 0, []], // 10
    ["card-advantage", "card advantage", 58, []], // 11
    ["consult-onto-battlefield", "consult onto battlefield", 300, [11]], // 12
    ["pure-draw", "pure draw", 900, [10]], // 13
    ["land-ramp", "land ramp", 490, [2]], // 14
  ],
};
const tree = new TagTree(payload);
const roles = resolveRoles(STANDARD_ROLES, tree);

describe("TagTree", () => {
  it("walks up and down the tree", () => {
    expect(tree.ancestors("reanimate-creature").sort()).toEqual(["reanimate", "recursion"]);
    expect([...tree.descendants(["recursion"])].sort()).toEqual(["reanimate", "reanimate-creature", "recursion"]);
  });

  it("measures depth as the longest path, top level = 1", () => {
    expect(tree.depth("recursion")).toBe(1);
    expect(tree.depth("reanimate-creature")).toBe(3);
  });

  it("builds a readable path and sorts deepest first", () => {
    expect(tree.path("death-trigger")).toBe("triggered ability › death trigger");
    expect(tree.sortDeepestFirst(["recursion", "reanimate-creature", "death-trigger"])).toEqual([
      "reanimate-creature",
      "death-trigger",
      "recursion",
    ]);
  });

  it("keeps the theme-score N values", () => {
    expect([tree.n, tree.artN]).toEqual([1000, 2000]);
  });
});

describe("roles", () => {
  const card = (type_line: string, counts_as_land = false) => ({ type_line, counts_as_land });

  it("expands each role to its subtree and reports slugs missing from the data", () => {
    const protection = roles.find((r) => r.key === "protection")!;
    expect(protection.missing).toContain("gives-hexproof"); // not in this tiny tree
    expect(roles.find((r) => r.key === "recursion")!.tagSet!.has("reanimate-creature")).toBe(true);
  });

  it("finds roles from tags anywhere below the role's tag", () => {
    expect(rolesOf(card("Creature — Human Shaman"), ["reanimate-creature", "death-trigger"], roles)).toEqual(["recursion"]);
    expect(rolesOf(card("Artifact"), ["mana-rock"], roles)).toEqual(["ramp"]);
  });

  it("doesn't count a board wipe as targeted removal", () => {
    expect(rolesOf(card("Sorcery"), ["sweeper"], roles)).toEqual(["wipes"]);
    expect(rolesOf(card("Instant"), ["spot-removal"], roles)).toEqual(["removal"]);
  });

  it("puts lands in Lands only, judged by the front face", () => {
    expect(rolesOf(card("Land", true), ["mana-rock"], roles)).toEqual(["lands"]);
    expect(isLand("Instant // Land")).toBe(false);
    expect(isLand("Artifact Land")).toBe(true);
  });

  it("counts a spell // land MDFC as a land AND for its spell roles", () => {
    // Sink into Stupor // Soporific Springs: counts_as_land comes from the card_summaries view.
    expect(rolesOf(card("Instant // Land", true), ["spot-removal"], roles)).toEqual(["lands", "removal"]);
  });

  it("doesn't count a card that only transforms into a land", () => {
    // Legion's Landing // Adanto: counts_as_land is false for transform cards.
    expect(rolesOf(card("Legendary Enchantment // Legendary Land", false), [], roles)).toEqual([]);
  });

  it("counts a land-fetching 'onto the battlefield' card as Ramp only", () => {
    // Clifftop Lookout: consult-onto-battlefield (under card advantage) + land-ramp.
    expect(rolesOf(card("Creature — Frog Scout"), ["consult-onto-battlefield", "land-ramp"], roles)).toEqual(["ramp"]);
  });

  it("still counts a ramp card that really draws for both", () => {
    // Uro: pure-draw + land-ramp.
    expect(rolesOf(card("Legendary Creature — Elder Giant"), ["pure-draw", "land-ramp"], roles)).toEqual(["ramp", "draw"]);
  });

  it("keeps 'onto the battlefield' as card advantage when the card isn't ramp", () => {
    expect(rolesOf(card("Sorcery"), ["consult-onto-battlefield"], roles)).toEqual(["draw"]);
  });

  it("returns no roles for an untagged card", () => {
    expect(rolesOf(card("Creature — Bear"), undefined, roles)).toEqual([]);
  });
});
