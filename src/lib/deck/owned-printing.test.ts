import { describe, expect, it } from "vitest";
import { groupRows, type OwnedRow, type PrintingInfo } from "./collection";
import type { Change } from "./model";
import { ownedPrintingFor, pinOwnedPrintings, readOwnedPrintings } from "./owned-printing";
import type { ChosenPrinting } from "./printing";

const info = (set: string, finishes = ["nonfoil", "foil"]): PrintingInfo => ({
  set,
  set_name: set.toUpperCase(),
  number: "1",
  illustration_id: null,
  finishes,
  usd: 1,
  usd_foil: 2,
  usd_etched: null,
});
const row = (oracle_id: string, printing_id: string | null, quantity: number, finish: OwnedRow["finish"] = "nonfoil", added_at = "2026-01-01"): OwnedRow => ({
  oracle_id,
  printing_id,
  finish,
  quantity,
  added_at,
  printing_info: printing_id ? info(printing_id) : null,
});
const add = (oracle_id: string, board: "main" | "maybe" = "main"): Change => ({ label: "Add", rows: [{ oracle_id, board, from: 0, to: 1 }] });

describe("ownedPrintingFor", () => {
  it("picks the printing you own most copies of, ignoring unknown printings", () => {
    const c = groupRows([row("sol", null, 9), row("sol", "c21", 1), row("sol", "cmm", 2)]);
    expect(ownedPrintingFor(c, "sol")).toMatchObject({ id: "cmm", set: "cmm", foil: false });
    expect(ownedPrintingFor(c, "other")).toBeNull();
    expect(ownedPrintingFor(groupRows([row("x", null, 3)]), "x")).toBeNull();
  });

  it("prefers nonfoil, then the copy added first, on a tie; keeps foil when that's what you own", () => {
    expect(ownedPrintingFor(groupRows([row("a", "f", 1, "foil"), row("a", "n", 1)]), "a")?.id).toBe("n");
    expect(ownedPrintingFor(groupRows([row("a", "late", 1, "nonfoil", "2026-05-01"), row("a", "early", 1, "nonfoil", "2026-02-01")]), "a")?.id).toBe("early");
    expect(ownedPrintingFor(groupRows([row("a", "f", 2, "foil")]), "a")?.foil).toBe(true);
  });
});

describe("pinOwnedPrintings", () => {
  const c = groupRows([row("sol", "cmm", 1)]);

  it("adds the owned printing to a new row", () => {
    const out = pinOwnedPrintings(add("sol"), {}, {}, c);
    expect(out.printings).toEqual([{ oracle_id: "sol", board: "main", from: null, to: expect.objectContaining({ id: "cmm" }) }]);
  });

  it("leaves rows with a printing, your own default printing, extra copies and unowned cards alone", () => {
    const chosen = { id: "c21" } as ChosenPrinting;
    const base = add("sol");
    expect(pinOwnedPrintings(base, { "main|sol": chosen }, {}, c)).toBe(base);
    expect(pinOwnedPrintings(base, {}, { sol: chosen }, c)).toBe(base);
    const more: Change = { label: "More", rows: [{ oracle_id: "sol", board: "main", from: 1, to: 2 }] };
    expect(pinOwnedPrintings(more, {}, {}, c)).toBe(more);
    const move: Change = { label: "Move", rows: [{ oracle_id: "sol", board: "main", from: 1, to: 0 }, { oracle_id: "sol", board: "maybe", from: 0, to: 1 }] };
    expect(pinOwnedPrintings(move, {}, {}, c)).toBe(move);
    const unowned = add("ring");
    expect(pinOwnedPrintings(unowned, {}, {}, c)).toBe(unowned);
    const pinned: Change = { ...base, printings: [{ oracle_id: "sol", board: "main", from: null, to: chosen }] };
    expect(pinOwnedPrintings(pinned, {}, {}, c).printings).toHaveLength(1);
  });

  it("is on unless switched off", () => {
    expect(readOwnedPrintings({})).toBe(true);
    expect(readOwnedPrintings({ ownedPrintings: false })).toBe(false);
  });
});
