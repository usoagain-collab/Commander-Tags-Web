import { describe, expect, it } from "vitest";
import { isCollectorEdition, preconRows, type MtgjsonCard } from "./precons";

const card = (name: string, oracle: string, scryfallId: string, count = 1, isFoil = false): MtgjsonCard => ({
  name,
  count,
  isFoil,
  identifiers: { scryfallOracleId: oracle, scryfallId },
});

describe("precons", () => {
  it("turns an MTGJSON deck into rows, joining printings of the same card", () => {
    const { rows, missing } = preconRows(
      {
        name: "Federation Fleet",
        code: "TRC",
        releaseDate: "2026-11-13",
        type: "Commander Deck",
        commander: [card("Picard", "o-pic", "p-pic", 1, true)],
        mainBoard: [card("Island", "o-isl", "p-isl1", 5), card("Island", "o-isl", "p-isl2", 3), card("Sol Ring", "o-sol", "p-sol"), card("New Card", "o-new", "p-new")],
        sideBoard: [card("Spare", "o-spare", "p-spare")],
      },
      (id) => id !== "o-new",
    );
    expect(missing).toEqual(["New Card"]);
    expect(rows).toEqual([
      { oracle_id: "o-pic", board: "commander", quantity: 1, printing_id: "p-pic", foil: true, split: [] },
      { oracle_id: "o-isl", board: "main", quantity: 8, printing_id: "p-isl1", foil: false, split: [{ printing_id: "p-isl2", foil: false, quantity: 3 }] },
      { oracle_id: "o-sol", board: "main", quantity: 1, printing_id: "p-sol", foil: false, split: [] },
      { oracle_id: "o-spare", board: "maybe", quantity: 1, printing_id: "p-spare", foil: false, split: [] },
    ]);
  });

  it("knows a Collector's Edition by its name", () => {
    expect(isCollectorEdition("Federation Fleet Collector's Edition")).toBe(true);
    expect(isCollectorEdition("Federation Fleet")).toBe(false);
  });
});
