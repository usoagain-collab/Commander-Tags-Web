import { describe, expect, it } from "vitest";
import { artCreditText, artistNames, atSize } from "./art-credit";

describe("art credit", () => {
  it("names each artist once, skipping blanks", () => {
    expect(artistNames(["Rebecca Guay", null, " Rebecca Guay ", "", undefined, "Kev Walker"])).toEqual(["Rebecca Guay", "Kev Walker"]);
  });
  it("adds the copyright line", () => {
    expect(artCreditText(["Kev Walker"])).toBe("Art by Kev Walker. ™ & © Wizards of the Coast");
  });
  it("says nothing when no artist is known", () => {
    expect(artCreditText([null, undefined])).toBeNull();
  });
  it("switches a CDN image to another size", () => {
    expect(atSize("https://cards.scryfall.io/art_crop/front/a/b/ab.jpg?123", "small")).toBe("https://cards.scryfall.io/small/front/a/b/ab.jpg?123");
    expect(atSize("https://cards.scryfall.io/normal/back/a/b/ab.jpg", "small")).toBe("https://cards.scryfall.io/small/back/a/b/ab.jpg");
  });
});
