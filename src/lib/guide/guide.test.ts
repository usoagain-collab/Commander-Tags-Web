import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_TARGETS } from "@/lib/roles";
import { GUIDE_STEPS, startingTargets } from "./guide";

describe("first deck guide", () => {
  it("has unique anchors and numbered titles in order", () => {
    const ids = GUIDE_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    GUIDE_STEPS.forEach((s, i) => expect(s.title.startsWith(`${i + 1}. `)).toBe(true));
    for (const s of GUIDE_STEPS) expect(s.points.length).toBeGreaterThan(0);
  });

  it("shows the same starting targets new decks get", () => {
    const rows = startingTargets();
    expect(rows.find((r) => r.name === "Lands")?.target).toBe(DEFAULT_ROLE_TARGETS.lands);
    expect(rows.find((r) => r.name === "Ramp")?.target).toBe(DEFAULT_ROLE_TARGETS.ramp);
    expect(rows.find((r) => r.name === "Tutors")?.target).toBeNull();
    expect(rows.every((r) => r.target === null || r.target >= 0)).toBe(true);
  });
});
