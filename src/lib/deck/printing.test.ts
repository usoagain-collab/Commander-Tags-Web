import { describe, expect, it } from "vitest";
import {
  applyChange,
  applyPrintings,
  keepPrintings,
  linesFor,
  planMove,
  planPrinting,
  planRemove,
  toSavePayload,
  totalPrice,
  type CardSummary,
  type Change,
} from "./model";
import { foilFor, foilMarker, printingIdFromImage, printingImage, printingPrice, type ChosenPrinting } from "./printing";
import { diffDecks, planRestore, readSnapshot } from "./versions";
import { exportDeck, parseDeckText, planImport } from "./text-format";
import { chosenIllustrations } from "@/lib/tags/use-chosen-art-tags";
import { toPrinting } from "@/lib/scryfall/printings";

const ID = "abcdef12-0000-0000-0000-000000000000";
const sol: CardSummary = {
  oracle_id: "sol",
  name: "Sol Ring",
  mana_cost: "{1}",
  mana_value: 1,
  type_line: "Artifact",
  color_identity: [],
  image_normal: "https://cards.scryfall.io/normal/front/1/2/12000000-0000-0000-0000-000000000000.jpg?1",
  image_art_crop: null,
  price_usd: 1,
  edhrec_rank: 1,
  commander_legal: true,
  game_changer: false,
  max_copies: 1,
  can_be_commander: false,
  layout: "normal",
  counts_as_land: false,
};
const pick = (over: Partial<ChosenPrinting> = {}): ChosenPrinting => ({
  id: ID,
  set: "c21",
  set_name: "Commander 2021",
  number: "263",
  illustration_id: "art1",
  finishes: ["nonfoil", "foil"],
  usd: 3,
  usd_foil: 9,
  usd_etched: null,
  foil: false,
  ...over,
});

describe("printing basics", () => {
  it("builds CDN images and reads the id back from a default image", () => {
    expect(printingImage(ID)).toBe(`https://cards.scryfall.io/normal/front/a/b/${ID}.jpg`);
    expect(printingImage(ID, "art_crop", "back")).toContain("/art_crop/back/a/b/");
    expect(printingIdFromImage(sol.image_normal)).toBe("12000000-0000-0000-0000-000000000000");
    expect(printingIdFromImage(null)).toBeNull();
  });

  it("only allows the foil state a printing has", () => {
    expect(foilFor(["nonfoil"], true)).toBe(false);
    expect(foilFor(["foil"], false)).toBe(true);
    expect(foilFor(["etched"], false)).toBe(true);
    expect(foilFor(["nonfoil", "foil"], true)).toBe(true);
    expect(foilFor(["nonfoil", "foil"], false)).toBe(false);
  });

  it("prices the choice: foil price when foil, etched counts as foil", () => {
    expect(printingPrice(pick())).toBe(3);
    expect(printingPrice(pick({ foil: true }))).toBe(9);
    expect(printingPrice(pick({ foil: true, usd_foil: null, usd_etched: 7 }))).toBe(7);
    expect(printingPrice(pick({ usd: null }))).toBeNull();
  });

  it("reads a Scryfall card, with the illustration of a front face when needed", () => {
    const p = toPrinting(
      { id: ID, set: "c21", set_name: "C21", collector_number: "263", finishes: ["foil"], prices: { usd_foil: "2.50" }, card_faces: [{ illustration_id: "face" }] },
      false,
    );
    expect(p).toMatchObject({ number: "263", illustration_id: "face", usd: null, usd_foil: 2.5, foil: true });
  });
});

describe("deck lines and the total", () => {
  const cards = { sol };
  const entries = { "main|sol": 2 };

  it("shows the chosen image and price, and leaves untouched cards alone", () => {
    expect(linesFor(entries, cards, "main")[0].card).toBe(sol);
    const [line] = linesFor(entries, cards, "main", { "main|sol": pick() });
    expect(line.card.image_normal).toBe(printingImage(ID));
    expect(line.card.price_usd).toBe(3);
    expect(line.printing?.id).toBe(ID);
  });

  it("falls back to the cheapest price when the printing has none", () => {
    expect(linesFor(entries, cards, "main", { "main|sol": pick({ usd: null }) })[0].card.price_usd).toBe(1);
  });

  it("adds up chosen prices", () => {
    expect(totalPrice(entries, cards)).toBe(2);
    expect(totalPrice(entries, cards, undefined, { "main|sol": pick({ foil: true }) })).toBe(18);
  });
});

describe("planPrinting and undo", () => {
  it("makes one undoable change that autosave sends", () => {
    const plan = planPrinting({}, sol, "main", pick());
    if (!plan.ok) throw new Error(plan.reason);
    const after = applyPrintings({}, plan.change);
    expect(after["main|sol"].id).toBe(ID);
    expect(applyPrintings(after, plan.change, "back")).toEqual({});
    expect(toSavePayload(plan.change).printings).toEqual([{ oracle_id: "sol", board: "main", printing: pick() }]);
    expect(toSavePayload(plan.change, "back").printings[0].printing).toBeNull();
  });

  it("sees a foil switch as a change, and the same choice as none", () => {
    const now = { "main|sol": pick() };
    expect(planPrinting(now, sol, "main", pick()).ok).toBe(false);
    expect(planPrinting({}, sol, "main", null).ok).toBe(false);
    const plan = planPrinting(now, sol, "main", pick({ foil: true }));
    expect(plan.ok && plan.change.label).toBe("Mark Sol Ring foil");
    const back = planPrinting(now, sol, "main", null);
    expect(back.ok && back.change.label).toContain("default printing");
  });
});

describe("keepPrintings", () => {
  const printings = { "main|sol": pick({ foil: true }) };
  const entries = { "main|sol": 1 };

  it("carries the printing to the new board on a move, and undo puts it back", () => {
    const plan = planMove(entries, sol, "main", "maybe");
    if (!plan.ok) throw new Error(plan.reason);
    const change = keepPrintings(plan.change, printings);
    const after = applyPrintings(printings, change);
    expect(Object.keys(after)).toEqual(["maybe|sol"]);
    expect(after["maybe|sol"].foil).toBe(true);
    expect(applyPrintings(after, change, "back")).toEqual(printings);
  });

  it("brings the printing back when a removal is undone", () => {
    const plan = planRemove(entries, sol, "main");
    if (!plan.ok) throw new Error(plan.reason);
    const change = keepPrintings(plan.change, printings);
    expect(applyPrintings(printings, change)).toEqual({});
    expect(toSavePayload(change, "back").printings[0].printing?.id).toBe(ID);
  });

  it("leaves an edit that touches no chosen card unchanged", () => {
    const change: Change = { label: "x", rows: [{ oracle_id: "other", board: "main", from: 1, to: 0 }] };
    expect(keepPrintings(change, printings)).toBe(change);
  });
});

describe("version history", () => {
  it("reads a printing from a snapshot, and older snapshots without one", () => {
    const state = readSnapshot([["sol", "main", 1, null, pick()], ["old", "main", 1, null]]);
    expect(state.printings).toEqual({ "main|sol": pick() });
  });

  it("counts a printing or foil difference and restores it", () => {
    const current = { entries: { "main|sol": 1 }, categories: {}, printings: { "main|sol": pick() } };
    const target = { entries: { "main|sol": 1 }, categories: {}, printings: {} };
    expect(diffDecks(target, current).reprinted).toBe(1);
    expect(diffDecks(current, { ...current, printings: { "main|sol": pick({ foil: true }) } }).reprinted).toBe(1);
    const plan = planRestore(current, target, "Restore", "Before");
    if (!plan.ok) throw new Error(plan.reason);
    expect(applyPrintings(current.printings, plan.change)).toEqual({});
    expect(applyChange(current.entries, plan.change)).toEqual(current.entries);
    expect(planRestore(current, current, "Restore", "Before").ok).toBe(false);
  });
});

describe("import and export", () => {
  const cards = { sol };
  const entries = { "main|sol": 1 };

  it("exports set, number and foil where the format takes them", () => {
    const printings = { "main|sol": pick({ foil: true }) };
    expect(exportDeck(entries, cards, "moxfield", printings)).toContain("1 Sol Ring (C21) 263 *F*");
    expect(exportDeck(entries, cards, "archidekt", printings)).toContain("1x Sol Ring (C21) 263 *F*");
    expect(exportDeck(entries, cards, "plain", printings)).toContain("1 Sol Ring (C21) 263 *F*");
    expect(exportDeck(entries, cards, "arena", printings)).not.toContain("C21");
    expect(exportDeck(entries, cards, "moxfield")).toContain("1 Sol Ring\n");
    expect(foilMarker(pick({ foil: true, finishes: ["etched"] }))).toBe(" *E*");
  });

  it("parses the printing and foil back", () => {
    const { lines } = parseDeckText("1 Sol Ring (C21) 263 *F*\n1x Arcane Signet (PLST) C21-263\n1 Forest (ZNR)\n1 Island");
    expect(lines[0]).toMatchObject({ name: "Sol Ring", set: "C21", number: "263", foil: true });
    expect(lines[1]).toMatchObject({ name: "Arcane Signet", set: "PLST", number: "C21-263", foil: false });
    expect(lines[2].name).toBe("Forest");
    expect(lines[2].set).toBeUndefined();
    expect(lines[3].set).toBeUndefined();
  });

  it("plans the named printing with the import, and nothing when it already matches", () => {
    const { lines } = parseDeckText("1 Sol Ring (C21) 263");
    const found = { "sol ring": sol };
    const { change } = planImport({}, lines, found, "replace", { printingOf: () => pick() });
    expect(change.printings).toEqual([{ oracle_id: "sol", board: "main", from: null, to: pick() }]);
    const same = planImport(entries, lines, found, "replace", { printingOf: () => pick(), current: { "main|sol": pick() } });
    expect(same.change.printings).toBeUndefined();
  });
});

describe("chosenIllustrations", () => {
  it("prefers the deck printing over the maybeboard one", () => {
    expect(chosenIllustrations({ "maybe|sol": pick({ illustration_id: "m" }), "main|sol": pick({ illustration_id: "d" }) })).toEqual({ sol: "d" });
    expect(chosenIllustrations({ "main|sol": pick({ illustration_id: null }) })).toEqual({});
  });
});
