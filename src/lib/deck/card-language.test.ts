import { describe, expect, it } from "vitest";
import { localizeCard, readCardLang } from "./card-language";
import type { CardSummary } from "./model";

describe("card language", () => {
  it("reads the saved language, English by default", () => {
    expect(readCardLang({ cardLang: "ja" })).toBe("ja");
    expect(readCardLang({ cardLang: "xx" })).toBe("en");
    expect(readCardLang(null)).toBe("en");
  });

  it("swaps the picture for the localized printing and keeps the art crop", () => {
    const card = {
      oracle_id: "o",
      image_normal: "https://cards.scryfall.io/normal/front/8/5/853bf74d-0b61-43df-9018-0b40b624a9d1.jpg?1783908887",
      image_art_crop: "art",
    } as CardSummary;
    const ja = localizeCard(card, (id) => (id === "853bf74d-0b61-43df-9018-0b40b624a9d1" ? { localized_id: "aabbccdd-0000-0000-0000-000000000000", image_v: "5" } : undefined));
    expect(ja.image_normal).toBe("https://cards.scryfall.io/normal/front/a/a/aabbccdd-0000-0000-0000-000000000000.jpg?5");
    expect(ja.image_art_crop).toBe("art");
    expect(localizeCard(card, () => null)).toBe(card);
  });
});
