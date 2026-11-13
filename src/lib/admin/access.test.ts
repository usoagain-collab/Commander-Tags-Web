import { describe, expect, it } from "vitest";
import { isAdmin, parseAdminIds } from "./access";

const DAVID = "3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b";
const OTHER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

describe("parseAdminIds", () => {
  it("reads ids separated by commas, spaces or new lines", () => {
    expect([...parseAdminIds(` ${DAVID}, ${OTHER}\n`)]).toEqual([DAVID, OTHER]);
  });
  it("ignores anything that isn't a user id", () => {
    expect(parseAdminIds("david@example.com, *, true, 1, ,").size).toBe(0);
  });
  it("is empty when the variable is missing", () => {
    expect(parseAdminIds(undefined).size).toBe(0);
    expect(parseAdminIds("").size).toBe(0);
  });
});

describe("isAdmin", () => {
  it("lets a listed user in", () => {
    expect(isAdmin(DAVID, DAVID)).toBe(true);
    expect(isAdmin(DAVID.toUpperCase(), `${OTHER},${DAVID}`)).toBe(true);
  });
  it("keeps everyone else out", () => {
    expect(isAdmin(OTHER, DAVID)).toBe(false);
  });
  it("keeps signed-out visitors out", () => {
    expect(isAdmin(null, DAVID)).toBe(false);
    expect(isAdmin(undefined, DAVID)).toBe(false);
    expect(isAdmin("", DAVID)).toBe(false);
  });
  it("keeps everyone out when no admins are set", () => {
    expect(isAdmin(DAVID, undefined)).toBe(false);
    expect(isAdmin(DAVID, "")).toBe(false);
  });
  it("needs a whole id, not part of one", () => {
    expect(isAdmin(DAVID.slice(0, 8), DAVID)).toBe(false);
    expect(isAdmin(DAVID, `${DAVID}x`)).toBe(false);
  });
  it("reads ADMIN_USER_IDS by default", () => {
    const before = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = DAVID;
    try {
      expect(isAdmin(DAVID)).toBe(true);
      expect(isAdmin(OTHER)).toBe(false);
    } finally {
      if (before === undefined) delete process.env.ADMIN_USER_IDS;
      else process.env.ADMIN_USER_IDS = before;
    }
  });
});
