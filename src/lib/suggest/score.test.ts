import { describe, expect, it } from "vitest";
import type { ThemeTag } from "@/lib/tags/themes";
import { DEFAULT_SUGGEST, popularity, scorePool, type PoolCard, type SuggestSettings } from "./score";

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

  it("Hidden gems: less-played ranks higher, and cards with no fit are dropped", () => {
    const r = scorePool(pool, ctx({ style: "gems" }));
    expect(r[0].card.name).toBe("On-theme gem");
    expect(r.map((x) => x.card.name)).not.toContain("Popular off-theme");
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
