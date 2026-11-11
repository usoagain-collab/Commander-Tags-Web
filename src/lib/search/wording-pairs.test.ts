import { describe, expect, it } from "vitest";
import { MAX_WORDING_PHRASES, MIRRORS, wordingPlan } from "./wording-pairs";

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

  it("mirror phrases are plain lower-case rules text, at least 4 characters (what the database matches)", () => {
    for (const m of MIRRORS) for (const p of m.also) expect(p === p.toLowerCase() && p.trim() === p && p.length >= 4, p).toBe(true);
  });
});
