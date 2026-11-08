import { describe, expect, it } from "vitest";
import type { DeckLine } from "@/lib/deck/model";
import {
  buildRoleDefs,
  hiddenRoleKeys,
  withRoleHidden,
  readCustomRoles,
  readTargets,
  roleCounts,
  roleNameFromLabel,
  roleStatus,
  statusText,
  withoutBracketTargets,
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

describe("hidden roles", () => {
  it("hides and shows a role without touching its target", () => {
    const hidden = withRoleHidden({ recursion: 4 }, "recursion", true);
    expect(hiddenRoleKeys(readTargets(hidden))).toEqual(new Set(["recursion", "tutors"]));
    expect(buildRoleDefs(hidden, []).find((r) => r.key === "recursion")!.target).toBe(4);
    expect(withRoleHidden(hidden, "recursion", false)).toEqual({ recursion: 4 });
  });

  it("hides Tutors until the user shows it, and remembers either choice", () => {
    expect(hiddenRoleKeys({})).toEqual(new Set(["tutors"]));
    const shown = withRoleHidden({}, "tutors", false);
    expect(shown).toEqual({ "hide:tutors": 0 });
    expect(hiddenRoleKeys(readTargets(shown)).has("tutors")).toBe(false);
    expect(hiddenRoleKeys(withRoleHidden(shown, "tutors", true)).has("tutors")).toBe(true);
  });
});

describe("buildRoleDefs", () => {
  it("applies this deck's targets to the standard roles and appends custom roles", () => {
    const defs = buildRoleDefs({ ramp: 14 }, [{ slug: "landfall", name: "Landfall", target: 8 }]);
    expect(defs.find((r) => r.key === "ramp")!.target).toBe(14);
    expect(defs.find((r) => r.key === "lands")!.target).toBe(37); // untouched default
    expect(defs.at(-1)).toEqual({ key: "c:landfall", name: "Landfall", target: 8, slugs: ["landfall"], custom: true });
  });

  it("gives Tutors its bracket's target until the deck saves its own", () => {
    const tutors = (targets: Record<string, number>, bracket?: 1 | 2 | 3 | 4 | 5) =>
      buildRoleDefs(targets, [], bracket).find((r) => r.key === "tutors")!.target;
    expect([1, 2, 3, 4, 5].map((b) => tutors({}, b as 1))).toEqual([0, 1, 3, 6, 10]);
    expect(tutors({})).toBe(3); // no bracket given: bracket 3
    expect(tutors({ tutors: 5 }, 1)).toBe(5); // a moved slider wins over the bracket
  });

  it("leaves Tutors out of defaults, so each deck follows its own bracket", () => {
    expect(withoutBracketTargets({ ramp: 12, tutors: 4, "hide:tutors": 1 })).toEqual({ ramp: 12, "hide:tutors": 1 });
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
