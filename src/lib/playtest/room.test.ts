import { describe, expect, it } from "vitest";
import { newGame, type DeckCard } from "./game";
import { activeSeat, lostToCommander, nextSeat, readCode, roomCode, turnOrder, viewOf } from "./room";

const deck: DeckCard[] = [
  { oracleId: "cmd", name: "Omo", image: null, typeLine: "Legendary Creature", quantity: 1, commander: true },
  { oracleId: "f", name: "Forest", image: null, typeLine: "Basic Land — Forest", quantity: 60, commander: false },
  { oracleId: "b", name: "Bear", image: null, typeLine: "Creature — Bear", quantity: 39, commander: false },
];

describe("multiplayer room", () => {
  it("makes readable codes and reads typed ones", () => {
    let i = 0;
    const code = roomCode(() => (i++ % 10) / 10);
    expect(code).toHaveLength(5);
    expect(readCode(code.toLowerCase())).toBe(code);
    expect(readCode("ab c2d")).toBe("ABC2D");
    expect(readCode("O0I1L")).toBeNull();
    expect(readCode("ABCD")).toBeNull();
  });

  it("shares counts for hidden zones and the board in full", () => {
    const g = newGame(deck, 7);
    const v = viewOf(g, { id: "me", name: "David", deck: "Omo" }, { you: 5 });
    expect(v.hand).toBe(7);
    expect(v.library).toBe(92);
    expect(v.commanders).toEqual([{ name: "Omo", image: null, tax: 0, inZone: true }]);
    expect(v.battlefield).toEqual([]);
    expect(v.damage).toEqual({ you: 5 });
    expect(JSON.stringify(v)).not.toContain("Bear"); // nothing in hand or library leaks by name
  });

  it("agrees on turn order and passes the turn around", () => {
    const seats = [
      { id: "b", name: "B", joinedAt: 2 },
      { id: "a", name: "A", joinedAt: 1 },
      { id: "c", name: "C", joinedAt: 2 },
    ];
    expect(turnOrder(seats).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(nextSeat(seats, "a")).toBe("b");
    expect(nextSeat(seats, "c")).toBe("a");
    expect(activeSeat(seats, "gone")).toBe("a");
    expect(activeSeat(seats, "c")).toBe("c");
  });

  it("knows 21 commander damage from one commander loses", () => {
    expect(lostToCommander({ a: 20, b: 20 })).toBe(false);
    expect(lostToCommander({ a: 21 })).toBe(true);
  });
});
