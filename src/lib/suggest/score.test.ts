import { describe, expect, it } from "vitest";
import type { ThemeTag } from "@/lib/tags/themes";
import { DEFAULT_SUGGEST, pickStaples, popularity, readSuggestSettings, scorePool, type PoolCard, type SuggestSettings } from "./score";

const card = (name: string, tags: string[], rank: number | null, price: number | null = 1): PoolCard => ({
  oracle_id: name,
  name,
  mana_cost: null,
  mana_value: 2,
  type_line: "Creature",
  color_identity: ["G"],
  image_normal: null,
  image_art_crop: null,
  price_usd: price,
  edhrec_rank: rank,
  commander_legal: true,
  game_changer: false,
  max_copies: 1,
  can_be_commander: false,
  layout: "normal",
  counts_as_land: false,
  tags,
});
const theme = (slug: string, score: number): ThemeTag => ({
  key: `o:${slug}`,
  kind: "o",
  slug,
  label: slug,
  size: 10,
  count: 3,
  pinned: false,
  score,
  depth: 1,
});

const themes = [theme("sacrifice-outlet", 6), theme("death-trigger", 3), theme("token-maker", 1)];
const pool = [
  card("Popular off-theme", ["ramp"], 5), // fit 0, very popular
  card("On-theme staple", ["sacrifice-outlet", "death-trigger"], 300), // best fit, popular
  card("On-theme gem", ["sacrifice-outlet", "death-trigger"], 18000, 0.3), // best fit, rarely played
  card("Half fit", ["token-maker"], 1000, 25),
];
const ctx = (settings: Partial<SuggestSettings> = {}, extra: Partial<Parameters<typeof scorePool>[1]> = {}) => ({
  themes,
  keysOf: (c: PoolCard) => c.tags.map((t) => `o:${t}`),
  rolesOf: (c: PoolCard) => (c.tags.includes("ramp") ? ["ramp"] : []),
  under: new Set<string>(),
  settings: { ...DEFAULT_SUGGEST, ...settings },
  ...extra,
});

describe("popularity", () => {
  it("maps EDHREC rank to 0..1, unranked = 0", () => {
    expect(popularity(1)).toBeCloseTo(1);
    expect(popularity(10000)).toBe(0.5);
    expect(popularity(50000)).toBe(0);
    expect(popularity(null)).toBe(0);
  });
});

describe("scorePool", () => {
  it("Best fit: shared theme weight first, popularity breaks the tie", () => {
    const r = scorePool(pool, ctx());
    expect(r.map((x) => x.card.name).slice(0, 2)).toEqual(["On-theme staple", "On-theme gem"]);
    expect(r[0].fit).toBe(1);
    expect(r[0].shared.map((t) => t.slug)).toEqual(["sacrifice-outlet", "death-trigger"]);
  });

  it("Hidden gems: less-played ranks higher, and only cards sharing 2+ theme tags qualify", () => {
    const r = scorePool(pool, ctx({ style: "gems" }));
    expect(r[0].card.name).toBe("On-theme gem");
    expect(r.map((x) => x.card.name)).not.toContain("Popular off-theme");
    expect(r.map((x) => x.card.name)).not.toContain("Half fit"); // shares only one tag
  });

  it("an under-target role adds 0.12 to fit", () => {
    const r = scorePool(pool, ctx({}, { under: new Set(["ramp"]) }));
    const ramp = r.find((x) => x.card.name === "Popular off-theme")!;
    expect(ramp.fills).toEqual(["ramp"]);
    expect(ramp.fit).toBeCloseTo(0.12);
  });

  it("Budget hides cards over the price cap", () => {
    const r = scorePool(pool, ctx({ style: "budget", priceCap: 5 }));
    expect(r.map((x) => x.card.name)).not.toContain("Half fit");
  });

  it("Custom: negative popularity weight favors less-played cards", () => {
    const r = scorePool(pool, ctx({ style: "custom", weights: { fit: 0.5, pop: -0.5, price: 0 } }));
    expect(r[0].card.name).toBe("On-theme gem");
  });

  it("leaves out dismissed cards", () => {
    const r = scorePool(pool, ctx({}, { dismissed: new Set(["On-theme staple"]) }));
    expect(r.map((x) => x.card.name)).not.toContain("On-theme staple");
  });
});

describe("role mode (💡 on a role)", () => {
  const mv = (c: PoolCard, mana_value: number) => ({ ...c, mana_value });
  // Ramp candidates: staples with no themes against on-theme cards, as in the friend-test report (Nov 7, 2026).
  const ramp = [
    mv(card("Sol Ring", ["mana-rock"], 1), 1),
    mv(card("Arcane Signet", ["mana-rock"], 3), 2),
    mv(card("On-theme dork", ["mana-dork", "sacrifice-outlet", "death-trigger"], 1000), 1),
    mv(card("On-theme ramp spell", ["land-ramp", "sacrifice-outlet"], 30), 3),
    mv(card("Obscure on-theme rock", ["mana-rock", "sacrifice-outlet", "death-trigger"], 9000), 4),
  ];
  const rampCtx = (role: boolean) => ctx({}, { rolesOf: () => ["ramp"], under: new Set(["ramp"]), role });

  it("without it, staples sink under on-theme cards (the problem)", () => {
    const names = scorePool(ramp, rampCtx(false)).map((x) => x.card.name);
    expect(names.indexOf("Sol Ring")).toBeGreaterThan(names.indexOf("On-theme dork"));
  });

  it("puts Sol Ring first and Arcane Signet in the top 3, with on-theme cards still competing", () => {
    const names = scorePool(ramp, rampCtx(true)).map((x) => x.card.name);
    expect(names[0]).toBe("Sol Ring");
    expect(names.slice(0, 3)).toContain("Arcane Signet");
    expect(names.slice(0, 3)).toContain("On-theme ramp spell");
    expect(names.at(-1)).toBe("Obscure on-theme rock");
  });

  it("Hidden gems for a role needs one shared theme, not two", () => {
    const names = scorePool(ramp, { ...rampCtx(true), settings: { ...DEFAULT_SUGGEST, style: "gems" } }).map((x) => x.card.name);
    expect(names).toContain("On-theme ramp spell");
    expect(names).not.toContain("Sol Ring");
  });
});

describe("pickStaples", () => {
  const rolesOf = (c: PoolCard) => (c.tags.includes("ramp") ? ["ramp"] : c.tags.includes("draw") ? ["draw"] : []);
  const staplePool = [
    card("Rhystic Study", ["draw"], 4),
    card("Sol Ring", ["ramp"], 1),
    card("Cultivate", ["ramp"], 30),
    card("Unranked rock", ["ramp"], null),
    card("Lightning Greaves", ["protection"], 8),
  ];

  it("keeps the most-played cards for under-target roles, by EDHREC rank", () => {
    const r = pickStaples(staplePool, { rolesOf, under: new Set(["ramp", "draw"]) });
    expect(r.map((x) => x.card.name)).toEqual(["Sol Ring", "Rhystic Study", "Cultivate"]);
    expect(r[0].fills).toEqual(["ramp"]);
  });

  it("gives each short role a fair share before filling by rank", () => {
    const rocks = Array.from({ length: 6 }, (_, i) => card(`Rock ${i}`, ["ramp"], i + 1));
    const r = pickStaples([...rocks, card("Rhystic Study", ["draw"], 50), card("Mystic Remora", ["draw"], 60)], { rolesOf, under: new Set(["ramp", "draw"]) }, 4);
    expect(r.map((x) => x.card.name)).toEqual(["Rock 0", "Rock 1", "Rhystic Study", "Mystic Remora"]);
  });

  it("skips roles already at target and dismissed cards, and honors the limit", () => {
    const r = pickStaples(staplePool, { rolesOf, under: new Set(["ramp"]), dismissed: new Set(["Sol Ring"]) }, 1);
    expect(r.map((x) => x.card.name)).toEqual(["Cultivate"]);
  });
});

describe("readSuggestSettings", () => {
  it("fills defaults and clamps bad values", () => {
    expect(readSuggestSettings(null)).toEqual(DEFAULT_SUGGEST);
    expect(readSuggestSettings({ style: "gems", priceCap: 500, weights: { pop: -3, fit: "x" } })).toEqual({
      style: "gems",
      priceCap: 100,
      weights: { fit: DEFAULT_SUGGEST.weights.fit, pop: -1, price: DEFAULT_SUGGEST.weights.price },
    });
    expect(readSuggestSettings({ style: "random" }).style).toBe("best");
  });
});
