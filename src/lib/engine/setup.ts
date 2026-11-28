// Starting a game: objects for every card, shuffled libraries, opening hands, the first turn.
// Mulligans (London, first one free) are PR 3; PR 1 deals seven and starts.

import { emptyPool } from "./mana";
import { pmapEmpty, pmapSet } from "./pmap";
import { nextInt, seedRng, shuffled } from "./rng";
import { freshStatus, drawCard } from "./state";
import { startTurn } from "./engine";
import { ENGINE_VERSION } from "./version";
import type { CardDef, GameEvent, GameObject, GameState, ObjectId, Seat, StepResult, TableRules } from "./types";

export type SeatSetup = { deck: CardDef[]; commanders?: CardDef[] };

export type GameSetup = {
  seed: number | string;
  seats: SeatSetup[];
  table?: Partial<TableRules>;
  scriptsManifest?: string;
  /** Who goes first. Left out, the seed picks (103.1). */
  firstSeat?: Seat;
  /** "asListed" skips the opening shuffle and puts deck[0] on top: for scripted tests and puzzles. */
  libraryOrder?: "shuffle" | "asListed";
};

const DEFAULT_TABLE: TableRules = { mode: "solo", startingLife: 40, startingHand: 7 };

export function createGame(setup: GameSetup): StepResult {
  if (setup.seats.length < 1) throw new Error("a game needs at least one seat");
  const table = { ...DEFAULT_TABLE, ...setup.table };
  const seatOrder = setup.seats.map((_, i) => i);
  let rng = seedRng(setup.seed);
  let objects = pmapEmpty<GameObject>();
  let nextId = 1;
  let nextCard = 1;
  const library: Record<Seat, ObjectId[]> = {};
  const command: ObjectId[] = [];
  const ev: GameEvent[] = [{ type: "gameStart", seats: seatOrder }];

  const make = (def: CardDef, owner: Seat, zone: GameObject["zone"], isCommander: boolean): ObjectId => {
    const id = nextId++;
    const o: GameObject = {
      id,
      cardId: nextCard++,
      def,
      owner,
      controller: owner,
      zone,
      status: freshStatus(),
      counters: {},
      damage: 0,
      deathtouchHit: false,
      summoningSick: false,
      attachedTo: null,
      timestamp: id,
      ...(isCommander ? { isCommander: true } : {}),
    };
    objects = pmapSet(objects, id, o);
    return id;
  };

  setup.seats.forEach((seatSetup, seat) => {
    for (const def of seatSetup.commanders ?? []) command.push(make(def, seat, "command", true));
    const ids = seatSetup.deck.map((def) => make(def, seat, "library", false));
    if (setup.libraryOrder === "asListed") library[seat] = ids.slice().reverse(); // top = last
    else {
      let order: ObjectId[];
      [order, rng] = shuffled(ids, rng);
      library[seat] = order;
      ev.push({ type: "shuffle", seat });
    }
  });

  let firstSeat = setup.firstSeat;
  if (firstSeat === undefined) [firstSeat, rng] = nextInt(rng, seatOrder.length);

  const empty = () => Object.fromEntries(seatOrder.map((s) => [s, [] as ObjectId[]]));
  let s: GameState = {
    engineVersion: ENGINE_VERSION,
    scriptsManifest: setup.scriptsManifest ?? "none",
    rng,
    nextObjectId: nextId,
    nextCardId: nextCard,
    nextTimestamp: nextId,
    nextDecisionId: 1,
    seatOrder,
    turn: { number: 0, activeSeat: firstSeat, step: "untap", attackersDeclared: false },
    priority: { seat: null, passedInRow: [] },
    seats: Object.fromEntries(
      seatOrder.map((seat) => [
        seat,
        {
          seat,
          life: table.startingLife,
          poison: 0,
          pool: emptyPool(),
          commanderDamage: {},
          drewFromEmpty: false,
          lost: false,
          lossReason: null,
          maxHandSize: 7,
        },
      ]),
    ),
    objects,
    zones: { library, hand: empty(), graveyard: empty(), battlefield: [], stack: [], exile: [], command },
    lki: pmapEmpty(),
    effects: [],
    replacements: [],
    delayedTriggers: [],
    pendingTriggers: [],
    turnMemory: { landsPlayed: {}, spellsCast: {}, loyaltyUsed: [], activated: [] },
    gameMemory: { commanderCasts: {}, firstSeat, turnsTaken: {}, extraTurns: [] },
    casting: null,
    resolving: null,
    pendingDecision: null,
    loopGuard: { seen: [] },
    table,
    winner: null,
    over: false,
  };

  // Opening hands, in turn order from the first player.
  for (let i = 0; i < seatOrder.length; i++) {
    const seat = seatOrder[(firstSeat + i) % seatOrder.length];
    for (let n = 0; n < table.startingHand; n++) s = drawCard(s, ev, seat);
  }
  // Opening hands are dealt, not "drawn" for the rules (no 704.5b loss for a short deck at the start).
  for (const seat of seatOrder) if (s.seats[seat].drewFromEmpty) s = { ...s, seats: { ...s.seats, [seat]: { ...s.seats[seat], drewFromEmpty: false } } };

  s = startTurn(s, ev, firstSeat);
  return { state: s, events: ev, decision: s.pendingDecision };
}
