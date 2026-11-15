import { describe, expect, it } from "vitest";
import { cleanPackageName, packageFromLines, planAddPackage } from "./packages";
import type { CardSummary } from "./model";

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
  layout: "normal",
  counts_as_land: false,
  ...extra,
});
const sol = card("Sol Ring");
const signet = card("Arcane Signet");
const forest = card("Forest", { max_copies: 99, type_line: "Basic Land — Forest" });
const omo = card("Omo", { can_be_commander: true });

describe("packageFromLines", () => {
  it("adds copies up, leaves out commanders", () => {
    expect(
      packageFromLines([
        { card: omo, board: "commander", quantity: 1 },
        { card: sol, board: "main", quantity: 1 },
        { card: forest, board: "main", quantity: 5 },
        { card: forest, board: "maybe", quantity: 2 },
      ]),
    ).toEqual([
      { oracle_id: "sol-ring", quantity: 1 },
      { oracle_id: "forest", quantity: 7 },
    ]);
  });
});

describe("planAddPackage", () => {
  const items = [
    { card: sol, quantity: 1 },
    { card: signet, quantity: 1 },
    { card: forest, quantity: 4 },
  ];

  it("adds what's missing as one edit and names what's already there", () => {
    const r = planAddPackage({ "main|sol-ring": 1, "main|forest": 1 }, items, "main", "Ramp");
    expect(r.already).toEqual(["Sol Ring"]);
    expect(r.added).toBe(2);
    expect(r.plan.ok && r.plan.change.label).toBe("Added Ramp (2 cards)");
    const rows = r.plan.ok ? r.plan.change.rows : [];
    expect(rows.find((x) => x.oracle_id === "forest")).toMatchObject({ from: 1, to: 4 });
    expect(rows.find((x) => x.oracle_id === "arcane-signet")).toMatchObject({ board: "main", from: 0, to: 1 });
  });

  it("goes to the maybeboard when asked, counting only maybeboard copies", () => {
    const r = planAddPackage({ "main|sol-ring": 1 }, [{ card: sol, quantity: 1 }], "maybe", "Ramp");
    expect(r.plan.ok && r.plan.change.rows).toEqual([expect.objectContaining({ board: "maybe", from: 0, to: 1 })]);
  });

  it("says so when everything is already in the deck", () => {
    const r = planAddPackage({ "main|sol-ring": 1 }, [{ card: sol, quantity: 1 }], "main", "Ramp");
    expect(r.plan).toEqual({ ok: false, reason: "Every card in Ramp is already here." });
  });
});

describe("cleanPackageName", () => {
  it("trims and folds spaces", () => expect(cleanPackageName("  Ramp   suite ")).toBe("Ramp suite"));
});
