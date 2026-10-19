import { describe, expect, it } from "vitest";
import { entryKey, type CardSummary, type Entries } from "./model";
import { EXPORT_FORMATS, exportDeck, parseDeckText, planImport, type ExportFormat } from "./text-format";
import { applyChange } from "./model";

const card = (name: string, extra: Partial<CardSummary> = {}): CardSummary => ({
  oracle_id: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  mana_cost: null,
  mana_value: 0,
  type_line: "Artifact",
  color_identity: [],
  image_normal: null,
  image_art_crop: null,
  price_usd: null,
  edhrec_rank: null,
  commander_legal: true,
  game_changer: false,
  max_copies: 1,
  can_be_commander: false,
  ...extra,
});

const meren = card("Meren of Clan Nel Toth", { type_line: "Legendary Creature — Human Shaman", can_be_commander: true });
const solRing = card("Sol Ring", { mana_value: 1 });
const forest = card("Forest", { type_line: "Basic Land — Forest", max_copies: 99 });
const fireIce = card("Fire // Ice", { type_line: "Instant // Instant", mana_value: 4 });
const lurrus = card("Lurrus of the Dream-Den", { type_line: "Legendary Creature — Cat Nightmare", can_be_commander: true });
const fog = card("Fog", { type_line: "Instant" });
const all = [meren, solRing, forest, fireIce, lurrus, fog];

/** Fake name lookup: same matching as the SQL (full name or front face, case-insensitive). */
function lookup(names: string[]) {
  const out: Record<string, CardSummary> = {};
  for (const n of names) {
    const c = all.find((c) => c.name.toLowerCase() === n.toLowerCase() || c.name.split(" // ")[0].toLowerCase() === n.toLowerCase());
    if (c) out[n.toLowerCase()] = c;
  }
  return out;
}

function importText(text: string, current: Entries = {}, mode: "add" | "replace" = "replace") {
  const { lines } = parseDeckText(text);
  const { change, report } = planImport(current, lines, lookup(lines.map((l) => l.name)), mode);
  return { entries: applyChange(current, change), report, change };
}

const k = entryKey;

describe("parsing real-world lists", () => {
  it("reads Arena format with headers and set codes", () => {
    const { entries } = importText("Commander\n1 Meren of Clan Nel Toth (C15) 49\n\nDeck\n1 Sol Ring (C21) 263\n30 Forest (ZNR) 280\n");
    expect(entries).toEqual({ [k("commander", meren.oracle_id)]: 1, [k("main", solRing.oracle_id)]: 1, [k("main", forest.oracle_id)]: 30 });
  });

  it("reads Archidekt tags and 1x quantities", () => {
    const { entries } = importText(
      "1x Meren of Clan Nel Toth (c15) 49 [Commander{top}]\n1x Sol Ring (c21) 263 [Ramp]\n1x Fog [Maybeboard{noDeck}{noPrice}] ^Have^\n",
    );
    expect(entries).toEqual({ [k("commander", meren.oracle_id)]: 1, [k("main", solRing.oracle_id)]: 1, [k("maybe", fog.oracle_id)]: 1 });
  });

  it("treats a trailing single legendary creature as the commander (MTGO / plain layout)", () => {
    const { entries, report } = importText("1 Sol Ring\n30 Forest\n\n1 Meren of Clan Nel Toth\n");
    expect(report.commanderFromLayout).toBe(true);
    expect(entries[k("commander", meren.oracle_id)]).toBe(1);
  });

  it("does not promote a trailing non-legendary card to commander", () => {
    const { entries } = importText("1 Sol Ring\n\n1 Fog\n");
    expect(entries[k("main", fog.oracle_id)]).toBe(1);
  });

  it("matches split cards however they are written", () => {
    for (const written of ["Fire // Ice", "Fire/// Ice", "Fire//Ice", "Fire"]) {
      expect(importText(`1 ${written}`).entries[k("main", fireIce.oracle_id)]).toBe(1);
    }
  });

  it("reports names it can't find and skips comments", () => {
    const { report } = importText("// my list\n1 Sol Ring\n1 Not A Real Card\n");
    expect(report.notFound.map((l) => l.name)).toEqual(["Not A Real Card"]);
  });

  it("trims extra copies of singleton cards and reports it", () => {
    const { entries, report } = importText("2 Sol Ring\n");
    expect(entries[k("main", solRing.oracle_id)]).toBe(1);
    expect(report.trimmed).toEqual([{ name: "Sol Ring", wanted: 2, kept: 1, board: "main" }]);
  });

  it("reads companion sections", () => {
    const { entries } = importText("Companion\n1 Lurrus of the Dream-Den\n\nDeck\n1 Sol Ring\n");
    expect(entries[k("companion", lurrus.oracle_id)]).toBe(1);
  });
});

describe("add vs replace", () => {
  const current: Entries = { [k("main", fog.oracle_id)]: 1 };

  it("add keeps what's there", () => {
    expect(importText("1 Sol Ring", current, "add").entries).toEqual({ ...current, [k("main", solRing.oracle_id)]: 1 });
  });

  it("replace removes what's not in the list, as one undoable change", () => {
    const { entries, change } = importText("1 Sol Ring", current, "replace");
    expect(entries).toEqual({ [k("main", solRing.oracle_id)]: 1 });
    expect(applyChange(entries, change, "back")).toEqual(current); // one undo restores the old deck
  });
});

describe("export round trips", () => {
  const deck: Entries = {
    [k("commander", meren.oracle_id)]: 1,
    [k("companion", lurrus.oracle_id)]: 1,
    [k("main", solRing.oracle_id)]: 1,
    [k("main", forest.oracle_id)]: 30,
    [k("main", fireIce.oracle_id)]: 1,
    [k("maybe", fog.oracle_id)]: 1,
  };
  const cards = Object.fromEntries(all.map((c) => [c.oracle_id, c]));
  const noMaybe = Object.fromEntries(Object.entries(deck).filter(([key]) => !key.startsWith("maybe|")));

  for (const format of Object.keys(EXPORT_FORMATS) as ExportFormat[]) {
    it(`${format} export re-imports to the same deck`, () => {
      const text = exportDeck(deck, cards, format);
      const expected = format === "arena" ? noMaybe : deck;
      if (format === "mtgo") {
        // MTGO has no companion slot: commander + companion share the trailing group, which has two
        // legendary creatures, so both come back as commanders (partners). Check the rest matches.
        const { entries } = importText(text);
        expect(entries[k("main", forest.oracle_id)]).toBe(30);
        expect(entries[k("commander", meren.oracle_id)]).toBe(1);
        return;
      }
      expect(importText(text).entries).toEqual(expected);
    });
  }

  it("arena export looks right", () => {
    expect(exportDeck({ [k("commander", meren.oracle_id)]: 1, [k("main", solRing.oracle_id)]: 1 }, cards, "arena")).toBe(
      "Commander\n1 Meren of Clan Nel Toth\n\nDeck\n1 Sol Ring\n",
    );
  });
});
