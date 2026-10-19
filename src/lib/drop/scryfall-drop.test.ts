import { describe, expect, it } from "vitest";
import { cleanAltName, looksDroppable, parseDroppedHtml, parseScryfallUrl, readDrop } from "./scryfall-drop";

const ID = "4cbc6901-6a4a-4d0a-83ea-7eefa3b35021";
// Markup copied from scryfall.com's search grid (Oct 2026).
const GRID_HTML = `<a class="card-grid-item-card" href="https://scryfall.com/card/c21/263/sol-ring"><img class="card c21 border-black " title="Sol Ring (Commander 2021 #263)" alt="Sol Ring (Commander 2021 #263)" loading="eager" src="https://cards.scryfall.io/grid/front/4/c/${ID}.webp?1783927506" /></a>`;

const data = (entries: Record<string, string>) => ({ types: Object.keys(entries), getData: (t: string) => entries[t] ?? "" });

describe("parseScryfallUrl", () => {
  it("reads the card id from any image size and format", () => {
    expect(parseScryfallUrl(`https://cards.scryfall.io/grid/front/4/c/${ID}.webp?1783927506`)).toEqual({ scryfallId: ID });
    expect(parseScryfallUrl(`https://cards.scryfall.io/large/back/4/c/${ID}.jpg`)).toEqual({ scryfallId: ID });
    expect(parseScryfallUrl(`https://cards.scryfall.io/art_crop/front/4/c/${ID}.jpg`)).toEqual({ scryfallId: ID });
  });

  it("reads set and collector number from card pages, including Tagger and odd numbers", () => {
    expect(parseScryfallUrl("https://scryfall.com/card/c21/263/sol-ring")).toEqual({ set: "c21", number: "263" });
    expect(parseScryfallUrl("https://tagger.scryfall.com/card/sld/1234")).toEqual({ set: "sld", number: "1234" });
    expect(parseScryfallUrl("https://scryfall.com/card/plst/C21-263/sol-ring")).toEqual({ set: "plst", number: "C21-263" });
    expect(parseScryfallUrl("https://scryfall.com/card/sld/1%E2%98%85/x")).toEqual({ set: "sld", number: "1★" });
  });

  it("ignores unrelated links", () => {
    expect(parseScryfallUrl("https://example.com/card/c21/263")).toEqual({});
  });
});

describe("dragged HTML", () => {
  it("takes the image id, the page link and the cleaned-up name", () => {
    expect(parseDroppedHtml(GRID_HTML)).toEqual({ scryfallId: ID, set: "c21", number: "263", name: "Sol Ring" });
  });

  it("strips Scryfall's set suffix from alt text", () => {
    expect(cleanAltName("Fire // Ice (Modern Horizons 3 #290)")).toBe("Fire // Ice");
    expect(cleanAltName("Sol Ring")).toBe("Sol Ring");
  });
});

describe("readDrop", () => {
  it("handles a full drag from Scryfall's grid", () => {
    const ref = readDrop(
      data({
        "text/uri-list": "https://scryfall.com/card/c21/263/sol-ring",
        "text/html": GRID_HTML,
        "text/plain": "https://scryfall.com/card/c21/263/sol-ring",
      }),
    );
    expect(ref).toEqual({ scryfallId: ID, set: "c21", number: "263", name: "Sol Ring" });
  });

  it("works with only a link", () => {
    expect(readDrop(data({ "text/uri-list": "# comment\nhttps://scryfall.com/card/c21/263/sol-ring" }))).toEqual({
      set: "c21",
      number: "263",
    });
  });

  it("treats dragged plain text as a card name", () => {
    expect(readDrop(data({ "text/plain": "Sol Ring" }))).toEqual({ name: "Sol Ring" });
  });

  it("returns null when nothing looks like a card", () => {
    expect(readDrop(data({ "text/plain": "https://example.com/" }))).toBeNull();
  });

  it("ignores files dragged from the desktop", () => {
    expect(looksDroppable(["Files"])).toBe(false);
    expect(looksDroppable(["text/uri-list", "text/html"])).toBe(true);
  });
});
