import { describe, expect, it } from "vitest";
import { cleanSeats, deckStandings, inviteLink, playerStandings, playgroupError, readMyPlaygroups, readPlaygroup, type PlaygroupGame, type SeatDraft } from "./playgroups";

const seat = (s: Partial<SeatDraft>): SeatDraft => ({ user_id: "", guest: false, guest_name: "", deck_id: "", deck_name: "", won: false, ...s });

const games: PlaygroupGame[] = [
  {
    id: "g1",
    played_on: "2026-11-14",
    note: null,
    mine: true,
    players: [
      { user_id: "a", guest_name: null, name: "Dee", deck_id: "d1", deck_name: "Omo", won: true },
      { user_id: null, guest_name: "Sam", name: "Sam", deck_id: null, deck_name: "Atraxa", won: false },
    ],
  },
  {
    id: "g2",
    played_on: "2026-11-15",
    note: null,
    mine: false,
    players: [
      { user_id: "a", guest_name: null, name: "Dee", deck_id: "d1", deck_name: "Omo", won: false },
      { user_id: null, guest_name: "sam ", name: "sam ", deck_id: null, deck_name: "atraxa", won: true },
      { user_id: "b", guest_name: null, name: "Bea", deck_id: null, deck_name: null, won: false },
    ],
  },
];

describe("standings", () => {
  it("counts players, treating a guest name the same whatever its case", () => {
    const p = playerStandings(games);
    expect(p.map((r) => [r.name, r.games, r.wins])).toEqual([
      ["Dee", 2, 1],
      ["Sam", 2, 1],
      ["Bea", 1, 0],
    ]);
    expect(p[0].winRate).toBe(0.5);
  });
  it("counts decks by id, or by typed name and player", () => {
    const d = deckStandings(games);
    expect(d.map((r) => [r.name, r.player, r.games, r.wins])).toEqual([
      ["Atraxa", "Sam", 2, 1],
      ["Omo", "Dee", 2, 1],
    ]);
  });
});

describe("cleanSeats", () => {
  it("drops empty seats and checks players and a winner", () => {
    expect(cleanSeats([seat({ user_id: "a", won: true }), seat({})]).problem).toMatch(/at least 2/);
    expect(cleanSeats([seat({ user_id: "a" }), seat({ guest: true, guest_name: "  Sam  " })]).problem).toBe("Tick who won.");
    expect(cleanSeats([seat({ user_id: "a", won: true }), seat({ user_id: "a" })]).problem).toBe("Someone is in two seats.");
    const ok = cleanSeats([seat({ user_id: "a", won: true, deck_name: " Omo " }), seat({ guest: true, guest_name: "  Sam  " }), seat({ guest_name: "ignored" })]);
    expect(ok.problem).toBeNull();
    expect(ok.seats.map((s) => [s.user_id, s.guest_name, s.deck_name])).toEqual([
      ["a", "", "Omo"],
      ["", "Sam", ""],
    ]);
  });
});

describe("reading", () => {
  it("reads lists and one playgroup defensively", () => {
    expect(readMyPlaygroups([{ id: "x", name: "Fri", members: "3", games: 2, is_owner: true }, { name: "no id" }])).toEqual([
      { id: "x", name: "Fri", is_owner: true, members: 3, games: 2, last_played: null },
    ]);
    expect(readPlaygroup(null)).toBeNull();
    const g = readPlaygroup({ id: "x", name: "Fri", invite_code: "abc", members: [{ user_id: "a", name: " ", me: true }], games: [{ id: "g", players: [{ guest_name: "Sam", won: true }] }] });
    expect(g?.members[0]).toEqual({ user_id: "a", name: null, avatar_url: null, me: true, owner: false });
    expect(g?.games[0].players[0]).toMatchObject({ guest_name: "Sam", won: true, user_id: null });
  });
  it("builds the invite link and filters errors", () => {
    expect(inviteLink("https://deckgenome.com/", "ab12")).toBe("https://deckgenome.com/playgroups/join/ab12");
    expect(playgroupError("That playgroup is full (30 players).", "x")).toMatch(/full/);
    expect(playgroupError("relation does not exist", "fallback")).toBe("fallback");
  });
});
