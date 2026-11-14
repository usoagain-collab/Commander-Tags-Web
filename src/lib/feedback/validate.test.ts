import { describe, expect, it } from "vitest";
import { checkFeedback, clientIp, crossSite, FEEDBACK, hashIp } from "./validate";

describe("checkFeedback", () => {
  it("accepts a message with page and no email", () => {
    expect(checkFeedback({ message: "  Love the tags ", page: "/decks/abc", elapsedMs: 9000 })).toEqual({
      kind: "ok",
      value: { message: "Love the tags", page: "/decks/abc", email: null },
    });
  });
  it("keeps a valid email", () => {
    const r = checkFeedback({ message: "hi there", email: " jo@example.com " });
    expect(r).toEqual({ kind: "ok", value: { message: "hi there", page: null, email: "jo@example.com" } });
  });
  it("refuses a bad email instead of dropping it silently", () => {
    expect(checkFeedback({ message: "hi", email: "not an email" }).kind).toBe("invalid");
  });
  it("refuses an empty or too long message", () => {
    expect(checkFeedback({ message: "   " }).kind).toBe("invalid");
    expect(checkFeedback({ message: "x".repeat(FEEDBACK.maxMessage + 1) }).kind).toBe("invalid");
    expect(checkFeedback(null).kind).toBe("invalid");
  });
  it("drops bots that fill the spam trap or post instantly", () => {
    expect(checkFeedback({ message: "buy now", website: "http://spam" })).toEqual({ kind: "drop" });
    expect(checkFeedback({ message: "buy now", elapsedMs: 200 })).toEqual({ kind: "drop" });
  });
  it("ignores a page that isn't a path on this site", () => {
    const r = checkFeedback({ message: "hi", page: "https://evil.example" });
    expect(r.kind === "ok" && r.value.page).toBe(null);
  });
});

describe("clientIp", () => {
  it("takes the first forwarded address", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers())).toBe(null);
  });
});

describe("hashIp", () => {
  it("is stable, depends on the secret and hides the address", async () => {
    const a = await hashIp("1.2.3.4", "s1");
    expect(a).toBe(await hashIp("1.2.3.4", "s1"));
    expect(a).not.toBe(await hashIp("1.2.3.4", "s2"));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toContain("1.2.3.4");
  });
});

describe("crossSite", () => {
  it("flags posts from another site only", () => {
    expect(crossSite(new Headers({ origin: "https://deckgenome.com", host: "deckgenome.com" }))).toBe(false);
    expect(crossSite(new Headers({ origin: "https://evil.example", host: "deckgenome.com" }))).toBe(true);
    expect(crossSite(new Headers({ host: "deckgenome.com" }))).toBe(false);
  });
});
