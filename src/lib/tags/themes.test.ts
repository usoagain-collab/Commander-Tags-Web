import { describe, expect, it } from "vitest";
import {
  artTreeFrom,
  cardKeys,
  deckKeyCounts,
  isFlavorOracle,
  readThemeSettings,
  themeOk,
  themeTags,
  treeCard,
  type ThemeCard,
  type ThemeSettings,
} from "./themes";
import { TagTree } from "./tree";

// A tiny oracle tree: triggered ability > death trigger; landfall; ramp; plus noise and flavor tags.
const oracle = new TagTree({
  n: 1000,
  art_n: 5000,
  tags: [
    ["triggered-ability", "triggered ability", 9000, []], // 0
    ["death-trigger", "death trigger", 590, [0]], // 1
    ["landfall", "landfall", 300, []], // 2
    ["ramp", "ramp", 549, []], // 3
    ["keyword-ability", "keyword ability", 8000, []], // 4 (noise)
    ["alliteration", "alliteration", 400, []], // 5 (flavor)
    ["cycle-c15-commander", "cycle-c15-commander", 10, []], // 6 (cycle)
    ["lands-matter", "lands matter", 200, []], // 7
  ],
});
// Art: frog > amphibian; plus a huge generic tag.
const art = artTreeFrom(
  [
    ["frog", "frog", 157, ["amphibian"]],
    ["amphibian", "amphibian", 4, []],
    ["sky", "sky", 4000, []], // 4000 > 5000 × 4%: too generic
  ],
  5000,
);
const trees = { oracle, art };
const settings = (s: Partial<ThemeSettings> = {}): ThemeSettings => ({ mode: "gameplay", specific: true, sortBy: "relevance", ...s });
const card = (oracle: string[], extra: Partial<ThemeCard> = {}): ThemeCard => ({ oracle, art: [], commander: false, land: false, ...extra });
const none = new Set<string>();

describe("themeOk", () => {
  it("drops mechanic noise and cycle tags, and splits gameplay from flavor", () => {
    expect(themeOk("o:keyword-ability", "gameplay", trees, none)).toBe(false);
    expect(themeOk("o:cycle-c15-commander", "gameplay", trees, none)).toBe(false);
    expect(themeOk("o:alliteration", "gameplay", trees, none)).toBe(false);
    expect(themeOk("o:alliteration", "flavor", trees, none)).toBe(true);
    expect(themeOk("o:landfall", "flavor", trees, none)).toBe(false);
  });

  it("shows art tags only in Flavor, and not when they're too generic", () => {
    expect(themeOk("a:frog", "gameplay", trees, none)).toBe(false);
    expect(themeOk("a:frog", "flavor", trees, none)).toBe(true);
    expect(themeOk("a:sky", "flavor", trees, none)).toBe(false);
  });

  it("respects hidden tags", () => {
    expect(themeOk("o:landfall", "gameplay", trees, new Set(["o:landfall"]))).toBe(false);
  });

  it("recognizes name and wording tags as flavor", () => {
    expect(isFlavorOracle({ slug: "pun-name", label: "pun name" })).toBe(true);
    expect(isFlavorOracle({ slug: "landfall", label: "landfall" })).toBe(false);
  });
});

describe("themeTags", () => {
  const deck = [
    card(["landfall", "death-trigger"], { commander: true }),
    card(["landfall"]),
    card(["landfall", "lands-matter"]),
    card(["death-trigger"]),
    card(["lands-matter"]),
    card(["ramp", "landfall"]), // ramp is a role tag: never a theme
    card(["landfall"], { land: true }), // lands don't count
  ];

  it("counts nonland cards, doubles the commander, pins its tags and skips role tags", () => {
    const t = themeTags(deck, { settings: settings(), trees, roleTags: new Set(["ramp"]), hidden: none });
    const landfall = t.find((x) => x.slug === "landfall")!;
    expect(landfall.count).toBe(5); // commander 2 + three others
    expect(landfall.pinned).toBe(true);
    expect(t.some((x) => x.slug === "ramp")).toBe(false);
    expect(t.map((x) => x.pinned)).toEqual([true, true, false]); // pinned first
  });

  it("scores count × ln(1 + N / size)", () => {
    const t = themeTags(deck, { settings: settings(), trees, roleTags: none, hidden: none });
    const lm = t.find((x) => x.slug === "lands-matter")!;
    expect(lm.score).toBeCloseTo(2 * Math.log(1 + 1000 / 200));
  });

  it("drops tags on only one card unless the commander has them", () => {
    const t = themeTags([card(["landfall"]), card(["ramp"])], { settings: settings(), trees, roleTags: none, hidden: none });
    expect(t).toEqual([]);
  });

  it("Broad rolls tags up to their parents; Specific keeps every tag exactly as applied", () => {
    const broad = themeTags(deck, { settings: settings({ specific: false }), trees, roleTags: none, hidden: none });
    expect(broad.some((x) => x.slug === "triggered-ability")).toBe(true);
    const specific = themeTags(deck, { settings: settings(), trees, roleTags: none, hidden: none });
    expect(specific.some((x) => x.slug === "triggered-ability")).toBe(false);
    expect(specific.some((x) => x.slug === "death-trigger")).toBe(true); // never dropped in Specific
  });

  it("Specific lists the deepest tags first (after pinned ones)", () => {
    const t = themeTags([card(["death-trigger"]), card(["death-trigger"]), card(["lands-matter"]), card(["lands-matter"])], {
      settings: settings(),
      trees,
      roleTags: none,
      hidden: none,
    });
    expect(t.map((x) => x.slug)).toEqual(["death-trigger", "lands-matter"]); // depth 2 before depth 1
  });

  it("Count sorts by raw hits", () => {
    const deck2 = [card(["death-trigger", "lands-matter"]), card(["death-trigger", "lands-matter"]), card(["death-trigger"])];
    const t = themeTags(deck2, { settings: settings({ sortBy: "count", specific: false }), trees, roleTags: none, hidden: none });
    expect(t[0].slug).toBe("death-trigger");
  });

  it("Flavor shows art tags and rolls them up in Broad", () => {
    const frogs = [card([], { art: ["frog"] }), card([], { art: ["frog"] })];
    const t = themeTags(frogs, { settings: settings({ mode: "flavor", specific: false }), trees, roleTags: none, hidden: none });
    expect(t.map((x) => x.key).sort()).toEqual(["a:amphibian", "a:frog"]);
  });
});

describe("tag tree card", () => {
  it("shows parents, the tag, then sub-tags with in-deck counts", () => {
    const cards = [card(["death-trigger"]), card(["death-trigger"]), card(["triggered-ability"])];
    const tc = treeCard("o:triggered-ability", trees, deckKeyCounts(cards))!;
    expect(tc.rows.map((r) => [r.label, r.count, !!r.self])).toEqual([
      ["triggered ability", 1, true],
      ["death trigger", 2, false],
    ]);
  });

  it("broad keys include ancestors", () => {
    expect(cardKeys(card(["death-trigger"]), false, trees).sort()).toEqual(["o:death-trigger", "o:triggered-ability"]);
  });
});

describe("saved settings", () => {
  it("reads defaults and saved values", () => {
    expect(readThemeSettings(null)).toEqual({ mode: "gameplay", specific: true, sortBy: "relevance" });
    expect(readThemeSettings({ tagMode: "flavor", tagSpecific: false, tagSort: "count" })).toEqual({
      mode: "flavor",
      specific: false,
      sortBy: "count",
    });
  });
});
