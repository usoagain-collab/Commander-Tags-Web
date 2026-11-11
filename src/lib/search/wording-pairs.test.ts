import { describe, expect, it } from "vitest";
import { angleQuery, MAX_WORDING_PHRASES, MIRRORS, onePerReason, spreadByReason, wordingPlan } from "./wording-pairs";

const TATYOVA = {
  name: "Tatyova, Benthic Druid",
  type_line: "Legendary Creature — Merfolk Druid",
  text: "Landfall — Whenever a land you control enters, you gain 1 life and draw a card.",
};

describe("wordingPlan", () => {
  it("landfall: the commander's own wording, then cards that make lands enter", () => {
    const plan = wordingPlan([TATYOVA]);
    expect(plan.phrases.slice(0, 2)).toEqual(["whenever a land you control enters", "landfall"]);
    expect(plan.phrases).toContain("return a land you control to its owner's hand");
    expect(plan.why["landfall"]).toBe("Same wording as Tatyova");
    expect(plan.why["you may play an additional land"]).toBe("Feeds Tatyova: makes lands enter");
    // Too common to say anything about the deck.
    expect(plan.phrases).not.toContain("draw a card");
  });

  it("no wording, no plan; partners share one list with no repeats, capped", () => {
    expect(wordingPlan([{ name: "Vanilla", type_line: "Creature", text: "" }]).phrases).toEqual([]);
    const meren = { name: "Meren of Clan Nel Toth", type_line: "Legendary Creature — Human Shaman", text: "Whenever another creature you control dies, you get an experience counter." };
    const plan = wordingPlan([TATYOVA, meren]);
    expect(new Set(plan.phrases).size).toBe(plan.phrases.length);
    expect(plan.phrases.length).toBeLessThanOrEqual(MAX_WORDING_PHRASES);
    expect(plan.phrases).toContain("sacrifice a creature");
    expect(plan.why["sacrifice a creature"]).toBe("Feeds Meren: makes creatures die");
  });

  it("Omo: every land type finds Gates and Urza lands, every creature type finds typal cards (David, Nov 10, 2026)", () => {
    const omo = {
      name: "Omo, Queen of Vesuva",
      type_line: "Legendary Creature — Shapeshifter",
      text:
        "Whenever Omo enters or attacks, put an everything counter on each of up to one target land and up to one target creature.\n" +
        "Each land with an everything counter on it is every land type in addition to its other types.\n" +
        "Each nonland creature with an everything counter on it is every creature type.",
    };
    const plan = wordingPlan([omo]);
    expect(plan.phrases).toEqual(expect.arrayContaining(["gates with different names", "urza's", "choose a creature type"]));
    expect(plan.why["urza's"]).toBe("Feeds Omo: counts land types, and every land has them all");
    expect(plan.phrases).not.toContain("proliferate");
    expect(plan.angles.map((a) => a.name)).toEqual(["Omo's own wording", "Land types", "Typal"]);
    // An angle keeps every phrase, even ones the mixed search had no room for.
    expect(plan.angles[2].phrases).toContain("creatures of that type");
  });

  it("one phrase per reason, and at most 3 rows per reason while others are waiting", () => {
    const why = { a: "typal", b: "typal", c: "land types" };
    expect(onePerReason(["a", "b", "c"], why)).toEqual(["a", "c"]);
    const rows = ["a", "a", "a", "a", "a", "c", "c"].map((p, i) => ({ id: i, says: [p] }));
    expect(spreadByReason(rows, why, 5).map((r) => r.id)).toEqual([0, 1, 2, 5, 6]);
    // Nothing else waiting: the fourth typal card still fills a slot.
    expect(spreadByReason(rows.slice(0, 5), why, 4).map((r) => r.id)).toEqual([0, 1, 2, 3]);
  });

  it("broader pairs (Nov 11, 2026): the right idea for commanders that had none, and not the wrong one", () => {
    const names = (name: string, type_line: string, text: string) =>
      wordingPlan([{ name, type_line, text }]).angles.filter((a) => !a.key.startsWith("Same wording")).map((a) => a.name);
    expect(names("Sram, Senior Edificer", "Legendary Creature — Dwarf Advisor", "Whenever you cast an Aura, Equipment, or Vehicle spell, draw a card.")).toContain("Auras and Equipment");
    expect(
      names("The Gitrog Monster", "Legendary Creature — Frog Horror", "Whenever one or more land cards are put into your graveyard from anywhere, draw a card."),
    ).toContain("Lands to the graveyard");
    expect(names("Lyra Dawnbringer", "Legendary Creature — Angel", "Flying\nOther Angels you control get +1/+1 and have lifelink.")).toContain("Its creature type");
    expect(names("Torbran, Thane of Red Fell", "Legendary Creature — Dwarf Noble", "If a red source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.")).toEqual(["Burn and pings"]);
    expect(
      names("Mondrak, Glory Dominus", "Legendary Creature — Phyrexian Horror", "If one or more tokens would be created under your control, twice that many of those tokens are created instead."),
    ).toContain("More tokens");
    // Veyran doubles spell triggers, not creature triggers.
    expect(
      names(
        "Veyran, Voice of Duality",
        "Legendary Creature — Efreet Wizard",
        "Magecraft — Whenever you cast or copy an instant or sorcery spell, Veyran gets +1/+1 until end of turn.\nIf you casting or copying an instant or sorcery spell causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.",
      ),
    ).toEqual(["Cheap spells"]);
  });

  it("an angle is one Scryfall search for any of its phrases", () => {
    expect(angleQuery({ phrases: ["gate you control", "urza's"] })).toBe(`(o:"gate you control" or o:"urza's")`);
    expect(angleQuery({ phrases: ["landfall"] })).toBe(`o:"landfall"`);
  });

  it("mirror phrases are plain lower-case rules text, at least 4 characters (what the database matches)", () => {
    for (const m of MIRRORS) for (const p of m.also) expect(p === p.toLowerCase() && p.trim() === p && p.length >= 4, p).toBe(true);
  });
});
