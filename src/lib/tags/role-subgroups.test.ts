import { describe, expect, it } from "vitest";
import { assignSubgroups, landSubgroup, subgroupCandidates, subgroupTitle } from "./role-subgroups";
import { resolveRoles, STANDARD_ROLES } from "./roles";
import { TagTree } from "./tree";

// ramp > mana-rock > utility-mana-rock; ramp > mana-dork; ramp > cost-reduction; land-ramp (its own root);
// draw > pure-draw; card-advantage > impulse
const tree = new TagTree({
  n: 1000,
  art_n: 1000,
  tags: [
    ["ramp", "ramp", 549, []], // 0
    ["mana-rock", "mana rock", 107, [0]], // 1
    ["utility-mana-rock", "utility mana rock", 30, [1]], // 2
    ["mana-dork", "mana dork", 454, [0]], // 3
    ["cost-reduction", "cost reduction", 200, [0]], // 4
    ["land-ramp", "land ramp", 490, []], // 5
    ["draw", "draw", 0, []], // 6
    ["pure-draw", "pure draw", 900, [6]], // 7
    ["card-advantage", "card advantage", 58, []], // 8
    ["impulse", "impulse", 300, [8]], // 9
  ],
});
const roles = resolveRoles(STANDARD_ROLES, tree);
const ramp = roles.find((r) => r.key === "ramp")!;
const draw = roles.find((r) => r.key === "draw")!;

describe("subgroupCandidates", () => {
  it("uses the role's own named tags (mana rock, mana dork, land ramp) as subgroups", () => {
    expect(subgroupCandidates(["utility-mana-rock"], ramp, tree)).toEqual(["mana-rock"]);
    expect(subgroupCandidates(["mana-dork"], ramp, tree)).toEqual(["mana-dork"]);
    expect(subgroupCandidates(["land-ramp"], ramp, tree)).toEqual(["land-ramp"]);
  });

  it("otherwise uses the first branch under the main tag, or the main tag itself", () => {
    expect(subgroupCandidates(["cost-reduction"], ramp, tree)).toEqual(["cost-reduction"]);
    expect(subgroupCandidates(["ramp"], ramp, tree)).toEqual(["ramp"]);
    expect(subgroupCandidates(["impulse"], draw, tree)).toEqual(["impulse"]);
    expect(subgroupCandidates(["pure-draw"], draw, tree)).toEqual(["draw"]);
  });

  it("ignores tags outside the role", () => {
    expect(subgroupCandidates(["pure-draw"], ramp, tree)).toEqual([]);
  });
});

describe("assignSubgroups", () => {
  it("puts each card in its most popular candidate and folds single-card groups into Other", () => {
    const m = assignSubgroups([
      { id: "sol", candidates: ["mana-rock"] },
      { id: "signet", candidates: ["mana-rock"] },
      { id: "birds", candidates: ["mana-dork"] },
      { id: "noble", candidates: ["mana-dork"] },
      { id: "elves", candidates: ["mana-dork", "mana-rock"] }, // mana-rock and mana-dork tie at 3: alphabetical wins
      { id: "cultivate", candidates: ["land-ramp"] }, // alone -> Other
    ]);
    expect(Object.fromEntries(m)).toEqual({
      sol: "mana-rock",
      signet: "mana-rock",
      birds: "mana-dork",
      noble: "mana-dork",
      elves: "mana-dork",
      cultivate: null,
    });
  });

  it("doesn't split when there would be fewer than two real subgroups", () => {
    expect(assignSubgroups([{ id: "a", candidates: ["x"] }, { id: "b", candidates: ["x"] }, { id: "c", candidates: ["y"] }]).size).toBe(0);
  });
});

describe("lands and titles", () => {
  it("splits lands into basic, nonbasic and MDFCs", () => {
    expect(landSubgroup({ type_line: "Basic Land — Forest" }).title).toBe("Basic lands");
    expect(landSubgroup({ type_line: "Land — Forest Island" }).title).toBe("Nonbasic lands");
    expect(landSubgroup({ type_line: "Instant // Land", counts_as_land: true }).title).toBe("MDFCs");
  });

  it("makes a readable heading", () => {
    expect(subgroupTitle("mana-rock", tree)).toBe("Mana rock");
  });
});
