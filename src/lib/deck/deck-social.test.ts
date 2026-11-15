import { describe, expect, it } from "vitest";
import { cleanComment, cleanDescription, DESCRIPTION_MAX, friendlyError, likeLabel, readSocial } from "./deck-social";

describe("cleanDescription", () => {
  it("keeps line breaks, folds blank runs and spaces, trims", () => {
    expect(cleanDescription("  Go wide.\r\n\r\n\r\n\r\nThen   win  \n  big ")).toBe("Go wide.\n\nThen win\nbig");
  });
  it("treats empty as none and caps length", () => {
    expect(cleanDescription("   \n  ")).toBeNull();
    expect(cleanDescription(null)).toBeNull();
    expect(cleanDescription("x".repeat(DESCRIPTION_MAX + 50))!.length).toBe(DESCRIPTION_MAX);
  });
});

describe("cleanComment", () => {
  it("returns null for nothing to send", () => {
    expect(cleanComment("  ")).toBeNull();
    expect(cleanComment(" Try Smothering Tithe ")).toBe("Try Smothering Tithe");
  });
});

describe("readSocial", () => {
  it("reads the server answer and drops malformed comments", () => {
    const s = readSocial({
      description: "Tokens",
      comments_open: false,
      likes: "3",
      liked: true,
      comments: [
        { id: "a", body: "Nice", created_at: "2026-11-15T00:00:00Z", author: " ", mine: true, can_delete: true },
        { body: "no id" },
        null,
      ],
    });
    expect(s).toMatchObject({ description: "Tokens", comments_open: false, likes: 3, liked: true });
    expect(s!.comments).toHaveLength(1);
    expect(s!.comments[0]).toMatchObject({ id: "a", author: null, mine: true, can_delete: true, is_owner: false });
  });
  it("returns null for no deck, and defaults the rest", () => {
    expect(readSocial(null)).toBeNull();
    expect(readSocial({})).toEqual({ description: null, comments_open: true, likes: 0, liked: false, comments: [] });
  });
});

describe("likeLabel and friendlyError", () => {
  it("words the count", () => {
    expect(likeLabel(1)).toBe("1 like");
    expect(likeLabel(0)).toBe("0 likes");
  });
  it("shows our own sentences and hides technical ones", () => {
    expect(friendlyError("Comments are off for this deck.", "x")).toBe("Comments are off for this deck.");
    expect(friendlyError('function public.add_deck_comment does not exist', "Couldn't post.")).toBe("Couldn't post.");
    expect(friendlyError(undefined, "fallback")).toBe("fallback");
  });
});
