// Sign-up and deck numbers for the admin stats page (src/app/admin/stats/page.tsx). Plain data in, plain data out,
// so it's tested without a database. Days are counted in Hawaii time, where David reads the page.
import { TEST_USER_EMAIL } from "@/lib/dev-login";

export const STATS_TIME_ZONE = "Pacific/Honolulu";

// Accounts the site itself made: the Precons account (scripts/create-precon-account.mjs) and the local test sign-in.
// Their users and decks aren't people using the site, so they're left out of every number.
export const SYSTEM_EMAILS = new Set(["precons@commander-tags.test", TEST_USER_EMAIL]);

export type StatUser = { id: string; email?: string | null; created_at: string; last_sign_in_at?: string | null };
export type StatDeck = { owner_id: string; created_at: string; updated_at: string };

export type DayRow = { day: string; signUps: number; decks: number };
export type RecentUser = { id: string; joined: string; lastSignIn: string | null; decks: number };
export type SiteStats = {
  totals: {
    users: number;
    usersWithDecks: number;
    active7: number;
    active30: number;
    newUsers7: number;
    decks: number;
    newDecks7: number;
    editedDecks7: number;
  };
  daily: DayRow[];
  recent: RecentUser[];
};

const DAY_MS = 86_400_000;

export function dayKey(iso: string | Date, timeZone = STATS_TIME_ZONE): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

// The last n calendar days ending today, newest first.
export function lastDays(now: Date, n: number, timeZone = STATS_TIME_ZONE): string[] {
  const out: string[] = [];
  // Step back a day at noon of each day so daylight saving shifts elsewhere can't skip or repeat a day.
  for (let i = 0; out.length < n && i < n + 2; i++) {
    const key = dayKey(new Date(now.getTime() - i * DAY_MS), timeZone);
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

const within = (iso: string | null | undefined, now: Date, days: number) =>
  !!iso && now.getTime() - new Date(iso).getTime() <= days * DAY_MS && new Date(iso).getTime() <= now.getTime() + 60_000;

export function buildStats(
  allUsers: StatUser[],
  allDecks: StatDeck[],
  now: Date,
  { days = 30, recent = 15, timeZone = STATS_TIME_ZONE }: { days?: number; recent?: number; timeZone?: string } = {},
): SiteStats {
  const system = new Set(allUsers.filter((u) => u.email && SYSTEM_EMAILS.has(u.email.toLowerCase())).map((u) => u.id));
  const users = allUsers.filter((u) => !system.has(u.id));
  const decks = allDecks.filter((d) => !system.has(d.owner_id));

  const deckCount = new Map<string, number>();
  for (const d of decks) deckCount.set(d.owner_id, (deckCount.get(d.owner_id) ?? 0) + 1);

  const daily = lastDays(now, days, timeZone).map((day) => ({ day, signUps: 0, decks: 0 }));
  const byDay = new Map(daily.map((r) => [r.day, r]));
  for (const u of users) {
    const row = byDay.get(dayKey(u.created_at, timeZone));
    if (row) row.signUps++;
  }
  for (const d of decks) {
    const row = byDay.get(dayKey(d.created_at, timeZone));
    if (row) row.decks++;
  }

  return {
    totals: {
      users: users.length,
      usersWithDecks: users.filter((u) => deckCount.has(u.id)).length,
      active7: users.filter((u) => within(u.last_sign_in_at, now, 7)).length,
      active30: users.filter((u) => within(u.last_sign_in_at, now, 30)).length,
      newUsers7: users.filter((u) => within(u.created_at, now, 7)).length,
      decks: decks.length,
      newDecks7: decks.filter((d) => within(d.created_at, now, 7)).length,
      editedDecks7: decks.filter((d) => within(d.updated_at, now, 7)).length,
    },
    daily,
    recent: [...users]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, recent)
      .map((u) => ({ id: u.id, joined: u.created_at, lastSignIn: u.last_sign_in_at ?? null, decks: deckCount.get(u.id) ?? 0 })),
  };
}
