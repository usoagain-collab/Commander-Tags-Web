import { describe, expect, it } from "vitest";
import { normalizeCard, type ScryfallCard } from "./card-details";

// Trimmed from real Scryfall responses (Oct 2026).
const omo: ScryfallCard = {
  name: "Omo, Queen of Vesuva",
  layout: "normal",
  mana_cost: "{2}{G/U}",
  type_line: "Legendary Creature — Shapeshifter Noble",
  oracle_text: "Whenever Omo enters or attacks, put an everything counter on each land and Shapeshifter you control.",
  power: "1",
  toughness: "5",
  image_uris: { normal: "https://cards.scryfall.io/normal/front/omo.jpg" },
  legalities: { standard: "not_legal", commander: "legal", modern: "legal", tlr: "not_legal", vintage: "restricted" },
  scryfall_uri: "https://scryfall.com/card/x/1/omo",
};

const room: ScryfallCard = {
  name: "Walk-In Closet // Forgotten Cellar",
  layout: "split",
  mana_cost: "{2}{G} // {3}{G}{G}",
  type_line: "Enchantment — Room // Enchantment — Room",
  image_uris: { normal: "https://cards.scryfall.io/normal/front/room.jpg" },
  card_faces: [
    { name: "Walk-In Closet", mana_cost: "{2}{G}", type_line: "Enchantment — Room", oracle_text: "You may play lands from your graveyard." },
    { name: "Forgotten Cellar", mana_cost: "{3}{G}{G}", type_line: "Enchantment — Room", oracle_text: "When you unlock this door…" },
  ],
};

const mdfc: ScryfallCard = {
  name: "Valakut Awakening // Valakut Stoneforge",
  layout: "modal_dfc",
  card_faces: [
    { name: "Valakut Awakening", mana_cost: "{2}{R}", type_line: "Instant", image_uris: { normal: "front.jpg" } },
    { name: "Valakut Stoneforge", mana_cost: "", type_line: "Land", image_uris: { normal: "back.jpg" } },
  ],
};

const planeswalker: ScryfallCard = { name: "Nissa", layout: "normal", type_line: "Legendary Planeswalker — Nissa", loyalty: "3" };

describe("normalizeCard", () => {
  it("turns a single-faced card into one face with its stats and image", () => {
    const d = normalizeCard(omo);
    expect(d.faces).toEqual([
      {
        name: "Omo, Queen of Vesuva",
        manaCost: "{2}{G/U}",
        typeLine: "Legendary Creature — Shapeshifter Noble",
        oracleText: omo.oracle_text,
        flavorText: undefined,
        stats: "1/5",
        image: "https://cards.scryfall.io/normal/front/omo.jpg",
      },
    ]);
    expect(d.flippable).toBe(false);
  });

  it("keeps both faces of a Room card, sharing one image (not flippable)", () => {
    const d = normalizeCard(room);
    expect(d.faces.map((f) => f.name)).toEqual(["Walk-In Closet", "Forgotten Cellar"]);
    expect(d.faces.map((f) => f.manaCost)).toEqual(["{2}{G}", "{3}{G}{G}"]);
    expect(d.flippable).toBe(false);
  });

  it("marks double-faced cards with an image per face as flippable", () => {
    const d = normalizeCard(mdfc);
    expect(d.flippable).toBe(true);
    expect(d.faces.map((f) => f.image)).toEqual(["front.jpg", "back.jpg"]);
  });

  it("shows loyalty for planeswalkers", () => {
    expect(normalizeCard(planeswalker).faces[0].stats).toBe("Loyalty 3");
  });

  it("lists legality with Commander first and keeps formats it doesn't know", () => {
    const rows = normalizeCard(omo).legalities;
    expect(rows[0]).toEqual({ format: "commander", name: "Commander", status: "legal" });
    expect(rows.map((r) => r.format)).toEqual(["commander", "standard", "modern", "vintage", "tlr"]);
    expect(rows.find((r) => r.format === "vintage")?.status).toBe("restricted");
  });

  it("passes rulings through", () => {
    expect(normalizeCard(omo, [{ date: "2025-01-01", text: "A ruling." }]).rulings).toHaveLength(1);
  });
});
