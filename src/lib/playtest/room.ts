// Multiplayer playtesting (v2): a shared table where each player runs their own deck. Players meet in a room by
// code over Supabase Realtime (nothing is stored); each one broadcasts what the others can see of their game.
// Pure helpers here; the channel lives in use-room.ts.
import { faceImage, faceName, inLandRow, type GameState } from "./game";

/** What the other players see of a game: no hidden information (hand and library are counts only). */
export type PlayerView = {
  id: string;
  name: string;
  deck: string;
  life: number;
  turn: number;
  hand: number;
  library: number;
  graveyard: { name: string; image: string | null }[];
  exile: number;
  commanders: { name: string; image: string | null; tax: number; inZone: boolean }[];
  battlefield: { iid: string; name: string; image: string | null; tapped: boolean; land: boolean; token: boolean; counters: Record<string, number> }[];
  /** Commander damage this player has taken, by opponent id (each tracks their own). */
  damage: Record<string, number>;
};

export const MAX_PLAYERS = 4;
/** Letters and digits that can't be mistaken for each other when read aloud or typed (no O/0, I/1, L). */
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 5;

export function roomCode(random: () => number = Math.random): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[Math.floor(random() * CODE_CHARS.length)]).join("");
}

/** Normalizes a typed code ("abc 12" -> "ABC12"); null when it can't be one. */
export function readCode(text: string): string | null {
  const code = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_CHARS.includes(c)) ? code : null;
}

export function viewOf(game: GameState, me: { id: string; name: string; deck: string }, damage: Record<string, number>): PlayerView {
  const card = (iid: string) => game.cards[iid];
  const commanders = Object.values(game.cards).filter((c) => c.commander);
  return {
    ...me,
    life: game.life,
    turn: game.turn,
    hand: game.zones.hand.length,
    library: game.zones.library.length,
    graveyard: game.zones.graveyard.map((iid) => ({ name: card(iid).name, image: card(iid).image })),
    exile: game.zones.exile.length,
    commanders: commanders.map((c) => ({ name: c.name, image: c.image, tax: 2 * (game.casts[c.iid] ?? 0), inZone: game.zones.command.includes(c.iid) })),
    battlefield: game.zones.battlefield.map((iid) => {
      const c = card(iid);
      const placed = game.battlefield[iid];
      // Others never see what a face-down card is.
      if (c.faceDown) return { iid, name: "Face-down card", image: null, tapped: !!placed?.tapped, land: false, token: !!c.token, counters: placed?.counters ?? {} };
      return { iid, name: faceName(c), image: faceImage(c), tapped: !!placed?.tapped, land: inLandRow(c), token: !!c.token, counters: placed?.counters ?? {} };
    }),
    damage,
  };
}

export type Seat = { id: string; name: string; joinedAt: number };

/** Turn order: the order players joined the room (ties by id, so every client agrees). */
export function turnOrder(seats: Seat[]): Seat[] {
  return [...seats].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
}

/** Whose turn comes after `current`; the first seat when nobody has it yet or they left. */
export function nextSeat(seats: Seat[], current: string | null): string | null {
  const order = turnOrder(seats);
  if (order.length === 0) return null;
  const at = order.findIndex((s) => s.id === current);
  return order[(at + 1) % order.length].id;
}

/** The active player as every client sees it: the announced one if still seated, otherwise the first seat. */
export function activeSeat(seats: Seat[], announced: string | null): string | null {
  if (announced && seats.some((s) => s.id === announced)) return announced;
  return turnOrder(seats)[0]?.id ?? null;
}

/** 21 commander damage from one commander loses the game (rule 903.10a). */
export const COMMANDER_DAMAGE_LIMIT = 21;
export const lostToCommander = (damage: Record<string, number>) => Object.values(damage).some((n) => n >= COMMANDER_DAMAGE_LIMIT);
