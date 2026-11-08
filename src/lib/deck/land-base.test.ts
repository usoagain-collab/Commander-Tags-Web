import { describe, expect, it } from "vitest";
import { colorsMade, landBaseChange, planLandBase, splitByWeight, type LandCandidate } from "./land-base";
import type { CardSummary } from "./model";

let n = 0;
const land = (name: string, over: Partial<LandCandidate> = {}): LandCandidate => ({
  oracle_id: `id-${name}`,
  name,
  mana_cost: null,
  mana_value: 0,
  type_line: "Land",
  color_identity: [],
  image_normal: null,
  image_art_crop: null,
  price_usd: 1,
  edhrec_rank: ++n,
  commander_legal: true,
  game_changer: false,
  max_copies: 1,
  can_be_commander: false,
  layout: "normal",
  counts_as_land: true,
  produced_mana: [],
  tags: [],
  ...over,
});

const pool = [
  land("Command Tower", { produced_mana: ["W", "U", "B", "R", "G"] }),
  land("Breeding Pool", { produced_mana: ["G", "U"], color_identity: ["G", "U"], type_line: "Land — Forest Island", price_usd: 15 }),
  land("Misty Rainforest", { tags: ["tutor-land-forest", "tutor-land-island"], price_usd: 25 }),
  land("Flooded Strand", { tags: ["tutor-land-plains", "tutor-land-island"] }),
  land("Evolving Wilds", { tags: ["tutor-land-basic"] }),
  land("Hallowed Fountain", { produced_mana: ["W", "U"], color_identity: ["W", "U"] }),
  land("Reliquary Tower", { produced_mana: ["C"] }),
  land("Cavern of Souls", { produced_mana: ["C", "W", "U", "B", "R", "G"], tags: ["restricted-mana"] }),
  land("Yavimaya Coast", { produced_mana: ["C", "G", "U"], color_identity: ["G", "U"] }),
];
const base = { identity: ["U" as const, "G" as const], target: 37, landCount: 0, nonbasicCount: 0, basicCounts: {}, pips: { U: 20, G: 10 }, pool, inDeck: () => false, maxPrice: null };

describe("auto build land base", () => {
  it("knows what a fetch land finds", () => {
    expect([...colorsMade(pool[2], ["U", "G"])].sort()).toEqual(["G", "U"]);
    expect([...colorsMade(pool[3], ["U", "G"])]).toEqual(["U"]); // Flooded Strand only finds Islands here
    expect([...colorsMade(pool[4], ["U", "G"])].sort()).toEqual(["G", "U"]);
  });

  it("takes popular lands making two of the colors, then basics by pips", () => {
    const plan = planLandBase(base);
    expect(plan.need).toBe(37);
    // Skips Flooded Strand (one color here), Hallowed Fountain (white), Reliquary Tower (colorless), Cavern (creature-only mana).
    expect(plan.nonbasic.map((x) => x.card.name)).toEqual(["Command Tower", "Breeding Pool", "Misty Rainforest", "Evolving Wilds", "Yavimaya Coast"]);
    const basics = Object.fromEntries(plan.basics.map((b) => [b.name, b.count]));
    expect(basics).toEqual({ Island: 21, Forest: 11 }); // 32 basics, two thirds blue
  });

  it("only fills what's missing, and steers basics toward the color that is behind", () => {
    const plan = planLandBase({ ...base, landCount: 33, nonbasicCount: 13, basicCounts: { G: 20 } });
    expect(plan.need).toBe(4);
    expect(plan.nonbasic).toEqual([]); // 13 nonbasics already reach 35% of 37
    expect(plan.basics).toEqual([{ color: "U", name: "Island", count: 4 }]);
  });

  it("does nothing at the target, honors a price cap, and leaves out cards already in the deck", () => {
    expect(planLandBase({ ...base, landCount: 37 }).need).toBe(0);
    const names = planLandBase({ ...base, maxPrice: 10, inDeck: (id) => id === "id-Command Tower" }).nonbasic.map((x) => x.card.name);
    expect(names).toEqual(["Evolving Wilds", "Yavimaya Coast"]);
  });

  it("gives mono-color decks basics only and colorless decks Wastes", () => {
    expect(planLandBase({ ...base, identity: ["G"], pips: { G: 5 } })).toMatchObject({ nonbasic: [], basics: [{ name: "Forest", count: 37 }] });
    expect(planLandBase({ ...base, identity: [], pips: {} }).basics).toEqual([{ color: "C", name: "Wastes", count: 37 }]);
  });

  it("splits evenly when there are no pips", () => {
    expect(splitByWeight(5, { W: 0, U: 0 })).toEqual({ W: 3, U: 2 });
    expect(splitByWeight(10, { W: 1, U: 3 })).toEqual({ W: 3, U: 7 });
  });

  it("becomes one change adding to existing basics", () => {
    const plan = planLandBase({ ...base, landCount: 35, nonbasicCount: 13, basicCounts: { U: 10 } });
    const island = land("Island", { type_line: "Basic Land — Island", max_copies: 99 }) as CardSummary;
    const change = landBaseChange({ "main|id-Island": 10 }, plan, { Island: island, Forest: land("Forest", { type_line: "Basic Land — Forest" }) });
    expect(change.rows.reduce((s, r) => s + r.to - r.from, 0)).toBe(2);
    expect(change.label).toBe("Auto build land base: added 2 lands");
  });
});
