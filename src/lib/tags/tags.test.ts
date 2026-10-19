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
  it("expands each role to its subtree and reports slugs missing from the data", () => {
    const protection = roles.find((r) => r.key === "protection")!;
    expect(protection.missing).toContain("gives-hexproof"); // not in this tiny tree
    expect(roles.find((r) => r.key === "recursion")!.tagSet!.has("reanimate-creature")).toBe(true);
  });

  it("finds roles from tags anywhere below the role's tag", () => {
    expect(rolesOf("Creature — Human Shaman", ["reanimate-creature", "death-trigger"], roles)).toEqual(["recursion"]);
    expect(rolesOf("Artifact", ["mana-rock"], roles)).toEqual(["ramp"]);
  });

  it("doesn't count a board wipe as targeted removal", () => {
    expect(rolesOf("Sorcery", ["sweeper"], roles)).toEqual(["wipes"]);
    expect(rolesOf("Instant", ["spot-removal"], roles)).toEqual(["removal"]);
  });

  it("puts lands in Lands only, judged by the front face", () => {
    expect(rolesOf("Land", ["mana-rock"], roles)).toEqual(["lands"]);
    expect(isLand("Instant // Land")).toBe(false);
    expect(isLand("Artifact Land")).toBe(true);
  });

  it("returns no roles for an untagged card", () => {
    expect(rolesOf("Creature — Bear", undefined, roles)).toEqual([]);
  });
});
