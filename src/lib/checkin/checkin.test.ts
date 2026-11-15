import { describe, expect, it } from "vitest";
import { buildCheckinEmail, checkinLinks, checkinSecret, checkLink, cleanAnswer, isMonth, monthKey, monthName, pickRecipients, siteOrigin, signLink, summarize } from "./checkin";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("months", () => {
  it("uses Hawaii time", () => {
    // 05:00 UTC on Dec 1 is still Nov 30 in Honolulu.
    expect(monthKey(new Date("2026-12-01T05:00:00Z"))).toBe("2026-11");
    expect(monthKey(new Date("2026-12-01T12:00:00Z"))).toBe("2026-12");
  });
  it("names and checks months", () => {
    expect(monthName("2026-11")).toBe("November 2026");
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-01")).toBe(true);
  });
});

describe("cleanAnswer", () => {
  it("needs all three scores from 1 to 5", () => {
    expect(cleanAnswer({ liked: "4", easy: "5" }).problem).toMatch(/each question/);
    expect(cleanAnswer({ liked: "0", easy: "5", better: "3" }).problem).toMatch(/each question/);
    expect(cleanAnswer({ liked: "2.5", easy: "5", better: "3" }).problem).toMatch(/each question/);
  });
  it("cleans the note", () => {
    expect(cleanAnswer({ liked: "4", easy: "5", better: "3", note: "  more\u0007   combos \n please " }).answer).toEqual({ liked: 4, easy: 5, better: 3, note: "more combos \n please" });
    expect(cleanAnswer({ liked: 1, easy: 1, better: 1, note: "   " }).answer?.note).toBeNull();
    expect(cleanAnswer({ liked: 1, easy: 1, better: 1, note: "x".repeat(1001) }).problem).toMatch(/under 1000/);
  });
});

describe("signed links", () => {
  it("accepts its own link and nothing else", async () => {
    const t = await signLink("s3cret", "answer", A);
    expect(await checkLink("s3cret", "answer", A, t)).toBe(A);
    expect(await checkLink("s3cret", "answer", A.toUpperCase(), t)).toBe(A);
    expect(await checkLink("s3cret", "stop", A, t)).toBeNull();
    expect(await checkLink("s3cret", "answer", B, t)).toBeNull();
    expect(await checkLink("other", "answer", A, t)).toBeNull();
    expect(await checkLink(undefined, "answer", A, t)).toBeNull();
    expect(await checkLink("s3cret", "answer", "not-an-id", t)).toBeNull();
    expect(await checkLink("s3cret", "answer", A, "")).toBeNull();
  });
  it("picks the secret and the site", () => {
    expect(checkinSecret({ CHECKIN_SECRET: "a", SUPABASE_SERVICE_ROLE_KEY: "b" })).toBe("a");
    expect(checkinSecret({ SUPABASE_SERVICE_ROLE_KEY: "b" })).toBe("b");
    expect(checkinSecret({})).toBeUndefined();
    expect(siteOrigin({})).toBe("https://deckgenome.com");
    expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: "https://preview.example.com/" })).toBe("https://preview.example.com");
    expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: "javascript:alert(1)" })).toBe("https://deckgenome.com");
  });
});

describe("the email", () => {
  it("has the questions, the answer link and an unsubscribe", async () => {
    const links = await checkinLinks("https://deckgenome.com", "s", A);
    const mail = buildCheckinEmail({ name: "Ana <b>", month: "2026-11", links });
    expect(mail.subject).toBe("How's deckbuilding going? (November 2026)");
    expect(mail.text).toContain("Hi Ana <b>,");
    expect(mail.html).toContain("Hi Ana &lt;b&gt;,");
    expect(mail.text).toContain("How easy is Deck Genome to use?");
    expect(mail.text).toContain(links.answer);
    expect(mail.text).toContain(links.stopPage);
    expect(links.answer).toMatch(/^https:\/\/deckgenome\.com\/checkin\?u=/);
    expect(mail.headers["List-Unsubscribe"]).toBe(`<${links.oneClick}>`);
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(buildCheckinEmail({ name: null, month: "2026-11", links }).text.startsWith("Hi,")).toBe(true);
  });
});

describe("pickRecipients", () => {
  it("only confirmed, switched on and not yet sent", () => {
    const users = [
      { id: B, email: "b@x.com", email_confirmed_at: "2026-01-01" },
      { id: A, email: "a@x.com", email_confirmed_at: "2026-01-01" },
      { id: C, email: "c@x.com", email_confirmed_at: null },
      { id: "4", email: null, email_confirmed_at: "2026-01-01" },
      { id: "5", email: "e@x.com", email_confirmed_at: "2026-01-01" },
      { id: "6", email: "f@x.com", email_confirmed_at: "2026-01-01" },
    ];
    const profiles = new Map([
      [A, { checkin_emails: true, display_name: "Ana" }],
      [B, { checkin_emails: true, display_name: null }],
      [C, { checkin_emails: true, display_name: null }],
      ["5", { checkin_emails: false, display_name: null }],
      ["6", { checkin_emails: true, display_name: null }],
    ]);
    expect(pickRecipients(users, profiles, new Set(["6"]))).toEqual([
      { id: A, email: "a@x.com", name: "Ana" },
      { id: B, email: "b@x.com", name: null },
    ]);
  });
});

describe("summarize", () => {
  it("counts and averages per month, newest first", () => {
    const out = summarize(
      [{ month: "2026-11" }, { month: "2026-11" }, { month: "2026-12" }],
      [
        { month: "2026-11", liked: 4, easy: 5, better: 3 },
        { month: "2026-11", liked: 5, easy: 4, better: 4 },
      ],
    );
    expect(out).toEqual([
      { month: "2026-12", sent: 1, answers: 0, liked: 0, easy: 0, better: 0 },
      { month: "2026-11", sent: 2, answers: 2, liked: 4.5, easy: 4.5, better: 3.5 },
    ]);
  });
});
