// Open feedback (Nov 14, 2026): checks for what the Feedback form sends to /api/feedback. Pure functions, so the
// route stays thin and the rules are tested (validate.test.ts).

export const FEEDBACK = {
  maxMessage: 4000,
  maxPage: 300,
  maxEmail: 254,
  /** Messages one visitor (one IP address) can send per window. */
  perVisitor: 5,
  visitorWindowMs: 10 * 60 * 1000,
  /** Messages the whole site takes per hour, so a flood from many addresses can't fill the table. */
  perHourSiteWide: 100,
  /** A person takes longer than this to open the form and type; bots that post instantly are dropped. */
  minFillMs: 1500,
} as const;

// Loose on purpose: something@something.something with no spaces. Matches the check in migration 0054.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type FeedbackInput = { message: string; page: string | null; email: string | null };

export type FeedbackCheck =
  | { kind: "ok"; value: FeedbackInput }
  /** Looks like a bot (spam trap filled or sent too fast): answer "sent" but save nothing. */
  | { kind: "drop" }
  | { kind: "invalid"; error: string };

/** Reads the JSON body the form sends: { message, page, email, website (spam trap), elapsedMs }. */
export function checkFeedback(body: unknown): FeedbackCheck {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  // Spam trap: a field people never see. Anything in it means a bot filled every box.
  if (typeof b.website === "string" && b.website.trim() !== "") return { kind: "drop" };
  if (typeof b.elapsedMs === "number" && b.elapsedMs >= 0 && b.elapsedMs < FEEDBACK.minFillMs) return { kind: "drop" };

  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!message) return { kind: "invalid", error: "Write a message first." };
  if (message.length > FEEDBACK.maxMessage) return { kind: "invalid", error: `Keep it under ${FEEDBACK.maxMessage} characters.` };

  const rawPage = typeof b.page === "string" ? b.page.trim() : "";
  const page = rawPage.startsWith("/") ? rawPage.slice(0, FEEDBACK.maxPage) : null;

  const rawEmail = typeof b.email === "string" ? b.email.trim() : "";
  let email: string | null = null;
  if (rawEmail) {
    if (rawEmail.length > FEEDBACK.maxEmail || !EMAIL.test(rawEmail))
      return { kind: "invalid", error: "That email doesn't look right. Fix it or leave it empty." };
    email = rawEmail;
  }

  return { kind: "ok", value: { message, page, email } };
}

/** The visitor's IP address from the proxy headers (Vercel sets x-forwarded-for), or null when there is none. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}

/** One-way hash of the IP address with a server-only secret, so the table never holds the address itself. */
export async function hashIp(ip: string, secret: string): Promise<string> {
  const data = new TextEncoder().encode(`${secret}|${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest).slice(0, 16), (x) => x.toString(16).padStart(2, "0")).join("");
}

/** True when a cross-site page tries to post: the Origin header names another host than this request's. */
export function crossSite(headers: Headers): boolean {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}
