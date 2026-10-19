import { describe, expect, it } from "vitest";
import type { DeckLine } from "@/lib/deck/model";
import {
  buildRoleDefs,
  readCustomRoles,
  readTargets,
  roleCounts,
  roleNameFromLabel,
  roleStatus,
  statusText,
} from "./role-settings";

describe("saved role settings", () => {
  it("keeps whole-number targets between 0 and 99 and drops junk", () => {
    expect(readTargets({ ramp: 12, draw: "9", wipes: -3, lands: 200.4, bad: "x" })).toEqual({ ramp: 12, draw: 9, wipes: 0, lands: 99 });
    expect(readTargets(null)).toEqual({});
  });

  it("reads custom roles, dropping duplicates and blanks", () => {
    expect(
      readCustomRoles([
        { slug: "sacrifice-outlet", name: "Sac outlets", target: 6 },
        { slug: "sacrifice-outlet", name: "dupe", target: 1 },
        { slug: "", name: "blank", target: 1 },
        { slug: "landfall", name: "  ", target: "4" },
      ]),
    ).toEqual([
      { slug: "sacrifice-outlet", name: "Sac outlets", target: 6 },
      { slug: "landfall", name: "landfall", target: 4 },
    ]);
  });
});

describe("buildRoleDefs", () => {
  it("applies this deck's targets to the standard roles and appends custom roles", () => {
    const defs = buildRoleDefs({ ramp: 14 }, [{ slug: "landfall", name: "Landfall", target: 8 }]);
    expect(defs.find((r) => r.key === "ramp")!.target).toBe(14);
    expect(defs.find((r) => r.key === "lands")!.target).toBe(37); // untouched default
    expect(defs.at(-1)).toEqual({ key: "c:landfall", name: "Landfall", target: 8, slugs: ["landfall"], custom: true });
  });
});

describe("counts and status", () => {
  const line = (name: string, quantity = 1) => ({ board: "main", quantity, card: { name } }) as unknown as DeckLine;
  const fills: Record<string, string[]> = { Forest: ["lands"], "Sink into Stupor": ["lands", "removal"], "Sol Ring": ["ramp"] };

  it("counts each role a card fills, by quantity", () => {
    expect(roleCounts([line("Forest", 30), line("Sink into Stupor"), line("Sol Ring")], (l) => fills[l.card.name])).toEqual({
      lands: 31,
      removal: 1,
      ramp: 1,
    });
  });

  it("describes under / met / over like the spec's bars", () => {
    expect([roleStatus(3, 5), roleStatus(5, 5), roleStatus(7, 5)]).toEqual(["under", "met", "over"]);
    expect([statusText(3, 5), statusText(5, 5), statusText(7, 5)]).toEqual(["need 2", "on target", "+2"]);
  });

  it("makes a readable role name from a tag label", () => {
    expect(roleNameFromLabel("sacrifice-outlet")).toBe("Sacrifice outlet");
  });
});
