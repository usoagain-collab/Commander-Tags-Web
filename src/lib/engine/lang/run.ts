// Resolving a spell or ability's effect (608.2): the card language's blocks, run one step at a time.
// A step that needs a choice (discard, search, "may", "unless", scry...) returns a Decision and the
// resolution pauses in `state.resolving`; the answer resumes it at the same step. Everything stays plain
// data, so a paused resolution survives JSON, replays and rewinds like the rest of the state.
/* eslint-disable @typescript-eslint/no-explicit-any -- scripts are checked by validate.ts before they get here */

import { chars, hasKeyword } from "../chars";
import { planAutoPay, parseCost, payFromPool, addToPool, bundleOf, COLORS, type PayStep } from "../mana";
import { eliminate } from "../players";
import { nextFloat, shuffled } from "../rng";
import { ceaseToExist, createObject, drawCard, maybeObj, moveObject, nextDecisionId, obj, setObj, setSeat, setTapped } from "../state";
import type { Choice, Decision, GameEvent, GameState, ManaType, ObjectId, Resolution, Seat, Task } from "../types";
import { BLOCK_BY_NAME } from "./blocks";
import { cantBeCountered, costParts, manaPart } from "./abilities";
import { apnap, charsOf, isObjRef, matches, numberOf, objIds, refKey, refsOf, seatOf, seatsOf, selectAll, test, topOfLibrary, valRefs, type EvalCtx } from "./eval";
import type { Json, Ref, Step, Val } from "./script-types";
import { BUILT_IN_TOKENS, tokenDef } from "./tokens";
import type { TokenScript } from "./script-types";

type A = Record<string, any>;
type Ask = { decision: Omit<Decision, "id">; data: Val | null };
type Out = { s: GameState; push?: Step[]; bind?: Record<string, Val>; ask?: Ask };
type Handler = (s: GameState, ev: GameEvent[], ctx: EvalCtx & { r: Resolution }, args: A, answer: Choice | undefined, data: Val | null) => Out | string;

/** Mana sources a seat can tap without sacrificing anything (set by the engine, which owns that logic). */
let manaSourcesFor: (s: GameState, seat: Seat, convoke: boolean) => import("../mana").ManaSource[] = () => [];
export function setManaSourceProvider(f: typeof manaSourcesFor) {
  manaSourcesFor = f;
}

// ---------------------------------------------------------------- the loop

export function ctxOf(r: Resolution): EvalCtx & { r: Resolution } {
  return { controller: r.controller, self: r.self, vars: r.vars, x: r.x, castWith: r.castWith, moved: r.moved, r };
}

/** Runs the resolution until it finishes or needs a choice. */
export function runResolution(s0: GameState, ev: GameEvent[]): GameState {
  let s = s0;
  for (let guard = 0; guard < 10_000; guard++) {
    const r = s.resolving;
    if (!r || s.over) return s;
    if (r.todo.length === 0) return finishResolution(s, ev);
    const [task, ...rest] = r.todo;
    s = { ...s, resolving: { ...r, todo: rest } };
    if ("bind" in task) {
      s = { ...s, resolving: { ...s.resolving!, vars: { ...s.resolving!.vars, [task.bind]: task.value } } };
      continue;
    }
    const out = execute(s, ev, task.step, undefined, null);
    if (typeof out === "string") throw new Error(`effect step refused without an answer: ${out}`);
    s = apply(out, task.step, ev);
    if (s.pendingDecision) return s;
  }
  throw new Error("a resolution ran 10,000 steps (loop guard, 104.4b)");
}

/** Feeds an answer to the step the resolution is waiting on. A string is a refusal (the decision stays). */
export function answerResolution(s0: GameState, ev: GameEvent[], choice: Choice): GameState | string {
  const r = s0.resolving;
  if (!r?.waiting) return "nothing is waiting for an answer";
  const local: GameEvent[] = [];
  const out = execute({ ...s0, resolving: { ...r, waiting: null }, pendingDecision: null }, local, r.waiting.step, choice, r.waiting.data);
  if (typeof out === "string") return out;
  ev.push(...local);
  const s = apply(out, r.waiting.step, ev, local);
  if (s.pendingDecision) return s;
  return runResolution(s, ev);
}

function apply(out: Out, step: Step, ev: GameEvent[], local?: GameEvent[]): GameState {
  let s = out.s;
  const r = s.resolving;
  if (!r) return s;
  let next: Resolution = r;
  const moved = { ...r.moved };
  for (const e of local ?? ev) if (e.type === "zoneChange") moved[e.oldId] = e.newId;
  next = { ...next, moved };
  if (out.bind) next = { ...next, vars: { ...next.vars, ...out.bind } };
  if (out.push?.length) next = { ...next, todo: [...out.push.map((st): Task => ({ step: st })), ...next.todo] };
  if (out.ask) {
    const [s1, id] = nextDecisionId(s);
    s = s1;
    next = { ...next, waiting: { step, data: out.ask.data } };
    s = { ...s, pendingDecision: { ...out.ask.decision, id } as Decision };
  }
  s = { ...s, resolving: next };
  // The resolving object can be gone if its controller lost mid-resolution (Door to Nothingness on yourself).
  if (!maybeObj(s, next.object) && !s.over) return { ...s, resolving: null, pendingDecision: s.pendingDecision && next.waiting ? null : s.pendingDecision };
  return s;
}

function execute(s: GameState, ev: GameEvent[], step: Step, answer: Choice | undefined, data: Val | null): Out | string {
  const ctx = ctxOf(s.resolving!);
  if ("if" in step) {
    const branch = test(s, ctx, step.if as Json) ? step.then : step.else;
    return { s, push: (branch as Step[] | undefined) ?? [] };
  }
  const [name] = Object.keys(step);
  const def = BLOCK_BY_NAME[name];
  let args = step[name] as A;
  if (def?.shorthand && (args === null || typeof args !== "object" || Array.isArray(args))) args = { [def.shorthand]: args };
  if (name === "let") {
    const bind: Record<string, Val> = {};
    for (const [k, e] of Object.entries(args)) bind[k] = numberOf(s, { ...ctx, vars: { ...ctx.vars, ...bind } }, e as Json);
    return { s, bind };
  }
  if (name === "targets") return { s }; // chosen while casting (601.2c)
  const h = HANDLERS[name];
  if (!h || def?.runs !== "now") {
    ev.push({ type: "notYet", block: name, runs: def?.runs ?? "later", object: ctx.r.object });
    return { s };
  }
  return h(s, ev, ctx, args, answer, data);
}

/** 608.2n, 608.2k: an instant or sorcery goes to its owner's graveyard; an ability ceases to exist. */
function finishResolution(s0: GameState, ev: GameEvent[]): GameState {
  const r = s0.resolving!;
  const s: GameState = { ...s0, resolving: null };
  const o = maybeObj(s, r.object);
  if (!o || o.zone !== "stack") return s;
  if (o.ability) return ceaseToExist(s, ev, o.id);
  // 715.4: an Adventure that resolves is exiled, and its owner may cast the creature later.
  if (o.def.layout === "adventure" && o.castInfo?.face === 1 && o.castInfo.via !== "flashback") return moveObject(s, ev, o.id, "exile", { onAdventure: true })[0];
  return leaveStack(s, ev, o.id, "graveyard");
}

/** A spell leaving the stack without resolving, or after: flashback exiles it wherever it was going (702.34a). */
export function leaveStack(s: GameState, ev: GameEvent[], id: ObjectId, to: "graveyard" | "hand" | "exile" | "library"): GameState {
  const o = obj(s, id);
  if (o.ability) return ceaseToExist(s, ev, id);
  if (o.castInfo?.via === "flashback") return moveObject(s, ev, id, "exile")[0];
  return moveObject(s, ev, id, to)[0];
}

// ---------------------------------------------------------------- helpers

const one = (refs: Ref[]) => refs[0];
const objectsArg = (s: GameState, ctx: EvalCtx, a: A): Ref[] => {
  if (a.select !== undefined) return selectAll(s, ctx, a.select);
  return refsOf(s, ctx, a.objects ?? a.object);
};
const liveIds = (s: GameState, refs: Ref[]) => objIds(refs).filter((id) => maybeObj(s, id));
const onField = (s: GameState, refs: Ref[]) => liveIds(s, refs).filter((id) => obj(s, id).zone === "battlefield");
const asRefs = (ids: ObjectId[]): Ref[] => ids.map((o) => ({ o }));
const bindAs = (a: A, v: Val): Record<string, Val> | undefined => (typeof a.as === "string" ? { [a.as]: v } : undefined);

function decision(d: Omit<Decision, "id" | "options" | "hiddenFromOthers"> & Partial<Pick<Decision, "options" | "hiddenFromOthers">>): Omit<Decision, "id"> {
  return { options: [], hiddenFromOthers: false, ...d };
}

function moveAll(s0: GameState, ev: GameEvent[], ids: ObjectId[], to: Parameters<typeof moveObject>[3], opts: Parameters<typeof moveObject>[4] = {}): [GameState, ObjectId[]] {
  let s = s0;
  const out: ObjectId[] = [];
  for (const id of ids) {
    if (!maybeObj(s, id)) continue;
    if (obj(s, id).zone === "stack") {
      s = leaveStack(s, ev, id, to === "battlefield" || to === "command" || to === "stack" ? "exile" : (to as "graveyard" | "hand" | "exile" | "library"));
      continue;
    }
    let nid: ObjectId;
    [s, nid] = moveObject(s, ev, id, to, opts);
    out.push(nid);
  }
  return [s, out];
}

/** Puts cards on top of their owners' libraries so that list[0] ends up on top. */
function putOnTop(s0: GameState, ev: GameEvent[], ids: ObjectId[]): GameState {
  let s = s0;
  for (const id of [...ids].reverse()) if (maybeObj(s, id)) [s] = moveObject(s, ev, id, "library");
  return s;
}

function putOnBottom(s0: GameState, ev: GameEvent[], ids: ObjectId[]): GameState {
  let s = s0;
  for (const id of ids) if (maybeObj(s, id)) [s] = moveObject(s, ev, id, "library", { bottom: true });
  return s;
}

function chooseCount(s: GameState, ctx: EvalCtx, a: A, available: number): { min: number; max: number } {
  if (a.count !== undefined) {
    if (typeof a.count === "object" && a.count !== null && ("min" in a.count || "max" in a.count)) {
      const min = a.count.min === undefined ? 0 : numberOf(s, ctx, a.count.min);
      const max = a.count.max === undefined ? available : numberOf(s, ctx, a.count.max);
      return { min: Math.min(min, available), max: Math.min(max, available) };
    }
    const n = Math.min(numberOf(s, ctx, a.count), available);
    return { min: n, max: n };
  }
  const min = a.min === undefined ? (a.max === undefined ? Math.min(1, available) : 0) : numberOf(s, ctx, a.min);
  const max = a.max === undefined ? Math.max(min, 1) : numberOf(s, ctx, a.max);
  return { min: Math.min(min, available), max: Math.min(max, available) };
}

/** Checks a chooseObjects answer: right count, no repeats, all from the candidates. */
function pickObjects(answer: Choice | undefined, candidates: ObjectId[], min: number, max: number): ObjectId[] | string {
  if (!answer || !("objects" in answer)) return "choose the objects";
  const picked = answer.objects;
  if (new Set(picked).size !== picked.length) return "an object was chosen twice";
  if (picked.length < min || picked.length > max) return min === max ? `choose exactly ${min}` : `choose between ${min} and ${max}`;
  if (!picked.every((id) => candidates.includes(id))) return "that can't be chosen";
  return picked;
}

const idsData = (ids: ObjectId[]): Val => ids.map((o) => ({ o }));
const dataIds = (d: Val | null): ObjectId[] => objIds(valRefs(d ?? []));

/** Damage (120.3): to a creature it's marked, to a planeswalker it removes loyalty, to a player it's life loss. */
export function dealDamage(s0: GameState, ev: GameEvent[], source: ObjectId, to: Ref, amount: number): [GameState, number] {
  if (amount <= 0) return [s0, 0];
  let s = s0;
  const src = charsOf(s, source);
  if ("o" in to) {
    const o = maybeObj(s, to.o);
    if (!o || o.zone !== "battlefield") return [s, 0];
    const c = chars(s, to.o);
    if (src && protectedFrom(c.keywords, src.colors)) return [s, 0]; // 702.16e: damage is prevented
    if (c.types.includes("Creature")) {
      const deathtouch = !!src?.keywords.some((k) => k.keyword === "deathtouch");
      s = setObj(s, { ...o, damage: o.damage + amount, deathtouchHit: o.deathtouchHit || deathtouch });
    }
    if (c.types.includes("Planeswalker")) {
      const now = obj(s, to.o);
      s = setObj(s, { ...now, counters: { ...now.counters, loyalty: Math.max(0, (now.counters.loyalty ?? 0) - amount) } });
    }
  } else {
    if (s.seats[to.p]?.lost) return [s, 0];
    s = setSeat(s, to.p, { life: s.seats[to.p].life - amount });
    ev.push({ type: "lifeLoss", seat: to.p, amount });
  }
  ev.push({ type: "damage", source, to, amount });
  // 702.15b: lifelink. The source's controller gains that much life.
  if (src?.keywords.some((k) => k.keyword === "lifelink")) s = gainLife(s, ev, src.controller, amount);
  return [s, amount];
}

function protectedFrom(keywords: { keyword: string; [k: string]: unknown }[], colors: string[]): boolean {
  return keywords.some((k) => {
    if (k.keyword !== "protection") return false;
    if (k.from === "everything") return true;
    const from = (Array.isArray(k.from) ? k.from : []).map((c) => ({ white: "W", blue: "U", black: "B", red: "R", green: "G" })[c as string] ?? c);
    return colors.some((c) => from.includes(c));
  });
}

export { protectedFrom };

function gainLife(s: GameState, ev: GameEvent[], seat: Seat, amount: number): GameState {
  if (amount <= 0 || s.seats[seat]?.lost) return s;
  ev.push({ type: "lifeGain", seat, amount });
  return setSeat(s, seat, { life: s.seats[seat].life + amount });
}

function arrange(s0: GameState, ev: GameEvent[], seat: Seat, amount: number, answer: Choice | undefined, data: Val | null, bottomZone: "library" | "graveyard", purpose: "scry" | "surveil"): Out | string {
  if (!answer) {
    const top = topOfLibrary(s0, seat, amount);
    if (top.length === 0) return { s: s0 };
    return {
      s: s0,
      ask: {
        decision: decision({ seat, kind: "arrange", purpose, prompt: purpose === "scry" ? `Scry ${amount}` : `Surveil ${amount}`, candidates: top, default: { top, bottom: [] }, hiddenFromOthers: true }),
        data: idsData(top),
      },
    };
  }
  if (!("top" in answer)) return "say which cards stay on top (in order) and which go " + (purpose === "scry" ? "to the bottom" : "to the graveyard");
  const seen = dataIds(data);
  const all = [...answer.top, ...answer.bottom];
  if (all.length !== seen.length || new Set(all).size !== all.length || !all.every((id) => seen.includes(id))) return "every card looked at goes on top or " + (purpose === "scry" ? "bottom" : "into the graveyard") + ", once";
  let s = s0;
  if (bottomZone === "library") s = putOnBottom(s, ev, answer.bottom);
  else [s] = moveAll(s, ev, answer.bottom, "graveyard");
  // the cards kept on top: take them off and put them back in the chosen order
  const lib = s.zones.library[seat].filter((id) => !answer.top.includes(id));
  s = { ...s, zones: { ...s.zones, library: { ...s.zones.library, [seat]: [...lib, ...[...answer.top].reverse()] } } };
  return { s };
}

function payCostNow(s0: GameState, ev: GameEvent[], seat: Seat, cost: Json): GameState | null {
  let s = s0;
  const parts = costParts(cost);
  const mana = manaPart(parts);
  const life = parts.reduce((n, p) => n + ("payLife" in p ? Number(p.payLife) : 0), 0);
  if (life > 0 && s.seats[seat].life < life) return null;
  if (mana) {
    const parsed = parseCost(mana);
    const plan = planAutoPay(s.seats[seat].pool, parsed, manaSourcesFor(s, seat, false));
    if (!plan) return null;
    s = tapPlan(s, ev, seat, plan);
    const after = payFromPool(s.seats[seat].pool, parsed);
    if (!after) return null;
    s = setSeat(s, seat, { pool: after });
  }
  if (life > 0) {
    s = setSeat(s, seat, { life: s.seats[seat].life - life });
    ev.push({ type: "lifeLoss", seat, amount: life });
  }
  return s;
}

export function tapPlan(s0: GameState, ev: GameEvent[], seat: Seat, plan: PayStep[]): GameState {
  let s = s0;
  for (const step of plan) {
    s = setTapped(s, ev, step.object, true);
    s = setSeat(s, seat, { pool: addToPool(s.seats[seat].pool, step.bundle) });
    for (const m of new Set(step.bundle)) ev.push({ type: "manaAdded", seat, mana: m, amount: step.bundle.filter((x) => x === m).length });
  }
  return s;
}

function canPay(s: GameState, seat: Seat, cost: Json): boolean {
  const parts = costParts(cost);
  const life = parts.reduce((n, p) => n + ("payLife" in p ? Number(p.payLife) : 0), 0);
  if (life > s.seats[seat].life) return false;
  const mana = manaPart(parts);
  return !mana || !!planAutoPay(s.seats[seat].pool, parseCost(mana), manaSourcesFor(s, seat, false));
}

function tokenScript(s: GameState, ctx: EvalCtx, token: any): TokenScript | null {
  if (typeof token === "string") {
    if (BUILT_IN_TOKENS[token]) return BUILT_IN_TOKENS[token];
    const src = charsOf(s, ctx.self) && maybeObj(s, ctx.self);
    const scriptTokens = (src ? src.def.script?.tokens : undefined) ?? (ctx as any).r?.tokens;
    return (scriptTokens ?? []).find((t: TokenScript) => t.id === token) ?? null;
  }
  return token as TokenScript;
}

// ---------------------------------------------------------------- the blocks

const HANDLERS: Record<string, Handler> = {
  // ---- cards
  draw(s0, ev, ctx, a) {
    let s = s0;
    const seat = seatOf(s, ctx, a.player);
    if (seat === null) return { s };
    const n = numberOf(s, ctx, a.amount);
    for (let i = 0; i < n; i++) s = drawCard(s, ev, seat);
    return { s };
  },

  discard(s, ev, ctx, a, answer, data) {
    const seat = seatOf(s, ctx, a.player);
    if (seat === null) return { s };
    const hand = s.zones.hand[seat];
    const n = a.all ? hand.length : Math.min(numberOf(s, ctx, a.amount ?? 1), hand.length);
    const finish = (ids: ObjectId[], from: GameState = s): Out => {
      let s1 = from;
      const out: ObjectId[] = [];
      for (const id of ids) {
        let nid: ObjectId;
        [s1, nid] = moveObject(s1, ev, id, "graveyard");
        ev.push({ type: "discard", seat, object: nid });
        out.push(nid);
      }
      return { s: s1, bind: bindAs(a, asRefs(out)) };
    };
    if (n >= hand.length || n === 0) return finish(n === 0 ? [] : hand.slice());
    if (a.random) {
      let rng = s.rng;
      const pool = hand.slice();
      const picked: ObjectId[] = [];
      for (let i = 0; i < n; i++) {
        let f: number;
        [f, rng] = nextFloat(rng);
        picked.push(pool.splice(Math.floor(f * pool.length), 1)[0]);
      }
      return finish(picked, { ...s, rng });
    }
    if (!answer) {
      return {
        s,
        ask: {
          decision: decision({ seat, kind: "chooseObjects", purpose: "discard", prompt: `Discard ${n} card${n === 1 ? "" : "s"}`, candidates: hand.slice(), min: n, max: n, default: { objects: hand.slice(0, n) }, hiddenFromOthers: true }),
          data: idsData(hand),
        },
      };
    }
    const picked = pickObjects(answer, dataIds(data), n, n);
    return typeof picked === "string" ? picked : finish(picked);
  },

  mill(s0, ev, ctx, a) {
    const seat = seatOf(s0, ctx, a.player);
    if (seat === null) return { s: s0 };
    const [s, moved] = moveAll(s0, ev, topOfLibrary(s0, seat, numberOf(s0, ctx, a.amount)), "graveyard");
    return { s, bind: bindAs(a, asRefs(moved)) };
  },

  reveal(s, ev, ctx, a) {
    const ids = a.top !== undefined ? topOfLibrary(s, seatOf(s, ctx, a.player) ?? ctx.controller, numberOf(s, ctx, a.top)) : liveIds(s, objectsArg(s, ctx, a));
    ev.push({ type: "reveal", seat: ctx.controller, objects: ids });
    return { s, bind: bindAs(a, asRefs(ids)) };
  },

  look(s, ev, ctx, a) {
    const ids = a.top !== undefined ? topOfLibrary(s, seatOf(s, ctx, a.player) ?? ctx.controller, numberOf(s, ctx, a.top)) : liveIds(s, objectsArg(s, ctx, a));
    ev.push({ type: "look", seat: ctx.controller, objects: ids });
    return { s, bind: bindAs(a, asRefs(ids)) };
  },

  search(s, ev, ctx, a, answer, data) {
    const lib = seatOf(s, ctx, a.player) ?? ctx.controller;
    const zone = a.zone ?? "library";
    const pool = (zone === "library" ? s.zones.library[lib] : zone === "graveyard" ? s.zones.graveyard[lib] : s.zones.hand[lib]) ?? [];
    const candidates = pool.filter((id) => matches(s, ctx, { o: id }, a.select));
    const max = a.count !== undefined && typeof a.count === "number" ? a.count : a.max !== undefined ? numberOf(s, ctx, a.max) : 1;
    // 701.23b: a search for cards with a stated quality may find fewer, even none.
    const min = 0;
    const finish = (ids: ObjectId[]): Out => {
      ev.push({ type: "searched", seat: ctx.controller, library: lib, found: ids.length });
      if (a.reveal && ids.length) ev.push({ type: "reveal", seat: ctx.controller, objects: ids });
      return { s, bind: bindAs(a, asRefs(ids)) };
    };
    if (!answer) {
      if (candidates.length === 0) return finish([]);
      return {
        s,
        ask: {
          decision: decision({ seat: ctx.controller, kind: "chooseObjects", purpose: "search", prompt: `Search for up to ${max}`, candidates, min, max: Math.min(max, candidates.length), default: { objects: candidates.slice(0, Math.min(max, candidates.length)) }, hiddenFromOthers: true }),
          data: idsData(candidates),
        },
      };
    }
    const picked = pickObjects(answer, dataIds(data), min, max);
    return typeof picked === "string" ? picked : finish(picked);
  },

  shuffle(s, ev, ctx, a) {
    const seat = seatOf(s, ctx, a.player);
    if (seat === null) return { s };
    const [order, rng] = shuffled(s.zones.library[seat], s.rng);
    ev.push({ type: "shuffle", seat });
    return { s: { ...s, rng, zones: { ...s.zones, library: { ...s.zones.library, [seat]: order } } } };
  },

  scry(s, ev, ctx, a, answer, data) {
    return arrange(s, ev, seatOf(s, ctx, a.player) ?? ctx.controller, numberOf(s, ctx, a.amount), answer, data, "library", "scry");
  },

  surveil(s, ev, ctx, a, answer, data) {
    return arrange(s, ev, seatOf(s, ctx, a.player) ?? ctx.controller, numberOf(s, ctx, a.amount), answer, data, "graveyard", "surveil");
  },

  putOnTop(s, ev, ctx, a) {
    return { s: putOnTop(s, ev, liveIds(s, objectsArg(s, ctx, a))) };
  },

  putOnBottom(s0, ev, ctx, a) {
    let ids = liveIds(s0, objectsArg(s0, ctx, a));
    let s = s0;
    if (a.random) {
      let rng;
      [ids, rng] = shuffled(ids, s.rng);
      s = { ...s, rng };
    }
    return { s: putOnBottom(s, ev, ids) };
  },

  // ---- moving
  move(s0, ev, ctx, a) {
    const controller = a.underControlOf !== undefined ? seatOf(s0, ctx, a.underControlOf) ?? ctx.controller : undefined;
    const ids = liveIds(s0, objectsArg(s0, ctx, a));
    const [s, moved] = moveAll(s0, ev, ids, a.to, { tapped: !!a.tapped, faceDown: !!a.faceDown, bottom: a.position === "bottom", ...(controller !== undefined ? { controller } : {}) });
    return { s, bind: bindAs(a, asRefs(moved)) };
  },

  destroy(s0, ev, ctx, a) {
    // 702.12b: indestructible permanents can't be destroyed.
    const ids = onField(s0, objectsArg(s0, ctx, a)).filter((id) => !hasKeyword(s0, id, "indestructible"));
    const [s, moved] = moveAll(s0, ev, ids, "graveyard");
    return { s, bind: bindAs(a, asRefs(moved)) };
  },

  exile(s0, ev, ctx, a) {
    const [s, moved] = moveAll(s0, ev, liveIds(s0, objectsArg(s0, ctx, a)), "exile", { faceDown: !!a.faceDown });
    return { s, bind: bindAs(a, asRefs(moved)) };
  },

  sacrifice(s, ev, ctx, a, answer, data) {
    const finish = (ids: ObjectId[]): Out => {
      const [s1, moved] = moveAll(s, ev, ids, "graveyard");
      return { s: s1, bind: bindAs(a, asRefs(moved)) };
    };
    if (a.select === undefined) {
      // "Sacrifice [this]": only a permanent its controller controls can be sacrificed (701.21a).
      return finish(onField(s, objectsArg(s, ctx, a)));
    }
    const seat = seatOf(s, ctx, a.player) ?? ctx.controller;
    const candidates = s.zones.battlefield.filter((id) => chars(s, id).controller === seat && matches(s, { ...ctx, controller: seat }, { o: id }, a.select));
    const { min, max } = chooseCount(s, ctx, { count: a.count ?? 1 }, candidates.length);
    if (candidates.length <= max) return finish(candidates);
    if (!answer) {
      return {
        s,
        ask: {
          decision: decision({ seat, kind: "chooseObjects", purpose: "sacrifice", prompt: `Sacrifice ${max}`, candidates, min, max, default: { objects: candidates.slice(0, max) } }),
          data: idsData(candidates),
        },
      };
    }
    const picked = pickObjects(answer, dataIds(data), min, max);
    return typeof picked === "string" ? picked : finish(picked);
  },

  bounce(s0, ev, ctx, a) {
    return { s: moveAll(s0, ev, onField(s0, objectsArg(s0, ctx, a)), "hand")[0] };
  },

  returnToBattlefield(s0, ev, ctx, a) {
    const controller = a.underControlOf !== undefined ? seatOf(s0, ctx, a.underControlOf) ?? undefined : undefined;
    const ids = liveIds(s0, objectsArg(s0, ctx, a)).filter((id) => obj(s0, id).zone !== "battlefield" && obj(s0, id).zone !== "stack");
    const [s, moved] = moveAll(s0, ev, ids, "battlefield", { tapped: !!a.tapped, ...(controller !== undefined ? { controller } : {}) });
    return { s, bind: bindAs(a, asRefs(moved)) };
  },

  counter(s0, ev, ctx, a) {
    let s = s0;
    for (const id of liveIds(s, objectsArg(s, ctx, a))) {
      const o = obj(s, id);
      if (o.zone !== "stack") continue;
      if (cantBeCountered(o)) {
        ev.push({ type: "cantBeCountered", object: id });
        continue;
      }
      ev.push({ type: "countered", object: id });
      s = leaveStack(s, ev, id, "graveyard"); // 701.6a
    }
    return { s };
  },

  // ---- making
  createToken(s0, ev, ctx, a) {
    let s = s0;
    const t = tokenScript(s, ctx, a.token);
    if (!t) return { s };
    const seat = seatOf(s, ctx, a.controller) ?? ctx.controller;
    const n = a.count === undefined ? 1 : numberOf(s, ctx, a.count);
    const out: ObjectId[] = [];
    for (let i = 0; i < n; i++) {
      let id: ObjectId;
      [s, id] = createObject(s, ev, tokenDef(t), seat, { tapped: !!a.tapped, token: true });
      out.push(id);
    }
    return { s, bind: bindAs(a, asRefs(out)) };
  },

  // ---- numbers
  gainLife(s, ev, ctx, a) {
    const n = numberOf(s, ctx, a.amount);
    let s1 = s;
    for (const seat of a.players !== undefined ? seatsOf(s, ctx, a.players) : [seatOf(s, ctx, a.player)].filter((x): x is Seat => x !== null)) s1 = gainLife(s1, ev, seat, n);
    return { s: s1 };
  },

  loseLife(s0, ev, ctx, a) {
    let s = s0;
    const n = numberOf(s, ctx, a.amount);
    let total = 0;
    const seats = a.players !== undefined ? seatsOf(s, ctx, a.players) : [seatOf(s, ctx, a.player)].filter((x): x is Seat => x !== null);
    for (const seat of seats) {
      if (n <= 0 || s.seats[seat].lost) continue;
      s = setSeat(s, seat, { life: s.seats[seat].life - n });
      ev.push({ type: "lifeLoss", seat, amount: n });
      total += n;
    }
    return { s, bind: bindAs(a, total) };
  },

  dealDamage(s0, ev, ctx, a) {
    let s = s0;
    const source = a.source !== undefined ? objIds(refsOf(s, ctx, a.source))[0] ?? ctx.self : ctx.self;
    const recipients = refsOf(s, ctx, a.to);
    // 601.2d: divided damage uses the amounts chosen while casting, matched to each target.
    const divided = a.divided ? dividedAmounts(ctx, a.to) : null;
    for (const r of recipients) {
      const n = divided ? divided.get(refKey(r)) ?? 0 : numberOf(s, ctx, a.amount);
      [s] = dealDamage(s, ev, source, r, n);
    }
    return { s };
  },

  addCounters(s0, ev, ctx, a) {
    let s = s0;
    const n = a.amount === undefined ? 1 : numberOf(s, ctx, a.amount);
    if (n <= 0) return { s };
    for (const r of refsOf(s, ctx, a.on)) {
      if ("p" in r) {
        if (a.kind === "poison") s = setSeat(s, r.p, { poison: s.seats[r.p].poison + n });
        ev.push({ type: "counters", object: null, seat: r.p, kind: a.kind, amount: n });
        continue;
      }
      const o = maybeObj(s, r.o);
      if (!o || o.zone !== "battlefield") continue;
      s = setObj(s, { ...o, counters: { ...o.counters, [a.kind]: (o.counters[a.kind] ?? 0) + n } });
      ev.push({ type: "counters", object: o.id, kind: a.kind, amount: n });
    }
    return { s };
  },

  removeCounters(s0, ev, ctx, a) {
    let s = s0;
    for (const id of onField(s, refsOf(s, ctx, a.on))) {
      const o = obj(s, id);
      const counters = { ...o.counters };
      for (const kind of a.kind === "all" ? Object.keys(counters) : [a.kind]) {
        const have = counters[kind] ?? 0;
        const n = a.amount === undefined || a.kind === "all" ? have : Math.min(have, numberOf(s, ctx, a.amount));
        if (n <= 0) continue;
        counters[kind] = have - n;
        if (counters[kind] === 0) delete counters[kind];
        ev.push({ type: "counters", object: id, kind, amount: -n });
      }
      s = setObj(s, { ...o, counters });
    }
    return { s };
  },

  addMana(s, ev, ctx, a, answer) {
    const seat = seatOf(s, ctx, a.player) ?? ctx.controller;
    let bundle: ManaType[];
    if (typeof a.mana === "string") bundle = bundleOf(a.mana);
    else {
      const colors: ManaType[] = a.mana.anyColor !== undefined ? COLORS : a.mana.oneOf;
      const n = a.mana.anyColor !== undefined ? numberOf(s, ctx, a.mana.anyColor) : a.mana.amount === undefined ? 1 : numberOf(s, ctx, a.mana.amount);
      if (!answer) {
        return {
          s,
          ask: { decision: decision({ seat, kind: "chooseColor", prompt: "Choose a color of mana", options: [], default: { color: colors[0] } }), data: colors as unknown as Val },
        };
      }
      if (!("color" in answer) || !colors.includes(answer.color)) return `choose one of ${colors.join(", ")}`;
      bundle = Array<ManaType>(n).fill(answer.color);
    }
    for (const m of new Set(bundle)) ev.push({ type: "manaAdded", seat, mana: m, amount: bundle.filter((x) => x === m).length });
    return { s: setSeat(s, seat, { pool: addToPool(s.seats[seat].pool, bundle) }) };
  },

  payLife(s, ev, ctx, a) {
    const seat = seatOf(s, ctx, a.player) ?? ctx.controller;
    const n = numberOf(s, ctx, a.amount);
    // 119.4: you can pay life only if your life total is at least that much.
    if (s.seats[seat].life < n) return { s, bind: bindAs(a, false) };
    ev.push({ type: "lifeLoss", seat, amount: n });
    return { s: setSeat(s, seat, { life: s.seats[seat].life - n }), bind: bindAs(a, true) };
  },

  // ---- state
  fight(s0, ev, ctx, a) {
    let s = s0;
    const x = one(refsOf(s, ctx, a.object));
    const y = one(refsOf(s, ctx, a.with));
    if (!x || !y || !isObjRef(x) || !isObjRef(y)) return { s };
    // 701.14b: if either creature isn't on the battlefield (or isn't a creature), no damage is dealt.
    const ok = (id: ObjectId) => maybeObj(s, id)?.zone === "battlefield" && chars(s, id).types.includes("Creature");
    if (!ok(x.o) || !ok(y.o)) return { s };
    const px = chars(s, x.o).power ?? 0;
    const py = chars(s, y.o).power ?? 0;
    [s] = dealDamage(s, ev, x.o, y, px);
    [s] = dealDamage(s, ev, y.o, x, py);
    return { s };
  },

  tap(s0, ev, ctx, a) {
    let s = s0;
    for (const id of onField(s, objectsArg(s, ctx, a))) s = setTapped(s, ev, id, true);
    return { s };
  },

  untap(s0, ev, ctx, a) {
    let s = s0;
    for (const id of onField(s, objectsArg(s, ctx, a))) s = setTapped(s, ev, id, false);
    return { s };
  },

  attach(s, ev, ctx, a) {
    const what = onField(s, refsOf(s, ctx, a.object))[0];
    const to = onField(s, refsOf(s, ctx, a.to))[0];
    if (what === undefined || to === undefined || what === to) return { s };
    const o = obj(s, what);
    if (o.attachedTo === to) return { s };
    ev.push({ type: "attached", object: what, to });
    // 701.3a: attaching gives it a new timestamp (613.7e).
    return { s: { ...setObj(s, { ...o, attachedTo: to, timestamp: s.nextTimestamp }), nextTimestamp: s.nextTimestamp + 1 } };
  },

  transform(s0, ev, ctx, a) {
    let s = s0;
    for (const id of onField(s, objectsArg(s, ctx, a))) {
      const o = obj(s, id);
      if (o.def.layout !== "transform") continue; // 701.28c: only a transforming double-faced permanent transforms
      const upFace = o.status.upFace === 0 ? 1 : 0;
      s = { ...setObj(s, { ...o, status: { ...o.status, upFace, transformed: upFace === 1 }, timestamp: s.nextTimestamp }), nextTimestamp: s.nextTimestamp + 1 };
      ev.push({ type: "transformed", object: id, face: upFace });
    }
    return { s };
  },

  // ---- game
  winGame(s0, ev, ctx, a) {
    let s = s0;
    const winner = seatOf(s, ctx, a.player);
    if (winner === null || s.seats[winner].lost) return { s };
    // 104.2a, 104.3h: in multiplayer, "you win the game" makes every opponent lose.
    for (const seat of apnap(s)) if (seat !== winner && !s.over) s = eliminate(s, ev, seat, `${charsOf(s, ctx.self)?.name ?? "an effect"} won the game for seat ${winner}`);
    return { s };
  },

  loseGame(s, ev, ctx, a) {
    const seat = seatOf(s, ctx, a.player);
    if (seat === null || s.seats[seat].lost) return { s };
    return { s: eliminate(s, ev, seat, `${charsOf(s, ctx.self)?.name ?? "an effect"} (104.3e)`) };
  },

  extraTurn(s, ev, ctx, a) {
    const seat = seatOf(s, ctx, a.player);
    if (seat === null) return { s };
    ev.push({ type: "extraTurn", seat });
    return { s: { ...s, gameMemory: { ...s.gameMemory, extraTurns: [seat, ...s.gameMemory.extraTurns] } } };
  },

  // ---- choices
  may(s, ev, ctx, a, answer) {
    const seat = seatOf(s, ctx, a.player) ?? ctx.controller;
    if (!answer) {
      return {
        s,
        ask: {
          decision: decision({ seat, kind: "yesNo", purpose: "may", prompt: a.prompt ?? "Do it?", default: { yes: false } }),
          data: null,
        },
      };
    }
    if (!("yes" in answer)) return "answer yes or no";
    return { s, push: answer.yes ? a.do : [], bind: bindAs(a, answer.yes) };
  },

  unless(s0, ev, ctx, a, answer) {
    const seat = seatOf(s0, ctx, a.player);
    if (seat === null) return { s: s0, push: a.then };
    if (!answer) {
      const able = canPay(s0, seat, a.pay);
      return {
        s: s0,
        ask: {
          decision: decision({ seat, kind: "payOrNot", purpose: "unless", prompt: `Pay ${typeof a.pay === "string" ? a.pay : "the cost"}?`, default: { pay: "decline" }, options: [] }),
          data: able,
        },
      };
    }
    if (!("pay" in answer) || (answer.pay !== "auto" && answer.pay !== "decline")) return "pay (auto) or decline";
    if (answer.pay === "decline") return { s: s0, push: a.then, bind: bindAs(a, false) };
    const paid = payCostNow(s0, ev, seat, a.pay);
    if (!paid) return "can't pay that";
    return { s: paid, bind: bindAs(a, true) };
  },

  choose(s, ev, ctx, a, answer, data) {
    const seat = seatOf(s, ctx, a.player) ?? ctx.controller;
    if (a.opponent) {
      const opps = apnap(s).filter((p) => p !== ctx.controller);
      if (opps.length <= 1) return { s, bind: { [a.as]: opps.map((p) => ({ p })) } };
      if (!answer) return { s, ask: { decision: decision({ seat, kind: "chooseOpponent", prompt: "Choose an opponent", default: { player: opps[0] } }), data: opps.map((p) => ({ p })) } };
      if (!("player" in answer) || !opps.includes(answer.player)) return "choose an opponent";
      return { s, bind: { [a.as]: [{ p: answer.player }] } };
    }
    if (a.number !== undefined) {
      const min = typeof a.number === "object" ? numberOf(s, ctx, a.number.min ?? 0) : 0;
      const max = typeof a.number === "object" ? numberOf(s, ctx, a.number.max ?? 99) : numberOf(s, ctx, a.number);
      if (!answer) return { s, ask: { decision: decision({ seat, kind: "chooseNumber", prompt: `Choose a number from ${min} to ${max}`, min, max, default: { number: min } }), data: null } };
      if (!("number" in answer) || !Number.isInteger(answer.number) || answer.number < min || answer.number > max) return `choose a whole number from ${min} to ${max}`;
      return { s, bind: { [a.as]: answer.number } };
    }
    if (a.color) {
      if (!answer) return { s, ask: { decision: decision({ seat, kind: "chooseColor", prompt: "Choose a color", default: { color: "W" } }), data: null } };
      if (!("color" in answer) || !COLORS.includes(answer.color as never)) return "choose a color";
      return { s, bind: { [a.as]: answer.color } };
    }
    const candidates = a.from !== undefined ? liveIds(s, refsOf(s, ctx, a.from)) : liveIds(s, selectAll(s, ctx, a.select));
    const { min, max } = chooseCount(s, ctx, a, candidates.length);
    if (!answer) {
      if (max === 0) return { s, bind: { [a.as]: [] } };
      if (min === candidates.length && max === candidates.length && !a.ordered) return { s, bind: { [a.as]: asRefs(candidates) } };
      return {
        s,
        ask: {
          decision: decision({ seat, kind: "chooseObjects", purpose: "choose", prompt: a.prompt ?? `Choose ${min === max ? min : `${min} to ${max}`}`, candidates, min, max, ordered: !!a.ordered, default: { objects: candidates.slice(0, min) }, hiddenFromOthers: true }),
          data: idsData(candidates),
        },
      };
    }
    const picked = pickObjects(answer, dataIds(data), min, max);
    return typeof picked === "string" ? picked : { s, bind: { [a.as]: asRefs(picked) } };
  },

  splitPiles(s, ev, ctx, a, answer, data) {
    const seat = seatOf(s, ctx, a.player) ?? ctx.controller;
    const ids = liveIds(s, refsOf(s, ctx, a.objects));
    if (!answer) {
      return {
        s,
        ask: { decision: decision({ seat, kind: "splitPiles", prompt: "Separate these cards into two piles", candidates: ids, default: { piles: [ids, []] } }), data: idsData(ids) },
      };
    }
    if (!("piles" in answer) || answer.piles.length !== 2) return "make two piles (one may be empty)";
    const all = answer.piles.flat();
    const seen = dataIds(data);
    if (all.length !== seen.length || new Set(all).size !== all.length || !all.every((id) => seen.includes(id))) return "every card goes in exactly one pile";
    return { s, bind: { [a.as]: answer.piles.map((p) => asRefs(p)) } };
  },

  choosePile(s, ev, ctx, a, answer) {
    const seat = seatOf(s, ctx, a.player) ?? ctx.controller;
    const v = typeof a.from === "string" ? ctx.vars[a.from.slice(1)] : undefined;
    const piles = (Array.isArray(v) && v.length && Array.isArray(v[0]) ? v : [v ?? [], []]) as Ref[][];
    if (!answer) return { s, ask: { decision: decision({ seat, kind: "choosePile", prompt: "Choose a pile", default: { pile: 0 } }), data: null } };
    if (!("pile" in answer) || !Number.isInteger(answer.pile) || answer.pile < 0 || answer.pile >= piles.length) return "choose pile 0 or 1";
    const bind: Record<string, Val> = { [a.as]: piles[answer.pile] };
    if (a.other) bind[a.other] = piles.filter((_, i) => i !== answer.pile).flat();
    return { s, bind };
  },

  // ---- control flow
  forEach(s, ev, ctx, a) {
    const as = a.as ?? "each";
    const items: Ref[] = a.player !== undefined ? seatsOf(s, ctx, a.player).map((p) => ({ p })) : a.select !== undefined ? selectAll(s, ctx, a.select) : refsOf(s, ctx, a.over);
    const push: Step[] = [];
    for (const it of items) push.push({ __bind: { [as]: [it] } } as unknown as Step, ...(a.do as Step[]));
    return { s, push };
  },
};

// forEach binds its variable with an internal step; it never appears in scripts (the schema refuses it).
HANDLERS.__bind = (s, ev, ctx, a) => ({ s, bind: a as Record<string, Val> });
BLOCK_BY_NAME.__bind = { name: "__bind", group: "structure", rule: "", runs: "now", core: false, fields: {} };

function dividedAmounts(ctx: EvalCtx & { r: Resolution }, to: Json): Map<string, number> {
  const out = new Map<string, number>();
  const id = typeof to === "string" && to.startsWith("$") ? to.slice(1) : "";
  const amounts = ctx.r.divide[id] ?? [];
  // the amounts were stored in the order the targets were chosen; targets that became illegal are gone
  const chosen = (ctx.r as Resolution & { chosen?: Record<string, Ref[]> }).chosen?.[id] ?? valRefs(ctx.vars[id]);
  chosen.forEach((r, i) => out.set(refKey(r), amounts[i] ?? 0));
  return out;
}

export function newResolution(p: Omit<Resolution, "todo" | "vars" | "moved" | "waiting"> & { effect: Step[]; vars?: Record<string, Val>; chosen?: Record<string, Ref[]> }): Resolution {
  const { effect, vars, ...rest } = p;
  return { ...rest, todo: effect.map((step) => ({ step })), vars: vars ?? {}, moved: {}, waiting: null };
}
