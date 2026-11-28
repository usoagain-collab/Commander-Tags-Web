// The engine: `step(state, seat, action) -> { state, events, decision }` (engine-design.md).
// A pure function. It never waits for anyone: it returns the next Decision and stops.
//
// PR 1 built turn steps, priority, playing lands, casting with rollback (601.2, 733), the stack, basic
// state-based actions and elimination. PR 2 adds the card language: spells and abilities with scripts,
// activated and mana abilities, targets (and rechecking them, 608.2b), modes, kicker, X, alternative costs,
// effects that ask questions mid-resolution, extra turns, and the state checks for tokens, deathtouch,
// Auras, Equipment and counters. Combat, Commander rules and mulligans are PR 3; triggers PR 4a.

import { chars, hasKeyword } from "./chars";
import { castableFaces, isPermanentFace, playableLandFaces, printedFace } from "./cards";
import { pmapEmpty } from "./pmap";
import { eliminate } from "./players";
import {
  activateActions,
  activateManaAbility,
  activateRefusal,
  askPayment,
  beginActivation,
  beginCast,
  castActions,
  castRefusal,
  castWords,
  isCastDecision,
  answerCast,
  manaActions,
  manaSources,
  recheckTargets,
  selfOf,
  stackActivatable,
  planFor,
} from "./play";
import { answerResolution, leaveStack, newResolution, runResolution, setManaSourceProvider } from "./lang/run";
import { RULES } from "./rules-refs";
import { specialRefusal } from "./special";
import { ceaseToExist, drawCard, emptyPools, living, maybeObj, moveObject, nextDecisionId, nextLiving, obj, setObj, setTapped } from "./state";
import type { Action, Choice, Decision, GameEvent, GameState, ObjectId, Seat, Step, StepResult } from "./types";

export { manaSources } from "./play";

setManaSourceProvider((s, seat, convoke) => manaSources(s, seat, convoke));

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

  if (d.kind === "priority") return priorityAction(state, ev, seat, action, refuse, done);

  if (isCastDecision(state)) {
    if (action.kind === "activateMana" && d.kind === "payCost") {
      const r = activateManaAbility(state, ev, seat, action.object, action.ability, action.color);
      if (typeof r === "string") return refuse(r);
      return done(askPayment({ ...r, pendingDecision: null }));
    }
    if (action.kind !== "answer" || action.decision !== d.id) return refuse(d.kind === "payCost" ? "answer the payment first (pay, or cancel the spell)" : "answer the pending choice first (or cancel)");
    const r = answerCast(state, ev, action.choice);
    if (typeof r === "string") return refuse(r);
    return done(afterCasting(r, ev, seat));
  }

  if (action.kind !== "answer" || action.decision !== d.id) return refuse("answer the pending choice first");

  if (state.resolving?.waiting) {
    const r = answerResolution(state, ev, action.choice);
    if (typeof r === "string") return refuse(r);
    return done(afterResolving(r, ev));
  }

  if (d.kind === "chooseObjects" && d.purpose === "discard") return answerDiscard(state, ev, d, action.choice, refuse, done);
  return refuse(`not yet: ${d.kind} decisions`);
}

/** A cast or activation that just finished (or rolled back) hands priority back (601.2i, 117.3c). */
function afterCasting(s: GameState, ev: GameEvent[], seat: Seat): GameState {
  if (s.casting || s.pendingDecision || s.over) return s;
  return givePriority(s, ev, seat);
}

/** A resolution that finished: the active player gets priority (117.3b). */
function afterResolving(s: GameState, ev: GameEvent[]): GameState {
  if (s.pendingDecision || s.over) return s;
  return givePriority(s, ev, s.turn.activeSeat);
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
      const why = castRefusal(s, seat, action.object, action.face, action.via);
      if (why) return refuse(why);
      return done(afterCasting(beginCast(s, ev, seat, action.object, resolveFace(s, action.object, action.face, "cast"), action.via), ev, seat));
    }
    case "activateMana": {
      const r = activateManaAbility(s, ev, seat, action.object, action.ability, action.color);
      if (typeof r === "string") return refuse(r);
      return done(givePriority(r, ev, seat)); // mana abilities don't use the stack; the player keeps priority
    }
    case "activate": {
      const why = activateRefusal(s, seat, action.object, action.ability);
      if (why) return refuse(why);
      return done(afterCasting(beginActivation(s, ev, seat, action.object, action.ability), ev, seat));
    }
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
  }
  out.push(...castActions(s, seat), ...activateActions(s, seat), ...manaActions(s, seat));
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
  return afterResolving(resolved, ev); // 117.3b
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
    turnMemory: { landsPlayed: {}, spellsCast: {}, loyaltyUsed: [], activated: [] },
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
  if (current === "cleanup") {
    // 500.7: extra turns come right after this one, the most recently created first.
    // After them, play goes on from the player whose regular turn came before them.
    const extra = s.gameMemory.extraTurns.filter((seat) => !s.seats[seat].lost);
    const resume = s.gameMemory.resumeAfter ?? s.turn.activeSeat;
    if (extra.length) {
      const [seat, ...rest] = extra;
      return startTurn({ ...s, gameMemory: { ...s.gameMemory, extraTurns: rest, resumeAfter: resume } }, ev, seat);
    }
    const { resumeAfter: _done, ...memory } = s.gameMemory;
    void _done;
    return startTurn({ ...s, gameMemory: memory }, ev, nextLiving(s, resume));
  }
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

// ---------------------------------------------------------------- resolving (608)

function resolveTop(s0: GameState, ev: GameEvent[]): GameState {
  const top = s0.zones.stack[s0.zones.stack.length - 1];
  const o = obj(s0, top);
  ev.push({ type: "resolve", object: top });
  // 608.2b: a spell or ability whose every target is now illegal doesn't resolve.
  const { vars, had, anyLegal } = recheckTargets(s0, o);
  if (had && !anyLegal) {
    ev.push({ type: "fizzle", object: top });
    return leaveStack(s0, ev, top, "graveyard");
  }
  const info = o.castInfo;
  const face = o.ability ? o.ability.face : info?.face ?? 0;
  const plan = planFor(s0, o, { seat: o.controller, face, via: info?.via, modes: info?.modes, kicked: info?.kicked, x: info?.x, targets: o.targets ?? {} });
  if (!o.ability && isPermanentFace(printedFace(o))) {
    // 608.3: a permanent spell enters the battlefield under its controller's control, as the face cast.
    const moved = moveObject(s0, ev, top, "battlefield", { controller: o.controller, upFace: o.status.upFace });
    let s = moved[0];
    const id = moved[1];
    // 303.4f: an Aura spell enters attached to the object it targeted.
    if (printedFace(o).subtypes.includes("Aura")) {
      const target = (vars.enchant ?? Object.values(vars)[0] ?? [])[0];
      if (target && "o" in target && maybeObj(s, target.o)) {
        s = setObj(s, { ...obj(s, id), attachedTo: target.o });
        ev.push({ type: "attached", object: id, to: target.o });
      }
    }
    return s;
  }
  if (o.ability && !stackActivatable(o)) return leaveStack(s0, ev, top, "graveyard");
  const resolution = newResolution({
    object: top,
    controller: o.controller,
    self: selfOf(o),
    castWith: castWords(info),
    x: info?.x ?? 0,
    divide: o.divide ?? {},
    effect: plan.effect,
    vars,
    chosen: o.targets ?? {},
  });
  return runResolution({ ...s0, resolving: resolution }, ev);
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
    const unattach: ObjectId[] = [];
    const annihilate: ObjectId[] = [];
    // 704.5d: a token that has left the battlefield ceases to exist.
    const gone: ObjectId[] = [];
    for (const zone of ["graveyard", "hand", "library"] as const) for (const seat of s.seatOrder) for (const id of s.zones[zone][seat] ?? []) if (obj(s, id).isToken) gone.push(id);
    for (const id of [...s.zones.exile, ...s.zones.command]) if (obj(s, id).isToken) gone.push(id);
    for (const id of s.zones.battlefield) {
      const c = chars(s, id);
      const o = obj(s, id);
      const indestructible = hasKeyword(s, id, "indestructible");
      if (c.types.includes("Creature") && c.toughness !== null) {
        if (c.toughness <= 0) dying.push(id); // 704.5f
        else if (o.damage >= c.toughness && !indestructible) dying.push(id); // 704.5g, 702.12b
        else if (o.deathtouchHit && o.damage > 0 && !indestructible) dying.push(id); // 704.5h
      } else if (c.types.includes("Planeswalker") && (o.counters.loyalty ?? 0) <= 0) dying.push(id); // 704.5i
      const host = typeof o.attachedTo === "number" ? maybeObj(s, o.attachedTo) : undefined;
      if (c.subtypes.includes("Aura") && (!host || host.zone !== "battlefield")) dying.push(id); // 704.5m
      if (c.subtypes.includes("Equipment") && o.attachedTo !== null && (!host || host.zone !== "battlefield" || !chars(s, host.id).types.includes("Creature"))) unattach.push(id); // 704.5n
      if ((o.counters["+1/+1"] ?? 0) > 0 && (o.counters["-1/-1"] ?? 0) > 0) annihilate.push(id); // 704.5q
    }
    if (losers.length === 0 && dying.length === 0 && gone.length === 0 && unattach.length === 0 && annihilate.length === 0) return s;
    for (const id of new Set(dying)) [s] = moveObject(s, ev, id, "graveyard");
    for (const id of gone) if (maybeObj(s, id)) s = ceaseToExist(s, ev, id);
    for (const id of unattach) if (maybeObj(s, id)) s = setObj(s, { ...obj(s, id), attachedTo: null });
    for (const id of annihilate) {
      if (!maybeObj(s, id)) continue;
      const o = obj(s, id);
      const n = Math.min(o.counters["+1/+1"], o.counters["-1/-1"]);
      const counters: Record<string, number> = { ...o.counters, "+1/+1": o.counters["+1/+1"] - n, "-1/-1": o.counters["-1/-1"] - n };
      for (const k of ["+1/+1", "-1/-1"]) if (counters[k] === 0) delete counters[k];
      s = setObj(s, { ...o, counters });
    }
    for (const [seat, reason] of losers) s = eliminate(s, ev, seat, reason);
    if (s.over) return s;
  }
  throw new Error(`state-based actions didn't settle (${RULES.loopGuard})`);
}

/** After a concession: keep the game moving if the leaver was the one deciding or the active player. */
function afterLoss(s0: GameState, ev: GameEvent[]): GameState {
  let s = s0;
  if (s.over) return s;
  // A resolution waiting on the player who left goes on without that choice (800.4a simplification).
  if (s.resolving && !s.resolving.waiting && !s.pendingDecision) {
    s = runResolution(s, ev);
    if (s.pendingDecision || s.over) return s;
  }
  const active = s.turn.activeSeat;
  if (s.seats[active].lost) return startTurn(s, ev, nextLiving(s, active));
  if (s.pendingDecision) return s;
  const holder = s.priority.seat ?? active;
  return givePriorityKeepPasses(s, ev, s.seats[holder].lost ? nextLiving(s, holder) : holder);
}
