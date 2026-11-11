import { describe, expect, it } from "vitest";
import { normalizeOracle, selectionPhrase, wordingPhrases, wordingQuery } from "./wording";

const OMO =
  "Whenever Omo enters or attacks, put an everything counter on each of up to one target land and up to one target creature.\n" +
  "Each land with an everything counter on it is every land type in addition to its other types.\n" +
  "Each nonland creature with an everything counter on it is every creature type.";

describe("normalizeOracle", () => {
  it("writes the card's own names as ~, legends by their short name too", () => {
    expect(normalizeOracle(OMO, "Omo, Queen of Vesuva", "Legendary Creature — Shapeshifter").slice(0, 28)).toBe("whenever ~ enters or attacks");
    expect(normalizeOracle("Fire deals 2 damage.\n//\nTap target permanent.", "Fire // Ice")).toBe("~ deals 2 damage.\n//\ntap target permanent.");
    expect(normalizeOracle("When Kaboom! resolves", "Kaboom!")).toBe("when ~ resolves");
  });

  it("swaps whole words only, and short names only for legends", () => {
    expect(normalizeOracle("Ral gets general bonuses", "Ral, Crackling Wit", "Legendary Planeswalker — Ral")).toBe("~ gets general bonuses");
    expect(normalizeOracle("Ral is here", "Ral, Crackling Wit", "Planeswalker")).toBe("ral is here");
    expect(normalizeOracle("When Loran enters", "Loran of the Third Path", "Legendary Creature — Human Artificer")).toBe("when ~ enters");
  });
});

describe("wordingQuery and selectionPhrase", () => {
  it("builds a Scryfall rules-text search", () => {
    expect(wordingQuery('return a land you control')).toBe('o:"return a land you control"');
    expect(wordingQuery('say "hi"')).toBe('o:"say hi"');
  });

  it("cleans a selection: own name as ~, no edge punctuation, too short is null", () => {
    expect(selectionPhrase("Whenever Omo enters or attacks, ", "Omo, Queen of Vesuva", "Legendary Creature")).toBe("whenever ~ enters or attacks");
    expect(selectionPhrase("  of ", "Sol Ring")).toBeNull();
  });
});

describe("wordingPhrases", () => {
  it("Omo: its trigger, its action and its counter", () => {
    const p = wordingPhrases(OMO, "Omo, Queen of Vesuva", "Legendary Creature — Shapeshifter");
    expect(p[0]).toBe("whenever ~ enters or attacks");
    expect(p).toContain("put an everything counter");
    expect(p).toContain("everything counter");
  });

  it("landfall: the ability word and the trigger, without the reminder text", () => {
    const p = wordingPhrases("Landfall — Whenever a land you control enters, add one mana of any color. (Reminder text here.)", "Lotus Cobra", "Creature — Snake");
    expect(p).toEqual(["whenever a land you control enters", "landfall"]);
  });

  it("an activated ability's cost is a phrase, and numbers end a phrase", () => {
    const p = wordingPhrases("Sacrifice a creature: Scry 1.", "Viscera Seer", "Creature — Vampire Wizard");
    expect(p).toContain("sacrifice a creature");
    expect(p).not.toContain("scry 1");
  });

  it("flicker wording and planeswalker abilities", () => {
    const p = wordingPhrases(
      "Exile target creature you control, then return it to the battlefield under its owner's control.",
      "Cloudshift",
      "Instant",
    );
    expect(p).toEqual(["exile target creature you control", "return it to the battlefield"]);
    const ral = wordingPhrases(
      "Whenever you cast a noncreature spell, put a loyalty counter on Ral.\n+1: Create a 1/1 blue and red Otter creature token with prowess.\n−3: Draw three cards, then discard a card.",
      "Ral, Crackling Wit",
      "Legendary Planeswalker — Ral",
    );
    expect(ral).toContain("whenever you cast a noncreature spell");
    expect(ral).toContain("put a loyalty counter");
    expect(ral).toContain("discard a card");
    expect(ral).toContain("loyalty counter");
  });

  it("counter target spell is an action, not a kind of counter", () => {
    const p = wordingPhrases("Counter target spell.", "Counterspell", "Instant");
    expect(p).toEqual(["counter target spell"]);
  });
});
