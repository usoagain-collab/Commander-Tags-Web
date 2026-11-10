import { describe, expect, it } from "vitest";
import type { ComboRow } from "@/lib/brackets/evaluate";
import type { CardSummary } from "@/lib/deck/model";
import { buildRoleDefs } from "@/lib/tags/role-settings";
import { resolveRoles, rolesOf } from "@/lib/tags/roles";
import { oKey, type ThemeTag } from "@/lib/tags/themes";
import { TagTree, type TagTreePayload } from "@/lib/tags/tree";
import { cheatTargets, chooseArchetype, curveBucket, detectArchetypes, effectiveCurve, type CutterCard } from "./archetype";
import { ARCHETYPES, GENERAL_KEY } from "./archetypes";
import { DEFAULT_WEIGHTS } from "./config";
import { belowTargetWarning, keepScores, planCuts, suggestCuts, type CutterContext } from "./score";
import { DEFAULT_PREFS, DEFAULT_STATE, readCutterPrefs, readCutterState } from "./state";
import { cutReason, explainCut } from "./explain";
import { pickSwap, pickTwoForOne, twoForOnePairs } from "./swaps";
import type { PoolCard } from "@/lib/suggest/score";
import { toSavePayload } from "@/lib/deck/model";

// A small tree shaped like the real one.
const payload: TagTreePayload = {
  n: 30000,
  art_n: 0,
  tags: [
    ["ramp", "ramp", 500, []], // 0
    ["mana-rock", "mana rock", 400, [0]], // 1
    ["land-ramp", "land ramp", 500, [0]], // 2
    ["removal", "removal", 0, []], // 3
    ["spot-removal", "spot removal", 5000, [3]], // 4
    ["sweeper", "sweeper", 700, [3]], // 5
    ["removal-creature", "removal creature", 1900, [3]], // 6
    ["removal-nonland", "removal nonland", 400, [3]], // 7
    ["recursion", "recursion", 0, []], // 8
    ["reanimate", "reanimate", 11, [8]], // 9
    ["reanimate-creature", "reanimate creature", 560, [9]], // 10
    ["reanimate-self", "reanimate self", 190, [9]], // 11
    ["draw", "draw", 0, []], // 12
    ["pure-draw", "pure draw", 1200, [12]], // 13
    ["mill", "mill", 0, []], // 14
    ["mill-self", "mill self", 1100, [14]], // 15
    ["discard-outlet", "discard outlet", 1400, []], // 16
    ["sneak", "sneak", 290, []], // 17
    ["landfall", "landfall", 300, []], // 18
    ["death-trigger", "death trigger", 1600, []], // 19
    ["card-advantage", "card advantage", 58, []], // 20
  ],
};
const tree = new TagTree(payload);

let next = 0;
function card(name: string, mv: number, typeLine = "Creature — Human", extra: Partial<CardSummary> = {}): CardSummary {
  next += 1;
  return {
    oracle_id: `id-${name}`,
    name,
    mana_cost: null,
    mana_value: mv,
    type_line: typeLine,
    color_identity: [],
    image_normal: null,
    image_art_crop: null,
    price_usd: null,
    edhrec_rank: 1000 + next,
    commander_legal: true,
    game_changer: false,
    max_copies: typeLine.startsWith("Basic") ? 99 : 1,
    can_be_commander: false,
    layout: "normal",
    counts_as_land: /\bLand\b/.test(typeLine.split(" // ")[0]),
    ...extra,
  };
}

function deck(targets: Record<string, number>) {
  const roles = resolveRoles(buildRoleDefs(targets, []), tree);
  const make = (c: CardSummary, tags: string[], opts: { commander?: boolean; quantity?: number } = {}): CutterCard => ({
    card: c,
    quantity: opts.quantity ?? 1,
    commander: !!opts.commander,
    tags,
    roles: rolesOf(c, tags, roles),
  });
  return { roles, make };
}

function ctxFor(cards: CutterCard[], roles: ReturnType<typeof deck>["roles"], extra: Partial<CutterContext> = {}): CutterContext {
  return {
    cards,
    roles,
    tree,
    themes: [],
    keysOf: (c) => c.tags.map(oKey),
    archetype: ARCHETYPES[0],
    combos: [],
    bracketFindings: [],
    identity: null,
    ...extra,
  };
}

const theme = (slug: string, count: number, score: number): ThemeTag => ({
  key: oKey(slug),
  kind: "o",
  slug,
  label: slug,
  size: 100,
  count,
  pinned: false,
  score,
  depth: 1,
});

describe("archetypes config", () => {
  it("has a General fallback and curves that add up to 100", () => {
    expect(ARCHETYPES[0].key).toBe(GENERAL_KEY);
    for (const a of ARCHETYPES) expect(a.curve.reduce((x, y) => x + y, 0)).toBe(100);
  });

  it("buckets mana values 0-1, 2 … 7+", () => {
    expect([0, 1, 2, 3, 6, 7, 12].map(curveBucket)).toEqual([0, 0, 1, 2, 5, 6, 6]);
  });
});

describe("detectArchetypes", () => {
  const { make } = deck({});
  it("finds a reanimator deck from its tags", () => {
    const cards = [
      ...Array.from({ length: 8 }, (_, i) => make(card(`Reanimate ${i}`, 2, "Sorcery"), ["reanimate-creature"])),
      ...Array.from({ length: 6 }, (_, i) => make(card(`Mill ${i}`, 2), ["mill-self"])),
      ...Array.from({ length: 26 }, (_, i) => make(card(`Filler ${i}`, 3), [])),
    ];
    const ranked = detectArchetypes({ cards, tree, combos: 0 });
    expect(ranked[0].archetype.key).toBe("graveyard");
    expect(ranked[0].evidence[0].count).toBe(8);
    expect(ranked[ranked.length - 1].archetype.key).toBe(GENERAL_KEY);
  });

  it("falls back to General when nothing stands out", () => {
    const kinds = ["Bear", "Elf", "Human", "Wizard", "Ox"];
    const cards = Array.from({ length: 30 }, (_, i) => make(card(`Bear ${i}`, 2, `Creature — ${kinds[i % 5]}`), []));
    expect(detectArchetypes({ cards, tree, combos: 0 })[0].archetype.key).toBe(GENERAL_KEY);
  });

  it("counts the commander as several cards", () => {
    const filler = Array.from({ length: 30 }, (_, i) => make(card(`Bear ${i}`, 2), []));
    const landfall = Array.from({ length: 2 }, (_, i) => make(card(`Landfall ${i}`, 3), ["landfall"]));
    const withCommander = [make(card("Commander", 4), ["landfall"], { commander: true }), ...landfall, ...filler];
    const without = [make(card("Commander", 4), [], { commander: true }), ...landfall, ...filler];
    const score = (cards: CutterCard[]) => detectArchetypes({ cards, tree, combos: 0 }).find((d) => d.archetype.key === "landfall")!.score;
    expect(score(withCommander)).toBeGreaterThan(score(without));
  });

  it("doesn't guess an archetype from one or two cards", () => {
    const filler = Array.from({ length: 20 }, (_, i) => make(card(`Bear ${i}`, 2), []));
    const cards = [make(card("Commander", 4), [], { commander: true }), make(card("Landfall 0", 3), ["landfall"]), ...filler.slice(0, 2)];
    expect(detectArchetypes({ cards, tree, combos: 0 }).find((d) => d.archetype.key === "landfall")!.score).toBe(0);
  });
});

describe("chooseArchetype", () => {
  const ranked = ["graveyard", "aristocrats", "tokens", "landfall", GENERAL_KEY].map((key) => ({
    archetype: ARCHETYPES.find((a) => a.key === key)!,
    score: 0.5,
    evidence: [],
  }));
  it("offers the next most likely one after each No, and asks to pick after the third", () => {
    expect(chooseArchetype(ranked, { key: null, status: "auto", rejected: [] }).chosen.archetype.key).toBe("graveyard");
    const two = chooseArchetype(ranked, { key: null, status: "auto", rejected: ["graveyard", "aristocrats"] });
    expect(two.chosen.archetype.key).toBe("tokens");
    expect(two.askToPick).toBe(false);
    expect(chooseArchetype(ranked, { key: null, status: "auto", rejected: ["graveyard", "aristocrats", "tokens"] }).askToPick).toBe(true);
  });

  it("keeps a confirmed or picked archetype", () => {
    expect(chooseArchetype(ranked, { key: "landfall", status: "picked", rejected: ["graveyard"] }).chosen.archetype.key).toBe("landfall");
  });
});

describe("cheat targets and the effective curve", () => {
  const { make } = deck({});
  const enablers = (n: number) => Array.from({ length: n }, (_, i) => make(card(`Animate ${i}`, 2, "Sorcery"), ["reanimate-creature"]));
  const fatty = make(card("Griselbrand", 8), []);
  const bigArtifact = make(card("Blightsteel", 12, "Artifact"), []);

  it("treats big creatures as cheated in when there are enough enablers", () => {
    expect(cheatTargets([...enablers(4), fatty, bigArtifact], tree).targets).toEqual(new Set(["id-Griselbrand"]));
    expect(cheatTargets([...enablers(3), fatty], tree).targets.size).toBe(0);
  });

  it("doesn't count cards that only return themselves", () => {
    const selfOnly = Array.from({ length: 4 }, (_, i) => make(card(`Phoenix ${i}`, 3), ["reanimate-self"]));
    expect(cheatTargets([...selfOnly, fatty], tree).enablers).toBe(0);
  });

  it("adds noncreature permanents with put-into-play enablers", () => {
    const sneaks = Array.from({ length: 2 }, (_, i) => make(card(`Sneak ${i}`, 4, "Enchantment"), ["sneak"]));
    expect(cheatTargets([...enablers(2), ...sneaks, bigArtifact], tree).targets.has("id-Blightsteel")).toBe(true);
  });

  it("follows the power user overrides", () => {
    const t = cheatTargets([...enablers(4), fatty], tree, undefined, { "id-Griselbrand": "curve" });
    expect(t.targets.size).toBe(0);
  });

  it("leaves cheat targets and lands out of the curve", () => {
    const land = make(card("Forest", 0, "Basic Land — Forest"), []);
    const curve = effectiveCurve([...enablers(4), fatty, land], new Set(["id-Griselbrand"]));
    expect(curve.spells).toBe(4);
    expect(curve.shares[1]).toBe(100);
  });
});

describe("keepScores and planCuts", () => {
  // Ramp target 2 with four ramp cards (two over); one board wipe at target 1.
  const { roles, make } = deck({ ramp: 2, wipes: 1, draw: 0, removal: 0, protection: 0, recursion: 0, lands: 0 });
  const rock2 = make(card("Rock 2", 2, "Artifact"), ["mana-rock"]);
  const rock2b = make(card("Rock 2b", 2, "Artifact"), ["mana-rock"]);
  const ramp3 = make(card("Ramp 3", 3, "Sorcery"), ["land-ramp"]);
  const ramp5 = make(card("Ramp 5", 5, "Sorcery"), ["land-ramp"]);
  const wipe = make(card("Wipe", 4, "Sorcery"), ["sweeper"]);
  const forest = make(card("Forest", 0, "Basic Land — Forest"), [], { quantity: 10 });
  const commander = make(card("Omo", 3), ["landfall"], { commander: true });
  const cards = [commander, rock2, rock2b, ramp3, ramp5, wipe, forest];

  it("scores over-target, expensive ramp as the weakest", () => {
    const scores = keepScores(ctxFor(cards, roles));
    const keep = (name: string) => scores.find((s) => s.entry.card.name === name)!;
    expect(keep("Ramp 5").keep).toBeLessThan(keep("Rock 2").keep);
    expect(keep("Ramp 5").facts.ranks[0]).toMatchObject({ key: "ramp", position: 1, of: 4 });
    expect(keep("Ramp 5").facts.roles[0]).toMatchObject({ key: "ramp", count: 4, target: 2 });
  });

  it("protects commanders, lands, a lone wipe at target, locks, combo pieces and untagged cards", () => {
    const untagged = make(card("New card", 2), []);
    const combo: ComboRow = { id: "x", card_a: "id-Rock 2", card_b: "id-Rock 2b", results: [], bracket_tag: null, requires: 0, popularity: null };
    const scores = keepScores(
      ctxFor([...cards, untagged], roles, { combos: [combo], state: { ...DEFAULT_STATE, locks: ["id-Ramp 3"] } }),
    );
    const kind = (name: string) => scores.find((s) => s.entry.card.name === name)!.protect?.kind;
    expect(kind("Omo")).toBe("commander");
    expect(kind("Forest")).toBe("land");
    expect(kind("Wipe")).toBe("below-target");
    expect(kind("Ramp 3")).toBe("lock");
    expect(kind("Rock 2")).toBe("combo");
    expect(kind("New card")).toBe("no-tags");
    expect(kind("Ramp 5")).toBeUndefined();
  });

  it("lets a power user turn combo protection off", () => {
    const combo: ComboRow = { id: "x", card_a: "id-Rock 2", card_b: "id-Rock 2b", results: [], bracket_tag: null, requires: 0, popularity: null };
    const scores = keepScores(ctxFor(cards, roles, { combos: [combo], prefs: { ...DEFAULT_PREFS, comboProtect: false } }));
    expect(scores.find((s) => s.entry.card.name === "Rock 2")!.protect).toBeNull();
  });

  it("picks cuts one at a time, and stops cutting a role once it reaches its target", () => {
    const cuts = planCuts(ctxFor(cards, roles), 5).map((c) => c.score.entry.card.name);
    expect(cuts.slice(0, 2)).toEqual(["Ramp 5", "Ramp 3"]);
    // Ramp is now 2 / 2, the wipe is 1 / 1, the commander and Forests never go: nothing is left to cut.
    expect(cuts).toHaveLength(2);
  });

  it("doesn't suggest dismissed cards", () => {
    const cuts = planCuts(ctxFor(cards, roles, { state: { ...DEFAULT_STATE, dismissed: { "id-Ramp 5": "" } } }), 1);
    expect(cuts[0].score.entry.card.name).toBe("Ramp 3");
  });

  it("takes a card's own share out of its themes", () => {
    const loner = make(card("Loner", 3), ["death-trigger"]);
    const pair = [make(card("Pair A", 3), ["landfall"]), make(card("Pair B", 3), ["landfall"])];
    const themes = [theme("death-trigger", 1, 10), theme("landfall", 3, 10)];
    const scores = keepScores(ctxFor([commander, loner, ...pair], roles, { themes }));
    const fit = (name: string) => scores.find((s) => s.entry.card.name === name)!.parts.theme;
    expect(fit("Loner")).toBe(0);
    expect(fit("Pair A")).toBe(1);
  });

  it("uses the power user's weights", () => {
    const onlyCurve = { ...DEFAULT_PREFS, weights: { ...DEFAULT_WEIGHTS, coverage: 0, saturation: 0, weakest: 0, theme: 0, curve: 1, popularity: 0 } };
    const s = keepScores(ctxFor(cards, roles, { prefs: onlyCurve })).find((x) => x.entry.card.name === "Ramp 5")!;
    expect(s.keep).toBeCloseTo(s.parts.curve);
  });
});

describe("tuning (Nov 8, 2026)", () => {
  const { roles, make } = deck({ ramp: 1, draw: 0, wipes: 0, removal: 0, protection: 0, recursion: 0, tutors: 0, lands: 0 });
  const of = (scores: ReturnType<typeof keepScores>, name: string) => scores.find((s) => s.entry.card.name === name)!;

  it("never penalizes cheap cards for the curve", () => {
    // Every spell is a 1-drop, far over any expected share.
    const cards = ["A", "B", "C", "D"].map((n) => make(card(`Cantrip ${n}`, 1, "Sorcery"), ["pure-draw"]));
    const scores = keepScores(ctxFor(cards, roles));
    expect(of(scores, "Cantrip A").parts.curve).toBe(1);
    expect(explainCut(of(scores, "Cantrip A"), ARCHETYPES[0]).curve).toContain("cheap cards never count against it");
  });

  it("ranks a widely played card above a rarely played one with the same cost and job", () => {
    const staple = make(card("Staple", 3, "Enchantment", { edhrec_rank: 5 }), ["pure-draw"]);
    const obscure = make(card("Obscure", 3, "Enchantment", { edhrec_rank: 15000 }), ["pure-draw"]);
    const third = make(card("Third", 3, "Enchantment", { edhrec_rank: 8000 }), ["pure-draw"]);
    const r = deck({ ramp: 0, draw: 1, wipes: 0, removal: 0, protection: 0, recursion: 0, tutors: 0, lands: 0 });
    const scores = keepScores(ctxFor([staple, obscure, third].map((c) => ({ ...c, roles: rolesOf(c.card, c.tags, r.roles) })), r.roles));
    expect(of(scores, "Staple").keep).toBeGreaterThan(of(scores, "Obscure").keep);
  });

  it("ranks a card that refunds its whole cost as free within its role", () => {
    const frantic = make(card("Frantic Search", 3, "Instant"), ["pure-draw", "full-refund"]);
    const cards = [frantic, make(card("Draw 2", 2, "Instant"), ["pure-draw"]), make(card("Draw 2b", 2, "Instant"), ["pure-draw"])];
    const r = deck({ ramp: 0, draw: 1, wipes: 0, removal: 0, protection: 0, recursion: 0, tutors: 0, lands: 0 });
    const scores = keepScores(ctxFor(cards.map((c) => ({ ...c, roles: rolesOf(c.card, c.tags, r.roles) })), r.roles));
    expect(of(scores, "Frantic Search").parts.weakest).toBeGreaterThan(of(scores, "Draw 2").parts.weakest);
  });

  it("counts color fixing as flexibility for Ramp in decks of 3+ colors", () => {
    const fixer = make(card("Lantern", 3, "Artifact", { produced_mana: ["W", "U", "B", "R", "G"], edhrec_rank: 1000 }), ["mana-rock"]);
    const plain = make(card("Plain rock", 3, "Artifact", { produced_mana: ["C"], edhrec_rank: 1000 }), ["mana-rock"]);
    const other = make(card("Other rock", 3, "Artifact", { produced_mana: ["C"], edhrec_rank: 1000 }), ["mana-rock"]);
    const cards = [fixer, plain, other];
    const five = keepScores(ctxFor(cards, roles, { identity: new Set(["W", "U", "B", "R", "G"]) }));
    expect(of(five, "Lantern").parts.weakest).toBeGreaterThan(of(five, "Plain rock").parts.weakest);
    // In a two-color deck fixing doesn't count, so the three rocks tie.
    const two = keepScores(ctxFor(cards, roles, { identity: new Set(["U", "G"]) }));
    expect(of(two, "Lantern").parts.weakest).toBe(of(two, "Plain rock").parts.weakest);
  });
});

describe("suggestCuts", () => {
  const { roles, make } = deck({ ramp: 0, wipes: 0, draw: 0, removal: 0, protection: 0, recursion: 0, tutors: 0, lands: 40 });
  const bears = (n: number) => Array.from({ length: n }, (_, i) => make(card(`Bear ${i}`, 2), ["pure-draw"]));
  const forest = (n: number) => make(card("Forest", 0, "Basic Land — Forest"), [], { quantity: n });

  it("suggests exactly the cuts that bring the deck to 100", () => {
    const plan = suggestCuts(ctxFor([...bears(64), forest(40)], roles));
    expect(plan.mode).toBe("over");
    if (plan.mode === "over") expect(plan.cuts).toHaveLength(4);
  });

  it("shows the 3 weakest at exactly 100", () => {
    const plan = suggestCuts(ctxFor([...bears(60), forest(40)], roles));
    expect(plan.mode).toBe("exact");
    if (plan.mode === "exact") expect(plan.cuts).toHaveLength(3);
  });

  it("lists the roles to fill under 100", () => {
    const plan = suggestCuts(ctxFor([...bears(50), forest(36)], roles));
    expect(plan).toMatchObject({ mode: "under", need: 14, under: [{ key: "lands", count: 36, target: 40 }] });
  });
});

describe("belowTargetWarning", () => {
  const { roles, make } = deck({ wipes: 3, ramp: 1 });
  const wipes = Array.from({ length: 3 }, (_, i) => make(card(`Wipe ${i}`, 4, "Sorcery"), ["sweeper"]));
  const ramp = [make(card("Rock", 2, "Artifact"), ["mana-rock"]), make(card("Rock B", 2, "Artifact"), ["mana-rock"])];

  it("names each role a removal would put below target", () => {
    expect(belowTargetWarning([...wipes, ...ramp], roles, { "id-Wipe 0": 1 })).toEqual([{ key: "wipes", name: "Board wipes", from: 3, to: 2, target: 3 }]);
    expect(belowTargetWarning([...wipes, ...ramp], roles, { "id-Rock": 1 })).toEqual([]);
    expect(belowTargetWarning([...wipes, ...ramp], roles, { "id-Rock": 1, "id-Rock B": 1 })).toHaveLength(1);
  });
});

describe("saved state", () => {
  it("reads decks.cutter defensively", () => {
    expect(readCutterState(null)).toEqual(DEFAULT_STATE);
    const s = readCutterState({
      locks: ["a", "a", 3],
      dismissed: { b: "meta call", c: 4 },
      archetype: { key: "tokens", status: "confirmed", rejected: ["graveyard"] },
      curve: { d: "cheat", e: "nope" },
      h2h: [["x", "y"], ["bad"]],
    });
    expect(s).toEqual({
      locks: ["a"],
      dismissed: { b: "meta call", c: "" },
      archetype: { key: "tokens", status: "confirmed", rejected: ["graveyard"] },
      curve: { d: "cheat" },
      h2h: [["x", "y"]],
    });
  });

  it("reads profiles.cutter_prefs, clamping weights and keeping only valid custom archetypes", () => {
    expect(readCutterPrefs(undefined)).toEqual(DEFAULT_PREFS);
    const p = readCutterPrefs({
      power: true,
      weights: { coverage: 5, saturation: -1 },
      archetypes: [
        { key: "elves", name: " Elfball ", curve: [1, 1, 1, 1, 0, 0, 0], signals: [{ kind: "type", type: "Elf", weight: 2 }, { kind: "bogus" }] },
        { key: "broken", name: "No curve" },
      ],
    });
    expect(p.power).toBe(true);
    expect(p.weights.coverage).toBe(1);
    expect(p.weights.saturation).toBe(0);
    expect(p.archetypes).toHaveLength(1);
    expect(p.archetypes[0]).toMatchObject({ key: "custom:elves", name: "Elfball", curve: [25, 25, 25, 25, 0, 0, 0], custom: true });
    expect(p.archetypes[0].signals).toHaveLength(1);
  });
});

describe("explain", () => {
  const { roles, make } = deck({ ramp: 2, wipes: 1, draw: 0, removal: 0, protection: 0, recursion: 0, tutors: 0, lands: 0 });
  const cards = [
    make(card("Rock 2", 2, "Artifact"), ["mana-rock"]),
    make(card("Rock 2b", 2, "Artifact"), ["mana-rock"]),
    make(card("Ramp 3", 3, "Sorcery"), ["land-ramp"]),
    make(card("Ramp 5", 5, "Sorcery"), ["land-ramp"]),
  ];
  const ctx = ctxFor(cards, roles);
  const s = keepScores(ctx).find((x) => x.entry.card.name === "Ramp 5")!;

  it("gives a one-line reason naming the over-target role and the rank", () => {
    expect(cutReason(s)).toBe("Ramp 4 / 2 · weakest of 4 in Ramp");
  });

  it("explains every part in plain words", () => {
    const e = explainCut(s, ARCHETYPES[0]);
    expect(e.hits[0]).toEqual({ label: "Ramp", text: "4 / 2: 2 over target" });
    expect(e.rank).toMatch(/^The weakest of 4 Ramp cards/);
    expect(e.curve).toMatch(/^5-drops are 25% of your spells; General \(midrange\) expects 12%/);
    expect(e.parts.map((p) => p.part)).toEqual(["coverage", "saturation", "weakest", "theme", "curve", "popularity"]);
    expect(e.parts[1].text).toBe("Every role it fills is over target");
  });

  it("counts head-to-head picks toward weakest in role", () => {
    const won = keepScores({ ...ctx, state: { ...DEFAULT_STATE, h2h: [["id-Ramp 5", "id-Rock 2"], ["id-Ramp 5", "id-Rock 2b"]] } });
    const after = won.find((x) => x.entry.card.name === "Ramp 5")!;
    expect(after.parts.weakest).toBeCloseTo(0.5 * s.parts.weakest + 0.5);
  });
});

describe("swaps", () => {
  const { roles, make } = deck({ ramp: 1, draw: 1, wipes: 0, removal: 0, protection: 0, recursion: 0, tutors: 0, lands: 0 });
  const rolesFor = (c: CardSummary, tags: string[]) => rolesOf(c, tags, roles);
  // Same EDHREC rank everywhere, so popularity (part of weakest in role) doesn't decide these tests.
  const pool = (name: string, mv: number, tags: string[], type = "Artifact"): PoolCard => ({ ...card(name, mv, type, { edhrec_rank: 1000 }), tags });
  const slowRamp = make(card("Slow ramp", 6, "Sorcery", { edhrec_rank: 1000 }), ["land-ramp"]);
  const slowDraw = make(card("Slow draw", 6, "Sorcery", { edhrec_rank: 1000 }), ["pure-draw"]);
  // Three cards per role so they can be ranked against each other; the tiny deck's curve would swamp the rest.
  const cards = [
    make(card("Rock", 2, "Artifact", { edhrec_rank: 1000 }), ["mana-rock"]),
    make(card("Rock B", 2, "Artifact", { edhrec_rank: 1000 }), ["mana-rock"]),
    slowRamp,
    make(card("Draw", 2, "Instant", { edhrec_rank: 1000 }), ["pure-draw"]),
    make(card("Draw B", 2, "Instant", { edhrec_rank: 1000 }), ["pure-draw"]),
    slowDraw,
  ];
  const ctx = ctxFor(cards, roles, { prefs: { ...DEFAULT_PREFS, weights: { ...DEFAULT_WEIGHTS, curve: 0 } } });
  const scores = keepScores(ctx);
  const of = (name: string) => scores.find((x) => x.entry.card.name === name)!;
  const opts = { rolesFor, skip: () => false };

  it("swaps a weak card for a better one in the same role", () => {
    const pick = pickSwap(ctx, of("Slow ramp"), [pool("Signet", 2, ["mana-rock"]), pool("Off-role", 1, ["pure-draw"])], opts);
    expect(pick?.card.name).toBe("Signet");
    expect(pick!.keep).toBeGreaterThan(of("Slow ramp").keep);
  });

  it("never swaps in a card that adds to another role already at target", () => {
    // Draw has three cards for a target of 1, so a card that also draws would push it further over.
    const both = pool("Ramp and draw", 1, ["land-ramp", "pure-draw"], "Instant");
    expect(pickSwap(ctx, of("Slow ramp"), [both], opts)).toBeNull();
    expect(pickSwap(ctx, of("Slow ramp"), [both, pool("Signet", 2, ["mana-rock"])], opts)?.card.name).toBe("Signet");
  });

  it("skips cards the caller rules out", () => {
    expect(pickSwap(ctx, of("Slow ramp"), [pool("Signet", 2, ["mana-rock"])], { ...opts, skip: () => true })).toBeNull();
  });

  it("pairs single-role cards from different roles and finds one card for both", () => {
    const pairs = twoForOnePairs(scores);
    expect(pairs[0].roles.sort()).toEqual(["draw", "ramp"]);
    const both = pool("Growth Spiral", 2, ["land-ramp", "pure-draw"], "Instant");
    const pick = pickTwoForOne(ctx, pairs[0], [pool("Signet", 2, ["mana-rock"]), both], opts);
    expect(pick?.card.name).toBe("Growth Spiral");
    expect(pick?.replaces).toHaveLength(2);
  });
});

describe("Apply notes", () => {
  it("sends the notes with the edit, but not with its undo", () => {
    const change = { label: "Smart Cutter", rows: [], notes: { label: "Smart Cutter", cards: { a: "Ramp 12 / 10" } } };
    expect(toSavePayload(change).notes).toEqual(change.notes);
    expect(toSavePayload(change, "back").notes).toBeUndefined();
  });
});
