// Monthly check-in email (V3, migration 0063; David, Nov 13, 2026): three quick questions once a month, with an
// optional note and a one-click unsubscribe. Pure functions here (questions, months, signed links, the email's words,
// the admin summary) so the pages stay thin and the rules are tested (checkin.test.ts).

export const CHECKIN_TIME_ZONE = "Pacific/Honolulu";
export const NOTE_MAX = 1000;
/** Emails one press of Send goes through, so a press finishes well inside a server function's time limit. */
export const SEND_BATCH = 50;

export type QuestionKey = "liked" | "easy" | "better";
export const QUESTIONS: { key: QuestionKey; text: string; low: string; high: string }[] = [
  { key: "liked", text: "How happy are you with the decks you've built?", low: "Not at all", high: "Very happy" },
  { key: "easy", text: "How easy is Deck Genome to use?", low: "Hard", high: "Very easy" },
  { key: "better", text: "Have your decks gotten better since you started using it?", low: "Not at all", high: "A lot" },
];

export type CheckinAnswer = { liked: number; easy: number; better: number; note: string | null };

/** This month as YYYY-MM, in David's time zone (the same one the stats page uses). */
export function monthKey(now = new Date(), timeZone = CHECKIN_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}`;
}

export const isMonth = (m: unknown): m is string => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/** "November 2026" for a YYYY-MM key. */
export function monthName(m: string): string {
  if (!isMonth(m)) return m;
  const [y, mo] = m.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, mo - 1, 15)));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The answers from the form, or why not. Strips control characters and squeezes the note. */
export function cleanAnswer(raw: Record<string, unknown>): { answer: CheckinAnswer | null; problem: string | null } {
  const score = (v: unknown) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  };
  const liked = score(raw.liked);
  const easy = score(raw.easy);
  const better = score(raw.better);
  if (liked === null || easy === null || better === null) return { answer: null, problem: "Pick an answer for each question." };
  const text = typeof raw.note === "string" ? raw.note.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/[ \t]+/g, " ").trim() : "";
  if (text.length > NOTE_MAX) return { answer: null, problem: `Keep the note under ${NOTE_MAX} characters.` };
  return { answer: { liked, easy, better, note: text || null }, problem: null };
}

// ---------- signed links ----------
// A link in the email has to work without signing in, so it carries the person's id and an HMAC of it. The key is
// the server's own secret (CHECKIN_SECRET, else the service-role key), so nobody can make a link for someone else.

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return b64url(sig.slice(0, 24));
}

function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type LinkPurpose = "answer" | "stop";

/** The month before a YYYY-MM key. */
export function previousMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}

/**
 * Answer links carry the month they were sent ("2026-11.<signature>") and work that month and the next, so an old
 * email can't answer for someone forever (security tidy-up, Nov 20, 2026). Stop links never expire: unsubscribing
 * must always work.
 */
export async function signLink(secret: string, purpose: LinkPurpose, userId: string, month = monthKey()): Promise<string> {
  const id = userId.toLowerCase();
  if (purpose === "stop") return hmac(secret, `checkin|stop|${id}`);
  return `${month}.${await hmac(secret, `checkin|answer|${month}|${id}`)}`;
}

export async function checkLink(secret: string | undefined, purpose: LinkPurpose, userId: unknown, token: unknown, now = new Date()): Promise<string | null> {
  if (!secret || typeof userId !== "string" || !UUID.test(userId) || typeof token !== "string" || !token) return null;
  if (purpose === "stop") return sameText(await signLink(secret, "stop", userId), token) ? userId.toLowerCase() : null;
  const month = token.slice(0, 7);
  const current = monthKey(now);
  if (!isMonth(month) || token[7] !== "." || (month !== current && month !== previousMonth(current))) return null;
  return sameText(await signLink(secret, "answer", userId, month), token) ? userId.toLowerCase() : null;
}

export function checkinSecret(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.CHECKIN_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || undefined;
}

export function siteOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+$/.test(raw) ? raw : "https://deckgenome.com";
}

export async function checkinLinks(origin: string, secret: string, userId: string) {
  const [answer, stop] = await Promise.all([signLink(secret, "answer", userId), signLink(secret, "stop", userId)]);
  const q = (t: string) => `u=${encodeURIComponent(userId)}&t=${encodeURIComponent(t)}`;
  return {
    answer: `${origin}/checkin?${q(answer)}`,
    stopPage: `${origin}/checkin/stop?${q(stop)}`,
    oneClick: `${origin}/api/checkin/stop?${q(stop)}`,
  };
}

// ---------- the email ----------

export type CheckinEmail = { subject: string; text: string; html: string; headers: Record<string, string> };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildCheckinEmail(opts: { name: string | null; month: string; links: Awaited<ReturnType<typeof checkinLinks>> }): CheckinEmail {
  const hi = opts.name ? `Hi ${opts.name.replace(/[\r\n]+/g, " ").trim().slice(0, 60)},` : "Hi,";
  const subject = `How's deckbuilding going? (${monthName(opts.month)})`;
  const lines = [
    hi,
    "",
    "It's David from Deck Genome. Once a month I ask three quick questions so I know what to fix and what to build next. It takes under a minute.",
    "",
    ...QUESTIONS.map((q, i) => `${i + 1}. ${q.text}`),
    "",
    `Answer here: ${opts.links.answer}`,
    "",
    "Thanks for building with Deck Genome.",
    "David",
    "",
    `Don't want these emails? Turn them off: ${opts.links.stopPage}`,
  ];
  const html = [
    `<p>${esc(hi)}</p>`,
    "<p>It's David from Deck Genome. Once a month I ask three quick questions so I know what to fix and what to build next. It takes under a minute.</p>",
    `<ol>${QUESTIONS.map((q) => `<li>${esc(q.text)}</li>`).join("")}</ol>`,
    `<p><a href="${esc(opts.links.answer)}" style="display:inline-block;padding:10px 16px;background:#b8860b;color:#ffffff;text-decoration:none;border-radius:6px">Answer the 3 questions</a></p>`,
    "<p>Thanks for building with Deck Genome.<br>David</p>",
    `<p style="font-size:12px;color:#666666">Don't want these emails? <a href="${esc(opts.links.stopPage)}">Turn them off</a>.</p>`,
  ].join("\n");
  return {
    subject,
    text: lines.join("\n"),
    html,
    headers: { "List-Unsubscribe": `<${opts.links.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

// ---------- who gets this month's email ----------

export type Recipient = { id: string; email: string; name: string | null };

/**
 * People to email this month: a confirmed email address, the switch still on, and no email yet this month.
 * Sorted by id so repeated presses go through everyone in the same order.
 */
export function pickRecipients(
  users: { id: string; email: string | null; email_confirmed_at?: string | null }[],
  profiles: Map<string, { checkin_emails: boolean; display_name: string | null }>,
  sentThisMonth: Set<string>,
): Recipient[] {
  return users
    .filter((u) => u.email && u.email_confirmed_at && !sentThisMonth.has(u.id) && profiles.get(u.id)?.checkin_emails === true)
    .map((u) => ({ id: u.id, email: u.email as string, name: profiles.get(u.id)?.display_name ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ---------- the admin summary ----------

export type MonthSummary = { month: string; sent: number; answers: number; liked: number; easy: number; better: number };

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);

/** Per month, newest first: emails sent, answers and the average score (1 to 5) for each question. */
export function summarize(sends: { month: string }[], answers: { month: string; liked: number; easy: number; better: number }[]): MonthSummary[] {
  const months = new Set([...sends.map((s) => s.month), ...answers.map((a) => a.month)]);
  return [...months]
    .sort((a, b) => b.localeCompare(a))
    .map((month) => {
      const mine = answers.filter((a) => a.month === month);
      return {
        month,
        sent: sends.filter((s) => s.month === month).length,
        answers: mine.length,
        liked: avg(mine.map((a) => a.liked)),
        easy: avg(mine.map((a) => a.easy)),
        better: avg(mine.map((a) => a.better)),
      };
    });
}
