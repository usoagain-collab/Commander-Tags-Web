import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DAVID = "3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b";
const OTHER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const user = vi.hoisted(() => ({ current: null as { id: string } | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/user", () => ({ getCurrentUser: async () => user.current }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { requireAdmin } from "./require-admin";

describe("requireAdmin", () => {
  let before: string | undefined;
  beforeEach(() => {
    before = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = DAVID;
  });
  afterEach(() => {
    if (before === undefined) delete process.env.ADMIN_USER_IDS;
    else process.env.ADMIN_USER_IDS = before;
  });

  it("lets the admin in", async () => {
    user.current = { id: DAVID };
    await expect(requireAdmin()).resolves.toEqual({ id: DAVID });
  });
  it("shows not found to other signed-in users", async () => {
    user.current = { id: OTHER };
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("shows not found to signed-out visitors", async () => {
    user.current = null;
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("shows not found to everyone when ADMIN_USER_IDS isn't set", async () => {
    delete process.env.ADMIN_USER_IDS;
    user.current = { id: DAVID };
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
