// Helpers for the engine's tests (not used by the engine itself).

import { expect } from "vitest";
import { step } from "./engine";
import { checkInvariants } from "./invariants";
import { createGame, type GameSetup } from "./setup";
import { deepFreeze } from "./freeze";
import { pmapGet } from "./pmap";
import type { Action, CardDef, GameState, ObjectId, Seat } from "./types";

/** A game with stacked libraries (deck[0] on top) and seat 0 first. */
export function stacked(decks: CardDef[][], extra: Partial<GameSetup> = {}): GameState {
  return deepFreeze(createGame({ seed: 1, seats: decks.map((deck) => ({ deck })), firstSeat: 0, libraryOrder: "asListed", ...extra }).state);
}

/** Sends an action that must be accepted; checks invariants and freezes the result. */
export function act(s: GameState, action: Action, seat?: Seat): GameState {
  const who = seat ?? s.pendingDecision!.seat;
  const r = step(s, who, action);
  if (r.error) throw new Error(`refused: ${r.error} (${JSON.stringify(action)})`);
  expect(checkInvariants(r.state)).toEqual([]);
  return deepFreeze(r.state);
}

/** Passes priority; a cleanup discard is answered with the first cards offered. */
export function pass(s: GameState): GameState {
  const d = s.pendingDecision;
  if (d?.kind === "chooseObjects") return act(s, { kind: "answer", decision: d.id, choice: { objects: d.candidates!.slice(0, d.min) } });
  return act(s, { kind: "pass" });
}

/** Everyone passes until the predicate holds (at most `limit` passes). */
export function passUntil(s0: GameState, done: (s: GameState) => boolean, limit = 500): GameState {
  let s = s0;
  for (let i = 0; i < limit && !done(s); i++) {
    if (s.pendingDecision?.kind !== "priority" && s.pendingDecision?.kind !== "chooseObjects") throw new Error(`expected a priority decision, got ${s.pendingDecision?.kind}`);
    s = pass(s);
  }
  if (!done(s)) throw new Error("passUntil gave up");
  return s;
}

export const atStep = (seat: Seat, stepName: GameState["turn"]["step"]) => (s: GameState) =>
  s.turn.activeSeat === seat && s.turn.step === stepName && s.pendingDecision?.seat === seat;

export function handCard(s: GameState, seat: Seat, name: string): ObjectId {
  const id = s.zones.hand[seat].find((x) => objName(s, x) === name);
  if (id === undefined) throw new Error(`no ${name} in seat ${seat}'s hand`);
  return id;
}

export function byId(s: GameState, id: ObjectId) {
  const o = pmapGet(s.objects, id);
  if (!o) throw new Error(`no object ${id}`);
  return o;
}

export const objName = (s: GameState, id: ObjectId) => byId(s, id).def.faces[0].name;
export const names = (s: GameState, ids: ObjectId[]) => ids.map((id) => objName(s, id));
