// Playgroups (V3, migration 0062): friends who play together log games and see standings per player and per deck.
// All reads and writes go through the playgroup functions in the database; this file shapes what they return.

export type PlaygroupSummary = { id: string; name: string; is_owner: boolean; members: number; games: number; last_played: string | null };
export type PlaygroupMember = { user_id: string; name: string | null; avatar_url: string | null; me: boolean; owner: boolean };
export type GameSeat = { user_id: string | null; guest_name: string | null; name: string | null; deck_id: string | null; deck_name: string | null; won: boolean };
export type PlaygroupGame = { id: string; played_on: string; note: string | null; mine: boolean; players: GameSeat[] };
export type Playgroup = { id: string; name: string; is_owner: boolean; invite_code: string; members: PlaygroupMember[]; games: PlaygroupGame[] };

export const PLAYGROUP_NAME_MAX = 60;
export const GUEST_NAME_MAX = 40;
export const SEATS_MIN = 2;
export const SEATS_MAX = 8;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);

export function readMyPlaygroups(raw: unknown): PlaygroupSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): PlaygroupSummary[] => {
    const x = obj(r);
    if (!x || typeof x.id !== "string" || typeof x.name !== "string") return [];
    return [{ id: x.id, name: x.name, is_owner: x.is_owner === true, members: Number(x.members) || 0, games: Number(x.games) || 0, last_played: str(x.last_played) }];
  });
}

export function readPlaygroup(raw: unknown): Playgroup | null {
  const x = obj(raw);
  if (!x || typeof x.id !== "string" || typeof x.name !== "string") return null;
  const members = (Array.isArray(x.members) ? x.members : []).flatMap((m): PlaygroupMember[] => {
    const y = obj(m);
    if (!y || typeof y.user_id !== "string") return [];
    return [{ user_id: y.user_id, name: str(y.name), avatar_url: str(y.avatar_url), me: y.me === true, owner: y.owner === true }];
  });
  const games = (Array.isArray(x.games) ? x.games : []).flatMap((g): PlaygroupGame[] => {
    const y = obj(g);
    if (!y || typeof y.id !== "string") return [];
    const players = (Array.isArray(y.players) ? y.players : []).flatMap((p): GameSeat[] => {
      const z = obj(p);
      if (!z) return [];
      return [{ user_id: str(z.user_id), guest_name: str(z.guest_name), name: str(z.name), deck_id: str(z.deck_id), deck_name: str(z.deck_name), won: z.won === true }];
    });
    return [{ id: y.id, played_on: str(y.played_on) ?? "", note: str(y.note), mine: y.mine === true, players }];
  });
  return { id: x.id, name: x.name, is_owner: x.is_owner === true, invite_code: typeof x.invite_code === "string" ? x.invite_code : "", members, games };
}

/** One person across games: a member by account, a guest by name (ignoring case). */
export function seatKey(s: Pick<GameSeat, "user_id" | "guest_name">) {
  return s.user_id ? `u:${s.user_id}` : `g:${(s.guest_name ?? "").trim().toLowerCase()}`;
}

export type Standing = { key: string; name: string; games: number; wins: number; winRate: number };

const rank = (a: Standing, b: Standing) => b.wins - a.wins || b.winRate - a.winRate || b.games - a.games || a.name.localeCompare(b.name);

/** Games played and won per player, most wins first. A guest counts once however their name is capitalised. */
export function playerStandings(games: PlaygroupGame[], nameOf: (s: GameSeat) => string = (s) => s.name ?? s.guest_name ?? "Someone"): Standing[] {
  const m = new Map<string, Standing>();
  for (const g of games)
    for (const s of g.players) {
      const key = seatKey(s);
      const row = m.get(key) ?? { key, name: nameOf(s), games: 0, wins: 0, winRate: 0 };
      row.games++;
      if (s.won) row.wins++;
      m.set(key, row);
    }
  return [...m.values()].map((r) => ({ ...r, winRate: r.games ? r.wins / r.games : 0 })).sort(rank);
}

/** Games played and won per deck (a deck from Deck Genome by id, else by its typed name and its player). */
export function deckStandings(games: PlaygroupGame[]): (Standing & { player: string; deck_id: string | null })[] {
  const m = new Map<string, Standing & { player: string; deck_id: string | null }>();
  for (const g of games)
    for (const s of g.players) {
      if (!s.deck_id && !s.deck_name) continue;
      const key = s.deck_id ? `d:${s.deck_id}` : `${seatKey(s)}|${(s.deck_name ?? "").trim().toLowerCase()}`;
      const row = m.get(key) ?? { key, name: s.deck_name ?? "A deck", player: s.name ?? s.guest_name ?? "Someone", deck_id: s.deck_id, games: 0, wins: 0, winRate: 0 };
      row.games++;
      if (s.won) row.wins++;
      m.set(key, row);
    }
  return [...m.values()].map((r) => ({ ...r, winRate: r.games ? r.wins / r.games : 0 })).sort(rank);
}

/** A seat in the Log a game form: a member (user_id), someone else typed by name (guest), or empty. */
export type SeatDraft = { user_id: string; guest: boolean; guest_name: string; deck_id: string; deck_name: string; won: boolean };

/**
 * The seats ready to send, or why not. Empty seats are dropped; each member sits at most once; a seat needs a member
 * or a guest name; at least one winner (a draw can have several).
 */
export function cleanSeats(seats: SeatDraft[]): { seats: SeatDraft[]; problem: string | null } {
  const filled = seats
    .map((s) => ({ ...s, guest_name: s.user_id || !s.guest ? "" : s.guest_name.replace(/\s+/g, " ").trim().slice(0, GUEST_NAME_MAX), deck_name: s.deck_name.replace(/\s+/g, " ").trim().slice(0, 120) }))
    .filter((s) => s.user_id || s.guest_name);
  if (filled.length < SEATS_MIN) return { seats: filled, problem: `Add at least ${SEATS_MIN} players.` };
  if (filled.length > SEATS_MAX) return { seats: filled, problem: `A game has at most ${SEATS_MAX} players.` };
  const ids = filled.filter((s) => s.user_id).map((s) => s.user_id);
  if (new Set(ids).size !== ids.length) return { seats: filled, problem: "Someone is in two seats." };
  if (!filled.some((s) => s.won)) return { seats: filled, problem: "Tick who won." };
  return { seats: filled, problem: null };
}

/** The address someone opens to join. */
export function inviteLink(origin: string, code: string) {
  return `${origin.replace(/\/$/, "")}/playgroups/join/${encodeURIComponent(code)}`;
}

/** Our own raised sentences are fine to show; anything technical gets a general line. */
export function playgroupError(message: string | undefined, fallback: string) {
  if (!message) return fallback;
  return /^(Sign in|Give the|Playgroup names|You can make|That invite|That playgroup|Only the person|You made this|A game has|The note|That is a lot|You are not in|Every player|Pick a player|A player can only)/.test(message)
    ? message
    : fallback;
}

export const percent = (r: number) => `${Math.round(r * 100)}%`;

/** Today in the browser's own time zone, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const off = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - off).toISOString().slice(0, 10);
}
