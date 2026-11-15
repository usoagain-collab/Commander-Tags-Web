import { describe, expect, it } from "vitest";
import { builderName, cobuildError, cobuildLink, readCobuild, readCobuildDecks, readCobuildInvite } from "./cobuild";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("readCobuild", () => {
  it("reads the owner view with its link and co-builders", () => {
    const info = readCobuild({
      is_owner: true,
      code: "abc123",
      owner: { name: "David", avatar_url: null },
      builders: [
        { user_id: A, name: "Sam", avatar_url: "https://x/a.png", me: false },
        { user_id: B, name: "  ", avatar_url: null, me: false },
      ],
    });
    expect(info).toEqual({
      isOwner: true,
      code: "abc123",
      owner: { name: "David", avatar_url: null },
      builders: [
        { user_id: A, name: "Sam", avatar_url: "https://x/a.png", me: false },
        { user_id: B, name: null, avatar_url: null, me: false },
      ],
    });
  });

  it("reads a co-builder view, which has no link", () => {
    const info = readCobuild({ is_owner: false, code: null, owner: { name: "David" }, builders: [{ user_id: A, me: true }] });
    expect(info?.isOwner).toBe(false);
    expect(info?.code).toBeNull();
    expect(info?.builders[0].me).toBe(true);
  });

  it("returns null for no access and skips broken rows", () => {
    expect(readCobuild(null)).toBeNull();
    expect(readCobuild([])).toBeNull();
    expect(readCobuild({ is_owner: true, builders: [{ name: "no id" }, 5] })?.builders).toEqual([]);
  });
});

describe("readCobuildDecks", () => {
  it("reads decks you build with someone", () => {
    expect(readCobuildDecks([{ id: A, name: "Omo", owner: "David", updated_at: "2026-11-15T09:00:00Z" }, { id: 3 }, null])).toEqual([
      { id: A, name: "Omo", owner: "David", updated_at: "2026-11-15T09:00:00Z" },
    ]);
    expect(readCobuildDecks({})).toEqual([]);
  });
});

describe("readCobuildInvite", () => {
  it("reads an invite", () => {
    expect(readCobuildInvite({ deck_id: A, deck_name: "Omo", owner: null, builders: "2", joined: false })).toEqual({
      deck_id: A,
      deck_name: "Omo",
      owner: null,
      builders: 2,
      joined: false,
    });
    expect(readCobuildInvite({ deck_name: "x" })).toBeNull();
  });
});

describe("helpers", () => {
  it("builds the invite link on this site", () => {
    expect(cobuildLink("abc", "https://deckgenome.com/")).toBe("https://deckgenome.com/decks/cobuild/abc");
  });

  it("shows a stand-in name", () => {
    expect(builderName(null)).toBe("A Deck Genome player");
    expect(builderName("Sam")).toBe("Sam");
  });

  it("passes on only the database's own messages", () => {
    expect(cobuildError("This deck already has 5 co-builders.", "x")).toBe("This deck already has 5 co-builders.");
    expect(cobuildError("permission denied for table decks", "Couldn't do that.")).toBe("Couldn't do that.");
    expect(cobuildError(undefined, "fallback")).toBe("fallback");
  });
});
