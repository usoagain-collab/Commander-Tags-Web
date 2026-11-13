import { describe, expect, it } from "vitest";
import { buildStats, dayKey, lastDays } from "./stats";

// Nov 13, 2026 at 2 PM in Hawaii (UTC-10).
const NOW = new Date("2026-11-14T00:00:00Z");

describe("dayKey", () => {
  it("counts days in Hawaii time", () => {
    // 3 AM UTC on Nov 13 is still Nov 12 in Hawaii.
    expect(dayKey("2026-11-13T03:00:00Z")).toBe("2026-11-12");
    expect(dayKey("2026-11-13T11:00:00Z")).toBe("2026-11-13");
  });
});

describe("lastDays", () => {
  it("lists n days ending today, newest first", () => {
    expect(lastDays(NOW, 3)).toEqual(["2026-11-13", "2026-11-12", "2026-11-11"]);
  });
});

describe("buildStats", () => {
  const users = [
    { id: "a", email: "a@x.test", created_at: "2026-11-13T20:00:00Z", last_sign_in_at: "2026-11-13T21:00:00Z" },
    { id: "b", email: "b@x.test", created_at: "2026-11-01T20:00:00Z", last_sign_in_at: "2026-11-10T20:00:00Z" },
    { id: "c", email: null, created_at: "2026-09-01T20:00:00Z", last_sign_in_at: "2026-09-02T20:00:00Z" },
    { id: "p", email: "precons@commander-tags.test", created_at: "2026-11-13T20:00:00Z", last_sign_in_at: null },
    { id: "t", email: "TEST-USER@commander-tags.test", created_at: "2026-11-13T20:00:00Z", last_sign_in_at: "2026-11-13T20:00:00Z" },
  ];
  const decks = [
    { owner_id: "a", created_at: "2026-11-13T22:00:00Z", updated_at: "2026-11-13T23:00:00Z" },
    { owner_id: "a", created_at: "2026-11-12T22:00:00Z", updated_at: "2026-11-12T22:00:00Z" },
    { owner_id: "b", created_at: "2026-10-01T22:00:00Z", updated_at: "2026-10-02T22:00:00Z" },
    { owner_id: "p", created_at: "2026-11-13T20:00:00Z", updated_at: "2026-11-13T20:00:00Z" },
    { owner_id: "t", created_at: "2026-11-13T20:00:00Z", updated_at: "2026-11-13T20:00:00Z" },
  ];
  const s = buildStats(users, decks, NOW, { days: 30, recent: 2 });

  it("leaves out the Precons and test accounts and their decks", () => {
    expect(s.totals.users).toBe(3);
    expect(s.totals.decks).toBe(3);
    expect(s.recent.map((r) => r.id)).not.toContain("p");
  });

  it("counts totals and the last 7 and 30 days", () => {
    expect(s.totals).toEqual({
      users: 3,
      usersWithDecks: 2,
      active7: 2,
      active30: 2,
      newUsers7: 1,
      decks: 3,
      newDecks7: 2,
      editedDecks7: 2,
    });
  });

  it("buckets sign-ups and new decks by Hawaii day", () => {
    expect(s.daily).toHaveLength(30);
    expect(s.daily[0]).toEqual({ day: "2026-11-13", signUps: 1, decks: 1 });
    expect(s.daily[1]).toEqual({ day: "2026-11-12", signUps: 0, decks: 1 });
    expect(s.daily.find((d) => d.day === "2026-11-01")).toEqual({ day: "2026-11-01", signUps: 1, decks: 0 });
    // Older than 30 days: in the totals, not in the daily rows.
    expect(s.daily.reduce((n, d) => n + d.decks, 0)).toBe(2);
  });

  it("lists the newest sign-ups with their deck counts", () => {
    expect(s.recent).toEqual([
      { id: "a", joined: "2026-11-13T20:00:00Z", lastSignIn: "2026-11-13T21:00:00Z", decks: 2 },
      { id: "b", joined: "2026-11-01T20:00:00Z", lastSignIn: "2026-11-10T20:00:00Z", decks: 1 },
    ]);
  });
});
