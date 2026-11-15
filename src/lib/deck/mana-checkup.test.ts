import { describe, expect, it } from "vitest";
import type { CardSummary, DeckLine } from "./model";
import { deckHealth } from "./health";
import { enteredTapped, landAdvice, rampRisk, tappedLands } from "./mana-checkup";

const line = (name: string, extra: Partial<CardSummary>, quantity = 1): DeckLine => ({
  board: "main",
  quantity,
  card: {
    oracle_id: name,
    name,
    mana_cost: null,
    mana_value: 0,
    type_line: "Instant",
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

const land = (name: string, quantity = 1) => line(name, { type_line: "Land", counts_as_land: true }, quantity);
const spell = (name: string, mana_value: number, quantity = 1, type_line = "Sorcery") => line(name, { mana_value, type_line }, quantity);

describe("landAdvice (Karsten's 99-card formula)", () => {
  it("matches his worked example: average mana value 3 and no cheap helpers suggests about 41", () => {
    const a = landAdvice([spell("Three", 3, 60), land("Forest", 39)], () => false);
    expect(a.exact).toBeCloseTo(31.42 + 3.13 * 3, 5);
    expect(a.recommended).toBe(41);
    expect(a.lands).toBe(39);
  });

  it("takes 0.28 lands off per cheap ramp or draw spell, mana value 2 or less only", () => {
    const helpers = new Set(["Sol Ring", "Ponder", "Cultivate"]);
    const lines = [spell("Sol Ring", 1, 1, "Artifact"), spell("Ponder", 1), spell("Cultivate", 3), spell("Filler", 3, 57), land("Forest", 38)];
    const a = landAdvice(lines, (l) => helpers.has(l.card.name));
    expect(a.cheap).toBe(2); // Cultivate costs 3, so it isn't cheap
    expect(a.exact).toBeCloseTo(31.42 + 3.13 * a.average - 0.28 * 2, 5);
  });

  it("keeps the suggestion between 30 and 45", () => {
    expect(landAdvice([spell("Free", 0, 60)], () => true).recommended).toBe(30);
    expect(landAdvice([spell("Huge", 9, 60)], () => false).recommended).toBe(45);
  });
});

describe("enteredTapped", () => {
  it("reads always, sometimes and never from the land's own text", () => {
    expect(enteredTapped({ name: "Azorius Chancery", type_line: "Land", oracle_text: "Azorius Chancery enters tapped.\nWhen Azorius Chancery enters, return a land you control to its owner's hand." })).toBe("always");
    expect(enteredTapped({ name: "Scoured Barrens", type_line: "Land", oracle_text: "Scoured Barrens enters the battlefield tapped.\nWhen Scoured Barrens enters the battlefield, you gain 1 life." })).toBe("always");
    expect(enteredTapped({ name: "Glacial Fortress", type_line: "Land", oracle_text: "This land enters tapped unless you control a Plains or an Island.\n{T}: Add {W} or {U}." })).toBe("sometimes");
    expect(enteredTapped({ name: "Breeding Pool", type_line: "Land — Forest Island", oracle_text: "({T}: Add {G} or {U}.)\nAs Breeding Pool enters, you may pay 2 life. If you don't, it enters tapped." })).toBe("sometimes");
    expect(enteredTapped({ name: "Command Tower", type_line: "Land", oracle_text: "{T}: Add one mana of any color in your commander's color identity." })).toBe("never");
  });

  it("ignores lands that tap other things, and reads the land face of a double-faced card", () => {
    expect(enteredTapped({ name: "Evolving Wilds", type_line: "Land", oracle_text: "{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle." })).toBe("never");
    expect(
      enteredTapped({
        name: "Sink into Stupor // Soporific Springs",
        type_line: "Instant // Land",
        oracle_text: "Return target spell or nonland permanent an opponent controls to its owner's hand.\n//\nAs Soporific Springs enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {U}.",
      }),
    ).toBe("sometimes");
  });

  it("counts deck lands by how they enter, skipping spells", () => {
    const text: Record<string, string> = { Chancery: "Chancery enters tapped.", Fortress: "This land enters tapped unless you control a Plains." };
    const t = tappedLands([land("Chancery"), land("Fortress"), land("Forest", 10), spell("Bolt", 1)], (id) => text[id] ?? "");
    expect(t.always.map((l) => l.card.name)).toEqual(["Chancery"]);
    expect(t.sometimes.map((l) => l.card.name)).toEqual(["Fortress"]);
  });
});

describe("rampRisk", () => {
  const ramp = new Set(["Sol Ring", "Arcane Signet", "Mind Stone", "Llanowar Elves", "Cultivate"]);
  it("warns when more than half the ramp is artifacts, from 4 ramp cards up", () => {
    const rocks = [spell("Sol Ring", 1, 1, "Artifact"), spell("Arcane Signet", 2, 1, "Artifact"), spell("Mind Stone", 2, 1, "Artifact"), spell("Llanowar Elves", 1, 1, "Creature — Elf Druid")];
    expect(rampRisk(rocks, (l) => ramp.has(l.card.name))).toEqual({ ramp: 4, artifacts: 3, risky: true });
    expect(rampRisk([...rocks, spell("Cultivate", 3), spell("Cultivate", 3)], (l) => ramp.has(l.card.name)).risky).toBe(false);
    expect(rampRisk(rocks.slice(0, 3), (l) => ramp.has(l.card.name)).risky).toBe(false); // only 3 ramp cards
  });
});

describe("deckHealth", () => {
  const even = [
    { color: "G" as const, pips: 10, pipShare: 0.5, sources: 15, sourceShare: 0.5 },
    { color: "U" as const, pips: 10, pipShare: 0.5, sources: 15, sourceShare: 0.5 },
  ];
  it("gives 100 to a deck that passes every check", () => {
    const h = deckHealth({ roles: [{ name: "Ramp", target: 10, count: 10 }], lands: 37, recommendedLands: 37, average: 3, colors: even, tapped: 1 });
    expect(h.score).toBe(100);
    expect(h.parts.map((p) => p.key)).toEqual(["roles", "lands", "curve", "colors", "tapped"]);
  });

  it("takes points for short roles, a land gap, a high curve, missing sources and tapped lands", () => {
    const h = deckHealth({
      roles: [{ name: "Ramp", target: 10, count: 5 }, { name: "Card advantage", target: 10, count: 10 }],
      lands: 34,
      recommendedLands: 37,
      average: 3.7,
      colors: [
        { color: "G", pips: 18, pipShare: 0.9, sources: 15, sourceShare: 0.6 },
        { color: "U", pips: 2, pipShare: 0.1, sources: 10, sourceShare: 0.4 },
      ],
      tapped: 6,
    });
    const part = (k: string) => h.parts.find((p) => p.key === k)!;
    expect(part("roles").score).toBe(75);
    expect(part("roles").detail).toBe("Under target: Ramp.");
    expect(part("lands").score).toBe(55);
    expect(part("curve").score).toBe(80);
    expect(part("colors").score).toBe(40);
    expect(part("colors").detail).toBe("Few sources for green.");
    expect(part("tapped").score).toBe(60);
    expect(h.score).toBe(Math.round((75 * 35 + 55 * 25 + 80 * 15 + 40 * 15 + 60 * 10) / 100));
  });

  it("leaves tapped lands out of the score while their text loads", () => {
    const h = deckHealth({ roles: [], lands: 37, recommendedLands: 37, average: 3, colors: even, tapped: null });
    expect(h.parts.some((p) => p.key === "tapped")).toBe(false);
    expect(h.score).toBe(100);
  });
});
