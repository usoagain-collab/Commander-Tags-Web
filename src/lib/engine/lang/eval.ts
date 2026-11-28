// Working out a script's references, selectors, numbers and conditions against a game state
// (docs/card-language.md, "Building blocks"). Everything reads derived characteristics through `chars`,
// and falls back to last known information (LKI) for an object that has already changed zones.
/* eslint-disable @typescript-eslint/no-explicit-any -- scripts are checked by validate.ts before they get here */

import { chars } from "../chars";
import { pmapGet } from "../pmap";
import { living, maybeObj } from "../state";
import type { Characteristics, GameState, ObjectId, Seat } from "../types";
import type { Json, Ref, Val } from "./script-types";

export type EvalCtx = {
  controller: Seat;
  self: ObjectId;
  vars: Record<string, Val>;
  x: number;
  castWith: string[];
  moved?: Record<number, number>;
};

export const refKey = (r: Ref) => ("o" in r ? `o${r.o}` : `p${r.p}`);
export const isObjRef = (r: Ref): r is { o: number } => "o" in r;
export const objIds = (refs: Ref[]) => refs.filter(isObjRef).map((r) => r.o);
export const seatRefs = (refs: Ref[]) => refs.filter((r): r is { p: number } => "p" in r).map((r) => r.p);

/** Characteristics now, or the last known ones if the object left its zone (608.2h, 113.7a). */
export function charsOf(s: GameState, id: ObjectId): Characteristics | null {
  if (maybeObj(s, id)) return chars(s, id);
  return pmapGet(s.lki, id) ?? null;
}

const lower = (x: unknown): string[] => (Array.isArray(x) ? x : [x]).map((w) => String(w).toLowerCase());
const COLOR_CODE: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G", W: "W", U: "U", B: "B", R: "R", G: "G" };

function relation(s: GameState, ctx: EvalCtx, seat: Seat, rel: string): boolean {
  switch (rel) {
    case "you":
      return seat === ctx.controller;
    case "opponent":
    case "notYou":
      return seat !== ctx.controller;
    case "any":
    case "each":
      return true;
    default:
      if (rel.startsWith("$")) return seatOf(s, ctx, rel) === seat;
      return false;
  }
}

function compareNum(s: GameState, ctx: EvalCtx, value: number | null, spec: any): boolean {
  if (value === null) return false;
  if (typeof spec === "object" && spec !== null && !Array.isArray(spec) && Object.keys(spec).some((k) => /[<>=!]/.test(k))) {
    return Object.entries(spec).every(([op, n]) => cmp(value, op, numberOf(s, ctx, n as Json)));
  }
  return value === numberOf(s, ctx, spec);
}

export function cmp(a: number, op: string, b: number): boolean {
  switch (op) {
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    case "==":
      return a === b;
    case "!=":
      return a !== b;
  }
  return false;
}

// ---------------------------------------------------------------- selectors

/** Does `ref` match the selector, from the point of view of `ctx.controller`? */
export function matches(s: GameState, ctx: EvalCtx, ref: Ref, sel: any): boolean {
  if (!sel || typeof sel !== "object") return false;
  if ("p" in ref) return matchesPlayer(s, ctx, ref.p, sel);
  const o = maybeObj(s, ref.o);
  if (!o) return false;
  const c = chars(s, ref.o);
  for (const [k, v] of Object.entries(sel)) {
    switch (k) {
      case "type":
        if (!lower(v).some((t) => c.types.some((x) => x.toLowerCase() === t))) return false;
        break;
      case "subtype":
        if (!lower(v).some((t) => c.subtypes.some((x) => x.toLowerCase() === t))) return false;
        break;
      case "supertype":
        if (!lower(v).some((t) => c.supertypes.some((x) => x.toLowerCase() === t))) return false;
        break;
      case "color": {
        const ok = (Array.isArray(v) ? v : [v]).some((col: string) => {
          if (col === "colorless") return c.colors.length === 0;
          if (col === "multicolored") return c.colors.length > 1;
          if (col === "monocolored") return c.colors.length === 1;
          return c.colors.includes(COLOR_CODE[col] as never);
        });
        if (!ok) return false;
        break;
      }
      case "controller": {
        const ctrl = o.zone === "battlefield" || o.zone === "stack" ? c.controller : o.owner;
        if (!relation(s, ctx, ctrl, v as string)) return false;
        break;
      }
      case "owner":
        if (!relation(s, ctx, o.owner, v as string)) return false;
        break;
      case "player":
        return false;
      case "zone":
        if (o.zone !== v) return false;
        break;
      case "kind":
        if (!kindMatches(o, v as string)) return false;
        break;
      case "name":
        if (!lower(v).includes(c.name.toLowerCase())) return false;
        break;
      case "manaValue":
        if (!compareNum(s, ctx, c.manaValue, v)) return false;
        break;
      case "power":
        if (!compareNum(s, ctx, c.power, v)) return false;
        break;
      case "toughness":
        if (!compareNum(s, ctx, c.toughness, v)) return false;
        break;
      case "tapped":
        if (o.status.tapped !== v) return false;
        break;
      case "other":
        if ((ref.o !== ctx.self) !== v) return false;
        break;
      case "self":
        if ((ref.o === ctx.self) !== v) return false;
        break;
      case "not":
        if (matches(s, ctx, ref, v)) return false;
        break;
      case "anyOf":
        if (!(v as any[]).some((x) => matches(s, ctx, ref, x))) return false;
        break;
      case "allOf":
        if (!(v as any[]).every((x) => matches(s, ctx, ref, x))) return false;
        break;
      case "with": {
        const w = v as { keyword?: string; counter?: string };
        if (w.keyword && !c.keywords.some((x) => x.keyword === w.keyword)) return false;
        if (w.counter && !((o.counters[w.counter] ?? 0) > 0)) return false;
        break;
      }
      case "attachedTo": {
        const to = objIds(refsOf(s, ctx, v as Json));
        if (typeof o.attachedTo !== "number" || !to.includes(o.attachedTo)) return false;
        break;
      }
      case "is":
        if (!objIds(refsOf(s, ctx, v as Json)).includes(ref.o)) return false;
        break;
      case "linked":
        return false; // linked abilities arrive with triggers (PR 4a)
    }
  }
  return true;
}

function kindMatches(o: NonNullable<ReturnType<typeof maybeObj>>, kind: string): boolean {
  switch (kind) {
    case "permanent":
      return o.zone === "battlefield";
    case "card":
      return !o.isToken && !o.ability && o.zone !== "stack" && o.zone !== "battlefield";
    case "spell":
      return o.zone === "stack" && !o.ability;
    case "ability":
      return o.zone === "stack" && !!o.ability;
    case "token":
      return !!o.isToken;
    case "nontoken":
      return !o.isToken;
    default:
      return false;
  }
}

function matchesPlayer(s: GameState, ctx: EvalCtx, seat: Seat, sel: any): boolean {
  if (s.seats[seat]?.lost) return false;
  for (const [k, v] of Object.entries(sel)) {
    switch (k) {
      case "kind":
        if (v !== "player") return false;
        break;
      case "player":
        if (!relation(s, ctx, seat, v as string)) return false;
        break;
      case "not":
        if (matchesPlayer(s, ctx, seat, v)) return false;
        break;
      case "anyOf":
        if (!(v as any[]).some((x) => matchesPlayer(s, ctx, seat, x))) return false;
        break;
      case "allOf":
        if (!(v as any[]).every((x) => matchesPlayer(s, ctx, seat, x))) return false;
        break;
      default:
        return false; // object-only fields never match a player
    }
  }
  return "kind" in sel || "player" in sel || "anyOf" in sel || "allOf" in sel;
}

/** Everything a selector matches, in a stable order (players in turn order, then objects by zone). */
export function selectAll(s: GameState, ctx: EvalCtx, sel: any): Ref[] {
  const seen = new Set<string>();
  const out: Ref[] = [];
  for (const r of candidatesFor(s, ctx, sel)) {
    const k = refKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    if (matches(s, ctx, r, sel)) out.push(r);
  }
  return out;
}

function candidatesFor(s: GameState, ctx: EvalCtx, sel: any): Ref[] {
  if (!sel || typeof sel !== "object") return [];
  if (sel.is !== undefined) return refsOf(s, ctx, sel.is);
  const branches: any[] = [...(sel.anyOf ?? []), ...(sel.allOf ? [sel.allOf[0]] : [])];
  if (branches.length && !sel.zone && !sel.kind && !sel.player) return branches.flatMap((b) => candidatesFor(s, ctx, b));
  if (sel.kind === "player" || sel.player) return living(s).map((p) => ({ p }));
  const z = s.zones;
  const all = (ids: ObjectId[]) => ids.map((o) => ({ o }));
  const perSeat = (zone: "library" | "hand" | "graveyard") => s.seatOrder.flatMap((seat) => all(z[zone][seat] ?? []));
  const zone: string | undefined = sel.zone ?? (sel.kind === "spell" || sel.kind === "ability" ? "stack" : sel.kind === "card" ? undefined : "battlefield");
  switch (zone) {
    case "library":
    case "hand":
    case "graveyard":
      return perSeat(zone);
    case "stack":
      return all(z.stack);
    case "exile":
      return all(z.exile);
    case "command":
      return all(z.command);
    case undefined:
      return [...perSeat("graveyard"), ...perSeat("hand"), ...perSeat("library"), ...all(z.exile), ...all(z.command)];
    default:
      return all(z.battlefield);
  }
}

// ---------------------------------------------------------------- object references

export function refsOf(s: GameState, ctx: EvalCtx, expr: Json | undefined): Ref[] {
  if (expr === undefined || expr === null) return [];
  if (typeof expr === "string") {
    if (expr === "self" || expr === "it") return [{ o: ctx.self }];
    if (expr.startsWith("$")) return valRefs(ctx.vars[expr.slice(1)]);
    return [];
  }
  if (Array.isArray(expr)) return expr.flatMap((e) => refsOf(s, ctx, e));
  if (typeof expr !== "object") return [];
  const e = expr as Record<string, any>;
  if ("select" in e) return selectAll(s, ctx, e.select);
  if ("minus" in e) {
    const [first, ...rest] = e.minus as Json[];
    const drop = new Set(rest.flatMap((r) => refsOf(s, ctx, r)).map(refKey));
    return refsOf(s, ctx, first).filter((r) => !drop.has(refKey(r)));
  }
  if ("union" in e) {
    const seen = new Set<string>();
    return (e.union as Json[]).flatMap((r) => refsOf(s, ctx, r)).filter((r) => (seen.has(refKey(r)) ? false : (seen.add(refKey(r)), true)));
  }
  if ("topOf" in e) {
    const seat = seatOf(s, ctx, e.topOf.library ?? "you");
    if (seat === null) return [];
    const n = e.topOf.count === undefined ? 1 : numberOf(s, ctx, e.topOf.count);
    return topOfLibrary(s, seat, n).map((o) => ({ o }));
  }
  if ("follow" in e) {
    const zone = e.to ?? e.in;
    return objIds(refsOf(s, ctx, e.follow))
      .map((id) => followId(ctx, id))
      .filter((id) => {
        const o = maybeObj(s, id);
        return o && (!zone || o.zone === zone);
      })
      .map((o) => ({ o }));
  }
  if ("attachedTo" in e) {
    return objIds(refsOf(s, ctx, e.attachedTo))
      .map((id) => maybeObj(s, id)?.attachedTo)
      .filter((x): x is number => typeof x === "number")
      .map((o) => ({ o }));
  }
  if ("first" in e) return refsOf(s, ctx, e.first).slice(0, 1);
  return [];
}

function followId(ctx: EvalCtx, id: number): number {
  let cur = id;
  for (let guard = 0; guard < 50 && ctx.moved?.[cur] !== undefined; guard++) cur = ctx.moved[cur];
  return cur;
}

export function valRefs(v: Val | undefined): Ref[] {
  if (!Array.isArray(v)) return [];
  if (v.length && Array.isArray(v[0])) return (v as Ref[][]).flat();
  return v as Ref[];
}

/** The top `n` cards of a library, top first. */
export function topOfLibrary(s: GameState, seat: Seat, n: number): ObjectId[] {
  const lib = s.zones.library[seat] ?? [];
  return lib.slice(Math.max(0, lib.length - n)).reverse();
}

// ---------------------------------------------------------------- players

export function seatOf(s: GameState, ctx: EvalCtx, expr: Json | undefined): Seat | null {
  if (expr === undefined || expr === "you") return ctx.controller;
  if (expr === "active") return s.turn.activeSeat;
  if (typeof expr === "string" && expr.startsWith("$")) {
    const refs = valRefs(ctx.vars[expr.slice(1)]);
    const r = refs[0];
    if (!r) return null;
    if ("p" in r) return r.p;
    return charsOf(s, r.o)?.controller ?? null;
  }
  if (expr && typeof expr === "object" && !Array.isArray(expr)) {
    const e = expr as Record<string, Json>;
    if ("controllerOf" in e) {
      const r = refsOf(s, ctx, e.controllerOf)[0];
      if (!r) return null;
      if ("p" in r) return r.p;
      const o = maybeObj(s, r.o);
      if (o && o.zone !== "battlefield" && o.zone !== "stack") return o.owner;
      return charsOf(s, r.o)?.controller ?? null;
    }
    if ("ownerOf" in e) {
      const r = refsOf(s, ctx, e.ownerOf)[0];
      if (!r) return null;
      if ("p" in r) return r.p;
      return maybeObj(s, r.o)?.owner ?? null;
    }
  }
  return null;
}

/** A set of players, in turn order starting with the active player (APNAP, 101.4). */
export function seatsOf(s: GameState, ctx: EvalCtx, expr: Json | undefined): Seat[] {
  const order = apnap(s);
  if (expr === "each") return order;
  if (expr === "opponent" || expr === "opponents" || expr === "others") return order.filter((p) => p !== ctx.controller);
  if (Array.isArray(expr)) return expr.flatMap((e) => seatsOf(s, ctx, e));
  const one = seatOf(s, ctx, expr);
  return one === null || s.seats[one]?.lost ? [] : [one];
}

export function apnap(s: GameState): Seat[] {
  const live = living(s);
  const start = s.seatOrder.indexOf(s.turn.activeSeat);
  const order = [...s.seatOrder.slice(start), ...s.seatOrder.slice(0, start)];
  return order.filter((p) => live.includes(p));
}

// ---------------------------------------------------------------- numbers

export function numberOf(s: GameState, ctx: EvalCtx, expr: Json | undefined): number {
  if (expr === undefined || expr === null) return 0;
  if (typeof expr === "number") return expr;
  if (typeof expr === "boolean") return expr ? 1 : 0;
  if (typeof expr === "string") {
    const v = expr.startsWith("$") ? ctx.vars[expr.slice(1)] : undefined;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    return valRefs(v).length;
  }
  if (Array.isArray(expr)) return 0;
  const e = expr as Record<string, any>;
  const key = Object.keys(e).find((k) => k !== "lki")!;
  const arg = e[key];
  const firstChars = () => {
    const r = refsOf(s, ctx, arg).find(isObjRef);
    return r ? charsOf(s, r.o) : null;
  };
  switch (key) {
    case "count":
      return countOf(s, ctx, arg);
    case "devotion":
      return devotion(s, ctx.controller, COLOR_CODE[arg] ?? arg);
    case "x":
      return ctx.x;
    case "power":
      return firstChars()?.power ?? 0;
    case "toughness":
      return firstChars()?.toughness ?? 0;
    case "manaValue":
      return firstChars()?.manaValue ?? 0;
    case "add":
      return (arg as Json[]).reduce((n: number, x) => n + numberOf(s, ctx, x), 0);
    case "times":
      return (arg as Json[]).reduce((n: number, x) => n * numberOf(s, ctx, x), 1);
    case "minus": {
      const [a, ...rest] = (arg as Json[]).map((x) => numberOf(s, ctx, x));
      return rest.reduce((n, x) => n - x, a);
    }
    case "min":
      return Math.min(...(arg as Json[]).map((x) => numberOf(s, ctx, x)));
    case "max":
      return Math.max(...(arg as Json[]).map((x) => numberOf(s, ctx, x)));
    case "librarySize": {
      const seat = seatOf(s, ctx, arg);
      return seat === null ? 0 : s.zones.library[seat]?.length ?? 0;
    }
    case "handSize": {
      const seat = seatOf(s, ctx, arg);
      return seat === null ? 0 : s.zones.hand[seat]?.length ?? 0;
    }
    case "life": {
      const seat = seatOf(s, ctx, arg);
      return seat === null ? 0 : s.seats[seat].life;
    }
    case "counters":
      return objIds(refsOf(s, ctx, arg.on)).reduce((n, id) => n + (maybeObj(s, id)?.counters[arg.kind] ?? 0), 0);
    case "spellsCast": {
      const seat = seatOf(s, ctx, arg);
      return seat === null ? 0 : s.turnMemory.spellsCast[seat] ?? 0;
    }
  }
  return 0;
}

function countOf(s: GameState, ctx: EvalCtx, arg: any): number {
  if (typeof arg === "string" || Array.isArray(arg)) return refsOf(s, ctx, arg).length;
  if (arg && typeof arg === "object" && ["minus", "union", "select", "topOf", "follow", "attachedTo", "first"].some((k) => k in arg)) return refsOf(s, ctx, arg).length;
  return selectAll(s, ctx, arg).length;
}

/** 700.5: devotion to a color = mana symbols of that color (hybrid counts) in the costs of permanents you control. */
export function devotion(s: GameState, seat: Seat, color: string): number {
  let n = 0;
  for (const id of s.zones.battlefield) {
    const c = chars(s, id);
    if (c.controller !== seat || !c.manaCost) continue;
    for (const m of c.manaCost.matchAll(/\{([^}]+)\}/g)) if (m[1].split("/").includes(color)) n++;
  }
  return n;
}

// ---------------------------------------------------------------- conditions

export function test(s: GameState, ctx: EvalCtx, cond: Json | undefined): boolean {
  if (cond === undefined) return true;
  if (typeof cond === "string") {
    const v = ctx.vars[cond.slice(1)];
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v > 0;
    return valRefs(v).length > 0;
  }
  const e = cond as Record<string, any>;
  const [k] = Object.keys(e);
  const arg = e[k];
  switch (k) {
    case "compare":
      return cmp(numberOf(s, ctx, arg[0]), arg[1], numberOf(s, ctx, arg[2]));
    case "exists":
      return selectAll(s, ctx, arg).length > 0;
    case "zoneOf": {
      const r = refsOf(s, ctx, arg.object).find(isObjRef);
      return !!r && maybeObj(s, r.o)?.zone === arg.is;
    }
    case "castWith":
      return ctx.castWith.includes(arg);
    case "isTurnOf":
      return seatOf(s, ctx, arg) === s.turn.activeSeat;
    case "and":
      return (arg as Json[]).every((c) => test(s, ctx, c));
    case "or":
      return (arg as Json[]).some((c) => test(s, ctx, c));
    case "not":
      return !test(s, ctx, arg);
  }
  return false;
}
