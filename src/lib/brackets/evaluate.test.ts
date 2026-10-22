import { describe, expect, it } from "vitest";
import type { CardSummary, DeckLine } from "@/lib/deck/model";
import { estimateBracket, estimateLabel, overTarget, type ComboRow } from "./evaluate";

const line = (name: string, extra: Partial<CardSummary> = {}, quantity = 1): DeckLine => ({
  board: "main",
  quantity,
  card: {
    oracle_id: name,
    name,
    mana_cost: null,
    mana_value: 2,
    type_line: "Sorcery",
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
const gc = (name: string) => line(name, { game_changer: true });
const tags: Record<string, string[]> = { Armageddon: ["mass-land-denial"], "Time Warp": ["extra-turn"], "Temporal Manipulation": ["extra-turn"], "Walk the Aeons": ["extra-turn"] };
const combo = (a: string, b: string, tag: string | null, requires = 0): ComboRow => ({
  id: `${a}-${b}`,
  card_a: a,
  card_b: b,
  results: ["Win the game"],
  bracket_tag: tag,
  requires,
  popularity: 100,
});
const run = (lines: DeckLine[], combos: ComboRow[] = []) =>
  estimateBracket({
    lines,
    tagsOf: (id) => tags[id] ?? [],
    massLandDenialTags: new Set(["mass-land-denial"]),
    extraTurnTags: new Set(["extra-turn"]),
    combos,
  });

describe("estimateBracket", () => {
  it("a plain deck fits brackets 1-2", () => {
    const e = run([line("Cultivate"), line("Forest", {}, 30)]);
    expect(e.floor).toBe(1);
    expect(estimateLabel(e.floor)).toBe("2 or lower");
  });

  it("Game Changers: 1-3 means bracket 3, 4+ means bracket 4", () => {
    expect(run([gc("Rhystic Study")]).floor).toBe(3);
    expect(run([gc("A"), gc("B"), gc("C")]).floor).toBe(3);
    const e = run([gc("A"), gc("B"), gc("C"), gc("D")]);
    expect(e.floor).toBe(4);
    expect(e.findings[0].label).toBe("4 Game Changers (up to 3 in bracket 3)");
  });

  it("any mass land denial means bracket 4", () => {
    const e = run([line("Armageddon")]);
    expect(e.floor).toBe(4);
    expect(e.findings[0].kind).toBe("mass-land-denial");
  });

  it("extra turns: none in 1, up to 2 in 2-3, 3+ means 4", () => {
    expect(run([line("Time Warp")]).floor).toBe(2);
    expect(run([line("Time Warp"), line("Temporal Manipulation")]).floor).toBe(2);
    expect(run([line("Time Warp"), line("Temporal Manipulation"), line("Walk the Aeons")]).floor).toBe(4);
  });

  it("two-card combos follow Spellbook's rating", () => {
    const deck = [line("Thassa's Oracle"), line("Demonic Consultation"), line("Felidar Guardian"), line("Restoration Angel")];
    expect(run(deck, [combo("Thassa's Oracle", "Demonic Consultation", "R")]).floor).toBe(4);
    expect(run(deck, [combo("Felidar Guardian", "Restoration Angel", "S")]).floor).toBe(3);
    expect(run(deck, [combo("Felidar Guardian", "Restoration Angel", "O")]).floor).toBe(2);
    const casual = run(deck, [combo("Felidar Guardian", "Restoration Angel", "E")]);
    expect(casual.floor).toBe(1); // listed, but doesn't raise the bracket
    expect(casual.findings[0].label).toContain("Felidar Guardian + Restoration Angel");
    expect(run(deck, [combo("Felidar Guardian", "Restoration Angel", null)]).floor).toBe(3); // unrated
  });

  it("skips combos needing a generic piece, and combos not fully in the deck", () => {
    const deck = [line("Gravecrawler"), line("Phyrexian Altar")];
    expect(run(deck, [combo("Gravecrawler", "Phyrexian Altar", "R", 1)]).findings).toEqual([]);
    expect(run(deck, [combo("Gravecrawler", "Not in deck", "R")]).findings).toEqual([]);
  });

  it("lists what crosses the target, highest first", () => {
    const e = run([gc("Rhystic Study"), line("Armageddon"), line("Time Warp")]);
    expect(e.floor).toBe(4);
    expect(overTarget(e, 3).map((f) => f.kind)).toEqual(["mass-land-denial"]);
    expect(overTarget(e, 2).map((f) => f.kind)).toEqual(["mass-land-denial", "game-changers"]);
    expect(estimateLabel(4)).toBe("4+");
  });
});
