// The engine: `step(state, seat, action) -> { state, events, decision }` (engine-design.md).
// A pure function. It never waits for anyone: it returns the next Decision and stops.
//
// PR 1 covers: turn steps, priority, playing lands, mana from basic land types (305.6), casting spells with
// no abilities and rolling a cast back when it can't be paid (601.2, 733), the stack, resolving, basic
// state-based actions, conceding and basic player elimination. Combat, Commander rules and mulligans are
// PR 3; card abilities arrive with the card language (PR 2).

import { chars } from "./chars";
import { castableFaces, isPermanentFace, playableLandFaces, printedFace } from "./cards";
import { intrinsicMana, parseCost, payFromPool, planAutoPay, poolTotal, type ManaSource } from "./mana";
import { pmapDelete, pmapEmpty } from "./pmap";
import { RULES } from "./rules-refs";
import { specialRefusal } from "./special";
import {
  drawCard,
  emptyPools,
  living,
  maybeObj,
  moveObject,
  nextDecisionId,
  nextLiving,
  obj,
  setObj,
  setSeat,
  setTapped,
} from "./state";
import type {
  Action,
  Choice,
  Decision,
  GameEvent,
  GameState,
  ManaType,
  ObjectId,
  Seat,
  Step,
  StepResult,
} from "./types";

export const STEP_ORDER: Step[] = [
  "untap",
  "upkeep",
  "draw",
  "main1",
  "beginCombat",
  "declareAttackers",
  "declareBlockers",
  "combatDamage",
  "endCombat",
  "main2",
  "end",
  "cleanup",
];

export function phaseOf(step: Step) {
  if (step === "untap" || step === "upkeep" || step === "draw") return "beginning" as const;
  if (step === "main1") return "precombatMain" as const;
  if (step === "main2") return "postcombatMain" as const;
  if (step === "end" || step === "cleanup") return "ending" as const;
  return "combat" as const;
}

const isMain = (step: Step) => step === "main1" || step === "main2";

// ---------------------------------------------------------------- public entry point

export function step(state: GameState, seat: Seat, action: Action): StepResult {
  const refuse = (error: string): StepResult => ({ state, events: [], decision: state.pendingDecision, error });
  if (state.over) return refuse("the game is over");
  if (!state.seats[seat]) return refuse(`no seat ${seat}`);
  if (state.seats[seat].lost) return refuse(`seat ${seat} has left the game`);
  const ev: GameEvent[] = [];
  const done = (s: GameState): StepResult => ({ state: s, events: ev, decision: s.pendingDecision });

  if (action.kind === "concede") return done(afterLoss(eliminate(state, ev, seat, "conceded"), ev));
  if (action.kind === "manual" || action.kind === "rewind") return refuse(`not yet: ${action.kind} actions arrive in PR 5`);

  const d = state.pendingDecision;
  if (!d) return refuse("nothing to decide");
  if (d.seat !== seat) return refuse(`waiting for seat ${d.seat}`);

  switch (d.kind) {
    case "priority":
      return priorityAction(state, ev, seat, action, refuse, done);
    case "payCost":
      if (action.kind === "activateMana") {
        const r = manaAbility(state, ev, seat, action.object, action.ability);
        if (typeof r === "string") return refuse(r);
        return done(askPayment(r));
      }
      if (action.kind !== "answer" || action.decision !== d.id) return refuse("answer the payment first (pay, or cancel the spell)");
      return done(payOrRollback(state, ev, action.choice));
    case "chooseObjects":
      if (action.kind !== "answer" || action.decision !== d.id) return refuse("answer the pending choice first");
      return answerDiscard(state, ev, d, action.choice, refuse, done);
    default:
      return refuse(`not yet: ${d.kind} decisions`);
  }
}

// ---------------------------------------------------------------- priority

function priorityAction(
  s: GameState,
  ev: GameEvent[],
  seat: Seat,
  action: Action,
  refuse: (e: string) => StepResult,
  done: (s: GameState) => StepResult,
): StepResult {
  switch (action.kind) {
    case "pass":
      return done(pass(s, ev, seat));
    case "playLand": {
      const why = landRefusal(s, seat, action.object, action.face);
      if (why) return refuse(why);
      return done(playLand(s, ev, seat, action.object, resolveFace(s, action.object, action.face, "land")));
    }
    case "cast": {
      const why = castRefusal(s, seat, action.object, action.face);
      if (why) return refuse(why);
      return done(beginCast(s, ev, seat, action.object, resolveFace(s, action.object, action.face, "cast")));
    }
    case "activateMana": {
      const r = manaAbility(s, ev, seat, action.object, action.ability);
      if (typeof r === "string") return refuse(r);
      return done(givePriority(r, ev, seat)); // mana abilities don't use the stack; the player keeps priority
    }
    case "activate":
      return refuse("not yet: activated abilities arrive with the card language (PR 2)");
    case "special":
      return refuse(specialRefusal(action.special));
    case "answer":
      return refuse("there's no question to answer; you have priority");
    default:
      return refuse("not a legal action now");
  }
}

/** Every legal starting action for the seat with priority (engine-design.md section 3). */
export function legalStartingActions(s: GameState, seat: Seat): Action[] {
  const out: Action[] = [{ kind: "pass" }];
  for (const id of s.zones.hand[seat]) {
    const o = obj(s, id);
    for (const face of playableLandFaces(o.def)) if (!landRefusal(s, seat, id, face)) out.push({ kind: "playLand", object: id, face });
    for (const face of castableFaces(o.def)) if (!castRefusal(s, seat, id, face)) out.push({ kind: "cast", object: id, face });
  }
  for (const src of manaSources(s, seat)) {
    src.produces.forEach((_, ability) => out.push({ kind: "activateMana", object: src.object, ability }));
  }
  return out;
}

function givePriority(s0: GameState, ev: GameEvent[], seat: Seat, resetPasses = true): GameState {
  const s: GameState = { ...s0, priority: { seat, passedInRow: resetPasses ? [] : s0.priority.passedInRow } };
  return settle(s, ev);
}

/**
 * A player is about to get priority: run state-based actions (704.3, 117.5), handle anyone who lost, then
 * ask the priority holder.
 */
function settle(s0: GameState, ev: GameEvent[]): GameState {
  let s = stateBasedActions(s0, ev);
  if (s.over) return s;
  const active = s.turn.activeSeat;
  if (s.seats[active].lost) return startTurn(s, ev, nextLiving(s, active));
  let seat = s.priority.seat ?? active;
  if (s.seats[seat].lost) {
    seat = nextLiving(s, seat);
    s = { ...s, priority: { ...s.priority, seat } };
  }
  const [s1, id] = nextDecisionId(s);
  ev.push({ type: "priority", seat });
  const decision: Decision = {
    id,
    seat,
    kind: "priority",
    prompt: "You have priority",
    options: legalStartingActions(s1, seat),
    default: undefined,
    hiddenFromOthers: true,
  };
  return { ...s1, pendingDecision: decision };
}

function pass(s: GameState, ev: GameEvent[], seat: Seat): GameState {
  const passed = [...s.priority.passedInRow, seat];
  const everyone = living(s).every((x) => passed.includes(x));
  if (!everyone) return givePriorityKeepPasses({ ...s, priority: { seat, passedInRow: passed } }, ev, nextLiving(s, seat));
  // 117.4: all players passed in succession.
  if (s.zones.stack.length === 0) return advanceStep({ ...s, pendingDecision: null }, ev);
  const resolved = resolveTop({ ...s, pendingDecision: null }, ev);
  return givePriority(resolved, ev, resolved.turn.activeSeat); // 117.3b
}

function givePriorityKeepPasses(s: GameState, ev: GameEvent[], seat: Seat): GameState {
  return settle({ ...s, priority: { seat, passedInRow: s.priority.passedInRow } }, ev);
}

// ---------------------------------------------------------------- turns and steps

export function startTurn(s0: GameState, ev: GameEvent[], seat: Seat): GameState {
  const number = s0.turn.number + 1;
  const s: GameState = {
    ...s0,
    turn: { number, activeSeat: seat, step: "untap", attackersDeclared: false },
    priority: { seat: null, passedInRow: [] },
    pendingDecision: null,
    turnMemory: { landsPlayed: {}, spellsCast: {} },
    lki: pmapEmpty(), // LKI is kept for the turn only (PR 1)
    gameMemory: {
      ...s0.gameMemory,
      turnsTaken: { ...s0.gameMemory.turnsTaken, [seat]: (s0.gameMemory.turnsTaken[seat] ?? 0) + 1 },
    },
  };
  ev.push({ type: "turnBegin", turn: number, seat });
  return beginStep(s, ev);
}

function beginStep(s0: GameState, ev: GameEvent[]): GameState {
  let s = s0;
  const { step: current, activeSeat } = s.turn;
  ev.push({ type: "stepBegin", step: current });
  switch (current) {
    case "untap": {
      // 502.2-502.3: the active player's permanents lose summoning sickness and untap. No priority (502.4).
      for (const id of s.zones.battlefield) {
        const o = obj(s, id);
        if (o.controller !== activeSeat) continue;
        if (o.summoningSick) s = setObj(s, { ...o, summoningSick: false });
        s = setTapped(s, ev, id, false);
      }
      return advanceStep(s, ev);
    }
    case "draw":
      s = drawCard(s, ev, activeSeat);
      return givePriority(s, ev, activeSeat);
    case "cleanup":
      return cleanup(s, ev);
    default:
      return givePriority(s, ev, activeSeat);
  }
}

/** 103.8a: in a two-player game the first player skips their first draw step; 103.8c: no one does in multiplayer. */
function skipsDraw(s: GameState): boolean {
  return s.seatOrder.length === 2 && s.turn.number === 1;
}

export function advanceStep(s0: GameState, ev: GameEvent[]): GameState {
  let s = emptyPools(s0, ev); // 500.4
  const current = s.turn.step;
  if (current === "cleanup") return startTurn(s, ev, nextLiving(s, s.turn.activeSeat));
  let next = STEP_ORDER[STEP_ORDER.indexOf(current) + 1];
  if (next === "draw" && skipsDraw(s)) next = "main1";
  // 508.8: with no attackers, the declare blockers and combat damage steps are skipped.
  if (next === "declareBlockers" && !s.turn.attackersDeclared) next = "endCombat";
  s = { ...s, turn: { ...s.turn, step: next }, priority: { seat: null, passedInRow: [] }, pendingDecision: null };
  return beginStep(s, ev);
}

function cleanup(s0: GameState, ev: GameEvent[]): GameState {
  const seat = s0.turn.activeSeat;
  const hand = s0.zones.hand[seat];
  const excess = hand.length - s0.seats[seat].maxHandSize;
  if (excess > 0) {
    // 514.1: discard down to maximum hand size.
    const [s, id] = nextDecisionId(s0);
    const decision: Decision = {
      id,
      seat,
      kind: "chooseObjects",
      purpose: "discard",
      prompt: `Discard ${excess} card${excess === 1 ? "" : "s"} (maximum hand size)`,
      options: [],
      candidates: hand.slice(),
      min: excess,
      max: excess,
      hiddenFromOthers: true,
    };
    return { ...s, pendingDecision: decision };
  }
  return finishCleanup(s0, ev);
}

function finishCleanup(s0: GameState, ev: GameEvent[]): GameState {
  // 514.2: damage wears off; "until end of turn" effects end (none yet in PR 1).
  let s = s0;
  let any = false;
  for (const id of s.zones.battlefield) {
    const o = obj(s, id);
    if (o.damage || o.deathtouchHit) {
      s = setObj(s, { ...o, damage: 0, deathtouchHit: false });
      any = true;
    }
  }
  if (any) ev.push({ type: "damageRemoved" });
  return advanceStep({ ...s, pendingDecision: null }, ev); // 514.3: normally no priority in cleanup
}

function answerDiscard(
  s0: GameState,
  ev: GameEvent[],
  d: Decision,
  choice: Choice,
  refuse: (e: string) => StepResult,
  done: (s: GameState) => StepResult,
): StepResult {
  if (!("objects" in choice)) return refuse("choose the cards to discard");
  const picked = choice.objects;
  const unique = new Set(picked);
  if (unique.size !== picked.length) return refuse("a card was chosen twice");
  if (picked.length < (d.min ?? 0) || picked.length > (d.max ?? Infinity)) return refuse(`choose exactly ${d.min} card(s)`);
  if (!picked.every((id) => d.candidates?.includes(id) && s0.zones.hand[d.seat].includes(id))) return refuse("you can only discard cards in your hand");
  let s = s0;
  for (const id of picked) {
    [s] = moveObject(s, ev, id, "graveyard");
    ev.push({ type: "discard", seat: d.seat, object: id });
  }
  return done(finishCleanup({ ...s, pendingDecision: null }, ev));
}

// ---------------------------------------------------------------- lands and mana

function resolveFace(s: GameState, id: ObjectId, face: number | undefined, kind: "land" | "cast"): number {
  if (face !== undefined) return face;
  const def = obj(s, id).def;
  return (kind === "land" ? playableLandFaces(def) : castableFaces(def))[0] ?? 0;
}

function landRefusal(s: GameState, seat: Seat, id: ObjectId, face?: number): string | null {
  const o = maybeObj(s, id);
  if (!o || o.zone !== "hand" || o.owner !== seat) return "that card isn't in your hand";
  const faces = playableLandFaces(o.def);
  if (faces.length === 0) return "that card isn't a land";
  if (face !== undefined && !faces.includes(face)) return "that face isn't a land";
  if (face === undefined && faces.length > 1) return "choose which face to play";
  if (s.turn.activeSeat !== seat) return "you can only play a land on your own turn";
  if (!isMain(s.turn.step) || s.zones.stack.length > 0) return "lands are played in a main phase with an empty stack";
  if ((s.turnMemory.landsPlayed[seat] ?? 0) >= 1) return `you've already played a land this turn (${RULES.landPerTurn})`;
  return null;
}

function playLand(s0: GameState, ev: GameEvent[], seat: Seat, id: ObjectId, face: number): GameState {
  const [moved, newId] = moveObject(s0, ev, id, "battlefield", { controller: seat, upFace: face });
  let s = moved;
  s = { ...s, turnMemory: { ...s.turnMemory, landsPlayed: { ...s.turnMemory.landsPlayed, [seat]: (s.turnMemory.landsPlayed[seat] ?? 0) + 1 } } };
  ev.push({ type: "landPlayed", seat, object: newId });
  return givePriority(s, ev, seat); // 116.3c: after a special action the player receives priority
}

/** Untapped permanents the seat controls with mana abilities (PR 1: basic land types, 305.6). */
export function manaSources(s: GameState, seat: Seat): ManaSource[] {
  const out: ManaSource[] = [];
  for (const id of s.zones.battlefield) {
    const o = obj(s, id);
    if (o.controller !== seat || o.status.tapped) continue;
    const c = chars(s, id);
    if (c.types.includes("Creature") && o.summoningSick) continue; // 302.6
    const produces = intrinsicMana(c.subtypes);
    if (produces.length) out.push({ object: id, produces });
  }
  return out;
}

/** Activates a mana ability (605.3: resolves at once, no stack). Returns a reason string when refused. */
function manaAbility(s0: GameState, ev: GameEvent[], seat: Seat, id: ObjectId, ability: number): GameState | string {
  const o = maybeObj(s0, id);
  if (!o || o.zone !== "battlefield") return "that isn't on the battlefield";
  if (o.controller !== seat) return "you don't control that";
  const src = manaSources(s0, seat).find((x) => x.object === id);
  if (!src) return o.status.tapped ? "it's already tapped" : "that has no mana ability you can use now";
  const mana = src.produces[ability];
  if (!mana) return "no such mana ability";
  let s = setTapped(s0, ev, id, true);
  const pool = s.seats[seat].pool;
  s = setSeat(s, seat, { pool: { ...pool, [mana]: pool[mana] + 1 } });
  ev.push({ type: "manaAdded", seat, mana, amount: 1 });
  return s;
}

// ---------------------------------------------------------------- casting (601.2) and rollback (733)

function castRefusal(s: GameState, seat: Seat, id: ObjectId, face?: number): string | null {
  const o = maybeObj(s, id);
  if (!o || o.zone !== "hand" || o.owner !== seat) return "that card isn't in your hand";
  const faces = castableFaces(o.def);
  if (faces.length === 0) return "that card can't be cast";
  if (face !== undefined && !faces.includes(face)) return "that face can't be cast";
  if (face === undefined && faces.length > 1) return "choose which face to cast";
  const f = o.def.faces[face ?? faces[0]];
  if (f.manaCost === null) return "a card with no mana cost can't be cast without another way to pay";
  const cost = parseCost(f.manaCost);
  if (cost.unsupported.length) return `not yet: costs with ${cost.unsupported.join(" ")}`;
  const instantSpeed = f.types.includes("Instant");
  if (!instantSpeed) {
    // 307.1: sorcery timing.
    if (s.turn.activeSeat !== seat || !isMain(s.turn.step) || s.zones.stack.length > 0)
      return "that can only be cast in your main phase with an empty stack";
  }
  return null;
}

function beginCast(s0: GameState, ev: GameEvent[], seat: Seat, id: ObjectId, face: number): GameState {
  const checkpoint = s0;
  const o = obj(s0, id);
  const cost = o.def.faces[face].manaCost ?? "";
  // 601.2a: the card moves to the stack. Its upFace says which face is being cast (712.8f).
  const [s, spell] = moveObject({ ...s0, pendingDecision: null }, ev, id, "stack", {
    controller: seat,
    upFace: o.def.layout === "modal_dfc" ? face : 0,
    castInfo: { face, fromZone: o.zone, turn: s0.turn.number },
  });
  const withCast: GameState = { ...s, casting: { object: spell, seat, cost, checkpoint } };
  const parsed = parseCost(cost);
  if (parsed.generic === 0 && Object.values(parsed.symbols).every((n) => n === 0)) return completeCast(withCast, ev, []);
  return askPayment(withCast);
}

function askPayment(s0: GameState): GameState {
  const c = s0.casting;
  if (!c) throw new Error("askPayment without a spell being cast");
  const [s, id] = nextDecisionId(s0);
  const cost = parseCost(c.cost);
  const pool = s.seats[c.seat].pool;
  const sources = manaSources(s, c.seat);
  const options: Action[] = [];
  if (planAutoPay(pool, cost, sources)) options.push({ kind: "answer", decision: id, choice: { pay: "auto" } });
  if (payFromPool(pool, cost)) options.push({ kind: "answer", decision: id, choice: { pay: "pool" } });
  options.push({ kind: "answer", decision: id, choice: { cancel: true } });
  for (const src of sources) src.produces.forEach((_, ability) => options.push({ kind: "activateMana", object: src.object, ability }));
  const decision: Decision = {
    id,
    seat: c.seat,
    kind: "payCost",
    prompt: `Pay ${c.cost} for ${chars(s, c.object).name}`,
    source: c.object,
    options,
    default: { pay: "auto" },
    hiddenFromOthers: false,
  };
  return { ...s, pendingDecision: decision };
}

function rollback(s: GameState, ev: GameEvent[], reason: string): GameState {
  const c = s.casting;
  if (!c) throw new Error("rollback without a spell being cast");
  // 733: everything goes back to how it was before the cast began, including mana abilities used during it.
  // Their events were already sent with earlier steps; castRolledBack tells a screen to drop them.
  ev.push({ type: "castRolledBack", seat: c.seat, reason });
  return c.checkpoint;
}

function payOrRollback(s: GameState, ev: GameEvent[], choice: Choice): GameState {
  const c = s.casting;
  if (!c) throw new Error("payment without a spell being cast");
  if ("cancel" in choice) return rollback(s, ev, "cancelled");
  if (!("pay" in choice)) return rollback(s, ev, "no payment given");
  const cost = parseCost(c.cost);
  const pool = s.seats[c.seat].pool;
  if (choice.pay === "pool") {
    if (!payFromPool(pool, cost)) return rollback(s, ev, `can't pay ${c.cost} from the mana pool`);
    return completeCast(s, ev, []);
  }
  const plan = planAutoPay(pool, cost, manaSources(s, c.seat));
  if (!plan) return rollback(s, ev, `can't pay ${c.cost}`);
  return completeCast(s, ev, plan);
}

function completeCast(s0: GameState, ev: GameEvent[], plan: { object: ObjectId; mana: ManaType }[]): GameState {
  const c = s0.casting!;
  let s = s0;
  for (const step of plan) {
    s = setTapped(s, ev, step.object, true);
    const pool = s.seats[c.seat].pool;
    s = setSeat(s, c.seat, { pool: { ...pool, [step.mana]: pool[step.mana] + 1 } });
    ev.push({ type: "manaAdded", seat: c.seat, mana: step.mana, amount: 1 });
  }
  const before = s.seats[c.seat].pool;
  const after = payFromPool(before, parseCost(c.cost));
  if (!after) throw new Error("payment plan didn't cover the cost");
  if (poolTotal(before) !== poolTotal(after)) {
    const spent = Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v - after[k as keyof typeof after]]).filter(([, v]) => v));
    ev.push({ type: "manaSpent", seat: c.seat, mana: spent });
  }
  s = setSeat(s, c.seat, { pool: after });
  const spellsCast = { ...s.turnMemory.spellsCast, [c.seat]: (s.turnMemory.spellsCast[c.seat] ?? 0) + 1 };
  s = { ...s, casting: null, pendingDecision: null, turnMemory: { ...s.turnMemory, spellsCast } };
  ev.push({ type: "cast", seat: c.seat, object: c.object, face: obj(s, c.object).castInfo?.face ?? 0 });
  return givePriority(s, ev, c.seat); // 117.3c
}

// ---------------------------------------------------------------- resolving (608)

function resolveTop(s0: GameState, ev: GameEvent[]): GameState {
  const top = s0.zones.stack[s0.zones.stack.length - 1];
  const o = obj(s0, top);
  const f = printedFace(o);
  ev.push({ type: "resolve", object: top });
  if (isPermanentFace(f)) {
    // 608.3: a permanent spell enters the battlefield under its controller's control, as the face cast.
    return moveObject(s0, ev, top, "battlefield", { controller: o.controller, upFace: o.status.upFace })[0];
  }
  if (o.def.layout === "adventure" && o.castInfo?.face === 1) return moveObject(s0, ev, top, "exile")[0]; // 715.4
  return moveObject(s0, ev, top, "graveyard")[0]; // 608.2n
}

// ---------------------------------------------------------------- state-based actions (704)

export function stateBasedActions(s0: GameState, ev: GameEvent[]): GameState {
  let s = s0;
  for (let guard = 0; guard < 1000; guard++) {
    const losers: [Seat, string][] = [];
    for (const seat of living(s)) {
      const p = s.seats[seat];
      if (p.life <= 0) losers.push([seat, `life total 0 or less (${RULES.sbaLife})`]);
      else if (p.drewFromEmpty) losers.push([seat, `drew from an empty library (${RULES.sbaEmptyDraw})`]);
      else if (p.poison >= 10) losers.push([seat, `10 or more poison counters (${RULES.sbaPoison})`]);
    }
    const dying: ObjectId[] = [];
    for (const id of s.zones.battlefield) {
      const c = chars(s, id);
      const o = obj(s, id);
      if (c.types.includes("Creature") && c.toughness !== null) {
        if (c.toughness <= 0) dying.push(id); // 704.5f
        else if (o.damage >= c.toughness) dying.push(id); // 704.5g
      } else if (c.types.includes("Planeswalker") && (o.counters.loyalty ?? 0) <= 0) dying.push(id); // 704.5i
    }
    if (losers.length === 0 && dying.length === 0) return s;
    for (const id of dying) [s] = moveObject(s, ev, id, "graveyard");
    for (const [seat, reason] of losers) s = eliminate(s, ev, seat, reason);
    if (s.over) return s;
  }
  throw new Error(`state-based actions didn't settle (${RULES.loopGuard})`);
}

// ---------------------------------------------------------------- losing (104, 800.4a basic)

/**
 * Basic elimination for PR 1 (800.4a): the player loses and every object they own leaves the game.
 * Ending control effects and exiling objects they control but don't own come with PR 4c (no control
 * changes exist before layers).
 */
export function eliminate(s0: GameState, ev: GameEvent[], seat: Seat, reason: string): GameState {
  let s = setSeat(s0, seat, { lost: true, lossReason: reason, drewFromEmpty: false });
  ev.push({ type: "lose", seat, reason });
  const owned = (id: ObjectId) => obj(s0, id).owner === seat;
  const gone: ObjectId[] = [];
  const keep = (list: ObjectId[]) => list.filter((id) => (owned(id) ? (gone.push(id), false) : true));
  const z = s.zones;
  s = {
    ...s,
    zones: {
      library: { ...z.library, [seat]: [] },
      hand: { ...z.hand, [seat]: [] },
      graveyard: { ...z.graveyard, [seat]: [] },
      battlefield: keep(z.battlefield),
      stack: keep(z.stack),
      exile: keep(z.exile),
      command: keep(z.command),
    },
  };
  for (const id of [...z.library[seat], ...z.hand[seat], ...z.graveyard[seat]]) gone.push(id);
  let objects = s.objects;
  for (const id of gone) objects = pmapDelete(objects, id);
  s = { ...s, objects, priority: { ...s.priority, passedInRow: s.priority.passedInRow.filter((x) => x !== seat) } };
  if (s.casting?.seat === seat) s = { ...s, casting: null };
  if (s.pendingDecision?.seat === seat) s = { ...s, pendingDecision: null };
  const left = living(s);
  if (left.length <= 1) {
    const winner = left[0] ?? null;
    ev.push({ type: "gameOver", winner });
    return { ...s, over: true, winner, pendingDecision: null, casting: null };
  }
  return s;
}

/** After a concession: keep the game moving if the leaver was the one deciding or the active player. */
function afterLoss(s: GameState, ev: GameEvent[]): GameState {
  if (s.over) return s;
  const active = s.turn.activeSeat;
  if (s.seats[active].lost) return startTurn(s, ev, nextLiving(s, active));
  if (s.pendingDecision) return s;
  const holder = s.priority.seat ?? active;
  return givePriorityKeepPasses(s, ev, s.seats[holder].lost ? nextLiving(s, holder) : holder);
}
