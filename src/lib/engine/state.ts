// Small copy-on-write helpers. Each returns a new state that shares every unchanged part with the old one.
// Events are pushed onto the `ev` list the caller passes in (the list is the caller's, the state is not).

import { chars } from "./chars";
import { emptyPool } from "./mana";
import { pmapDelete, pmapGet, pmapSet } from "./pmap";
import type { GameEvent, GameObject, GameState, ObjectId, PlayerState, Seat, ZoneName } from "./types";

export function obj(s: GameState, id: ObjectId): GameObject {
  const o = pmapGet(s.objects, id);
  if (!o) throw new Error(`no object ${id}`);
  return o;
}

export function maybeObj(s: GameState, id: ObjectId): GameObject | undefined {
  return pmapGet(s.objects, id);
}

export function setObj(s: GameState, o: GameObject): GameState {
  return { ...s, objects: pmapSet(s.objects, o.id, o) };
}

export function setSeat(s: GameState, seat: Seat, patch: Partial<PlayerState>): GameState {
  return { ...s, seats: { ...s.seats, [seat]: { ...s.seats[seat], ...patch } } };
}

export function living(s: GameState): Seat[] {
  return s.seatOrder.filter((seat) => !s.seats[seat].lost);
}

/** The next living seat after `seat` in turn order. */
export function nextLiving(s: GameState, seat: Seat): Seat {
  const order = s.seatOrder;
  const start = order.indexOf(seat);
  for (let i = 1; i <= order.length; i++) {
    const next = order[(start + i) % order.length];
    if (!s.seats[next].lost) return next;
  }
  return seat;
}

/** The list that holds a zone's objects for a given seat (seat is ignored for shared zones). */
export function zoneList(s: GameState, zone: ZoneName, seat: Seat): ObjectId[] {
  const z = s.zones;
  switch (zone) {
    case "library":
    case "hand":
    case "graveyard":
      return z[zone][seat];
    default:
      return z[zone];
  }
}

function withZoneList(s: GameState, zone: ZoneName, seat: Seat, list: ObjectId[]): GameState {
  switch (zone) {
    case "library":
    case "hand":
    case "graveyard":
      return { ...s, zones: { ...s.zones, [zone]: { ...s.zones[zone], [seat]: list } } };
    default:
      return { ...s, zones: { ...s.zones, [zone]: list } };
  }
}

/** Which seat's copy of a zone an object lives in (owner's library, hand, graveyard; 400.3). */
function zoneSeat(o: GameObject): Seat {
  return o.owner;
}

export function freshStatus(upFace = 0): GameObject["status"] {
  return { tapped: false, flipped: false, faceDown: null, phasedOut: false, upFace, transformed: false };
}

export type MoveOptions = {
  controller?: Seat;
  bottom?: boolean; // library bottom instead of top
  upFace?: number;
  castInfo?: GameObject["castInfo"];
  tapped?: boolean; // enters the battlefield tapped
  faceDown?: boolean;
  onAdventure?: boolean; // 715.4: exiled by its own Adventure
  /** Keep these fields from the old object (a spell's targets travel with it onto the stack and off it). */
  keep?: Partial<Pick<GameObject, "targets" | "divide">>;
};

/**
 * Moves an object to another zone. Rule 400.7: it becomes a new object with a new id; the card behind it
 * keeps its cardId. Leaving the battlefield or stack stores its last known characteristics (LKI).
 */
export function moveObject(s0: GameState, ev: GameEvent[], id: ObjectId, to: ZoneName, opts: MoveOptions = {}): [GameState, ObjectId] {
  let s = s0;
  const o = obj(s, id);
  // Last known information (113.7a, 608.2h): kept for every object that changes zones, until the turn ends.
  s = { ...s, lki: pmapSet(s.lki, id, chars(s, id)) };
  const fromSeat = zoneSeat(o);
  s = withZoneList(s, o.zone, fromSeat, zoneList(s, o.zone, fromSeat).filter((x) => x !== id));
  s = { ...s, objects: pmapDelete(s.objects, id) };

  const newId = s.nextObjectId;
  const upFace = opts.upFace ?? 0;
  const moved: GameObject = {
    id: newId,
    cardId: o.cardId,
    def: o.def,
    owner: o.owner,
    controller: to === "battlefield" || to === "stack" ? opts.controller ?? o.controller : o.owner,
    zone: to,
    status: { ...freshStatus(upFace), tapped: to === "battlefield" && !!opts.tapped, faceDown: opts.faceDown ? "other" : null },
    counters: {},
    damage: 0,
    deathtouchHit: false,
    summoningSick: to === "battlefield",
    attachedTo: null,
    timestamp: s.nextTimestamp,
    ...(opts.castInfo ? { castInfo: opts.castInfo } : to === "battlefield" && o.castInfo ? { castInfo: o.castInfo } : {}),
    ...(o.isCommander ? { isCommander: true } : {}),
    ...(o.isToken ? { isToken: true } : {}),
    ...(opts.onAdventure ? { onAdventure: true } : {}),
    ...(opts.keep ?? {}),
  };
  s = { ...s, nextObjectId: newId + 1, nextTimestamp: s.nextTimestamp + 1, objects: pmapSet(s.objects, newId, moved) };

  // 306.5b: a planeswalker enters with its printed loyalty in loyalty counters.
  if (to === "battlefield") {
    const loyalty = chars(s, newId).loyalty;
    if (loyalty !== null && chars(s, newId).types.includes("Planeswalker")) s = setObj(s, { ...moved, counters: { loyalty } });
  }

  const toSeat = zoneSeat(moved);
  const list = zoneList(s, to, toSeat);
  s = withZoneList(s, to, toSeat, opts.bottom ? [newId, ...list] : [...list, newId]);
  ev.push({ type: "zoneChange", card: o.cardId, oldId: id, newId, from: o.zone, to, owner: o.owner });
  return [s, newId];
}

export function drawCard(s0: GameState, ev: GameEvent[], seat: Seat): GameState {
  const lib = s0.zones.library[seat];
  if (lib.length === 0) return setSeat(s0, seat, { drewFromEmpty: true }); // 704.5b at the next check
  const top = lib[lib.length - 1];
  const card = obj(s0, top).cardId;
  const [s, newId] = moveObject(s0, ev, top, "hand");
  ev.push({ type: "draw", seat, card, object: newId });
  return s;
}

export function setTapped(s: GameState, ev: GameEvent[], id: ObjectId, tapped: boolean): GameState {
  const o = obj(s, id);
  if (o.status.tapped === tapped) return s;
  ev.push({ type: tapped ? "tap" : "untap", object: id });
  return setObj(s, { ...o, status: { ...o.status, tapped } });
}

export function emptyPools(s0: GameState, ev: GameEvent[]): GameState {
  let s = s0;
  for (const seat of s.seatOrder) {
    const pool = s.seats[seat].pool;
    if (Object.values(pool).some((n) => n > 0)) {
      s = setSeat(s, seat, { pool: emptyPool() });
      ev.push({ type: "manaEmptied", seat });
    }
  }
  return s;
}

/** Creates a new object directly on the battlefield (tokens, 111.1). */
export function createObject(s0: GameState, ev: GameEvent[], def: GameObject["def"], owner: Seat, opts: { tapped?: boolean; token?: boolean } = {}): [GameState, ObjectId] {
  const id = s0.nextObjectId;
  const o: GameObject = {
    id,
    cardId: s0.nextCardId,
    def,
    owner,
    controller: owner,
    zone: "battlefield",
    status: { ...freshStatus(), tapped: !!opts.tapped },
    counters: {},
    damage: 0,
    deathtouchHit: false,
    summoningSick: true,
    attachedTo: null,
    timestamp: s0.nextTimestamp,
    ...(opts.token ? { isToken: true } : {}),
  };
  const s: GameState = {
    ...s0,
    nextObjectId: id + 1,
    nextCardId: s0.nextCardId + 1,
    nextTimestamp: s0.nextTimestamp + 1,
    objects: pmapSet(s0.objects, id, o),
    zones: { ...s0.zones, battlefield: [...s0.zones.battlefield, id] },
  };
  if (opts.token) ev.push({ type: "tokenCreated", object: id, name: def.faces[0].name });
  return [s, id];
}

/** Removes an object from the game entirely (a token off the battlefield, an ability leaving the stack). */
export function ceaseToExist(s: GameState, ev: GameEvent[], id: ObjectId): GameState {
  const o = obj(s, id);
  const seat = zoneSeat(o);
  const s1 = withZoneList(s, o.zone, seat, zoneList(s, o.zone, seat).filter((x) => x !== id));
  ev.push({ type: "ceased", object: id });
  return { ...s1, objects: pmapDelete(s1.objects, id) };
}

export function nextDecisionId(s: GameState): [GameState, number] {
  return [{ ...s, nextDecisionId: s.nextDecisionId + 1 }, s.nextDecisionId];
}
