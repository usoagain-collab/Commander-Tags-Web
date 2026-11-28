// Card tests (engine-cards/<xx>/<oracle id>.test.json): a small table, a list of moves, and what must be
// true after. The runner builds the table straight from the setup (no shuffling, no opening hands), plays
// every move through `step`, checks the invariants after each one, and reports every check that failed.
// It is test tooling: the engine never imports it.
/* eslint-disable @typescript-eslint/no-explicit-any -- the test files are JSON */

import { chars } from "../chars";
import { step } from "../engine";
import { checkInvariants } from "../invariants";
import { pmapGet } from "../pmap";
import { activatedAbilitiesOf } from "./abilities";
import { createGame } from "../setup";
import { moveObject, setObj, setSeat } from "../state";
import type { Action, CardDef, Choice, GameEvent, GameObject, GameState, ObjectId, Ref, Seat } from "../types";

export type CardTests = { card: string; tests: Scenario[] };
export type Scenario = { name: string; pending?: string; setup: Setup; do?: Move[]; expect?: Check[] };
type Entry = string | { card: string; tapped?: boolean; sick?: boolean; counters?: Record<string, number>; face?: number; attachedTo?: string; onAdventure?: boolean };
type SeatSetup = { hand?: Entry[]; battlefield?: Entry[]; graveyard?: Entry[]; exile?: Entry[]; library?: Entry[]; life?: number };
type Setup = { seats: SeatSetup[]; active?: Seat; seed?: number };
type Move = Record<string, any>;
type Check = Record<string, any>;

/** Every card a test can name: the scripted cards plus plain test cards (basics, vanilla creatures). */
export type CardPool = Map<string, CardDef>;

export function cardPool(defs: CardDef[]): CardPool {
  const pool: CardPool = new Map();
  for (const d of defs) {
    pool.set(d.faces.map((f) => f.name).join(" // "), d);
    pool.set(d.faces[0].name, d);
  }
  return pool;
}

const nameOf = (o: GameObject) => o.def.faces.map((f) => f.name);
const named = (o: GameObject, n: string) => nameOf(o).includes(n) || nameOf(o).join(" // ") === n;

export type RunResult = { failures: string[]; state: GameState; events: GameEvent[] };

export function runScenario(pool: CardPool, sc: Scenario): RunResult {
  const failures: string[] = [];
  let s: GameState;
  try {
    s = build(pool, sc.setup);
  } catch (e) {
    return { failures: [`setup: ${(e as Error).message}`], state: null as unknown as GameState, events: [] };
  }
  const events: GameEvent[] = [];
  const moves = sc.do ?? [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const where = `move ${i + 1} ${JSON.stringify(m)}`;
    try {
      if (m.check) {
        failures.push(...check(s, events, m.check, where));
        continue;
      }
      s = play(s, m, events, failures, where);
    } catch (e) {
      failures.push(`${where}: ${(e as Error).message}`);
      return { failures, state: s, events };
    }
  }
  failures.push(...check(s, events, sc.expect ?? [], "expect"));
  return { failures, state: s, events };
}

// ---------------------------------------------------------------- building the table

function build(pool: CardPool, setup: Setup): GameState {
  const seats = setup.seats;
  const card = (e: Entry) => {
    const n = typeof e === "string" ? e : e.card;
    const d = pool.get(n);
    if (!d) throw new Error(`no card named "${n}"`);
    return d;
  };
  const zones = ["hand", "battlefield", "graveyard", "exile", "library"] as const;
  const plan = seats.map((st) => zones.flatMap((z) => (st[z] ?? (z === "library" ? Array(10).fill("Island") : [])).map((e: Entry) => ({ z, e }))));
  let s = createGame({
    seed: setup.seed ?? 1,
    seats: plan.map((list) => ({ deck: list.map((x) => card(x.e)) })),
    firstSeat: setup.active ?? 0,
    libraryOrder: "asListed",
    table: { startingHand: 0 },
  }).state;
  const ev: GameEvent[] = [];
  const placed: { seat: Seat; id: ObjectId; e: Entry }[] = [];
  plan.forEach((list, seat) => {
    // asListed: the deck's first card is on top, so ids run from the top of the library down
    const ids = s.zones.library[seat].slice().reverse();
    list.forEach((x, i) => {
      if (x.z === "library") return;
      const opts: Exclude<typeof x.e, string> = typeof x.e === "string" ? { card: x.e } : x.e;
      let id: ObjectId;
      [s, id] = moveObject(s, ev, ids[i], x.z, { controller: seat, tapped: !!opts.tapped, upFace: opts.face ?? 0, onAdventure: !!opts.onAdventure });
      const o = pmapGet(s.objects, id)!;
      s = setObj(s, { ...o, summoningSick: !!opts.sick && x.z === "battlefield", counters: { ...o.counters, ...(opts.counters ?? {}) }, ...(opts.face ? { status: { ...o.status, transformed: o.def.layout === "transform" } } : {}) });
      placed.push({ seat, id, e: x.e });
    });
    if (seats[seat].life !== undefined) s = setSeat(s, seat, { life: seats[seat].life! });
  });
  for (const p of placed) {
    if (typeof p.e === "string" || !p.e.attachedTo) continue;
    const to = s.zones.battlefield.find((id) => named(pmapGet(s.objects, id)!, (p.e as { attachedTo: string }).attachedTo));
    if (to === undefined) throw new Error(`nothing named ${p.e.attachedTo} to attach to`);
    s = setObj(s, { ...pmapGet(s.objects, p.id)!, attachedTo: to });
  }
  // everyone passes until the active player's first main phase
  const active = setup.active ?? 0;
  for (let i = 0; i < 50 && !(s.turn.activeSeat === active && s.turn.step === "main1" && s.pendingDecision?.kind === "priority"); i++) {
    s = step(s, s.pendingDecision!.seat, { kind: "pass" }).state;
  }
  if (s.turn.step !== "main1") throw new Error("couldn't reach the first main phase");
  return s;
}

// ---------------------------------------------------------------- moves

function find(s: GameState, name: string, seat: Seat, zonesToLook: string[]): ObjectId {
  const [n, at] = name.split("@");
  const owner = at === undefined ? seat : Number(at);
  for (const z of zonesToLook) {
    const ids = z === "battlefield" || z === "stack" || z === "exile" ? s.zones[z] : (s.zones as any)[z][owner] ?? [];
    for (const id of ids) {
      const o = pmapGet(s.objects, id)!;
      const mine = z === "battlefield" ? o.controller === owner : o.owner === owner;
      if (mine && named(o, n)) return id;
    }
  }
  throw new Error(`can't find ${name} (seat ${owner}) in ${zonesToLook.join("/")}`);
}

function ref(s: GameState, name: string, pool: Ref[], used: Set<string>, seat: Seat): Ref {
  if (name.startsWith("player:")) return { p: Number(name.slice(7)) };
  const [n, at] = name.split("@");
  for (const r of pool) {
    if (!("o" in r) || used.has(`o${r.o}`)) continue;
    const o = pmapGet(s.objects, r.o);
    if (!o || !named(o, n)) continue;
    if (at !== undefined && o.owner !== Number(at)) continue;
    used.add(`o${r.o}`);
    return r;
  }
  throw new Error(`${name} isn't among the choices (seat ${seat})`);
}

function idsFor(s: GameState, names: string[], candidates: ObjectId[]): ObjectId[] {
  const used = new Set<string>();
  return names.map((n) => (ref(s, n, candidates.map((o) => ({ o })), used, 0) as { o: number }).o);
}

function answerOf(s: GameState, m: Move): Choice | null {
  const d = s.pendingDecision!;
  if ("targets" in m) {
    const used = new Set<string>();
    return { targets: (m.targets as string[]).map((n) => ref(s, n, d.refs ?? [], used, d.seat)) };
  }
  if ("choose" in m) return { objects: idsFor(s, m.choose, d.candidates ?? []) };
  if ("modes" in m) return { modes: m.modes };
  if ("x" in m) return { number: m.x };
  if ("number" in m) return { number: m.number };
  if ("yes" in m) return { yes: m.yes };
  if ("pay" in m) return { pay: m.pay };
  if ("divide" in m) return { amounts: m.divide };
  if ("piles" in m) return { piles: (m.piles as string[][]).map((p) => idsFor(s, p, d.candidates ?? [])) };
  if ("pile" in m) return { pile: m.pile };
  if ("arrange" in m) return { top: idsFor(s, m.arrange.top ?? [], d.candidates ?? []), bottom: idsFor(s, m.arrange.bottom ?? [], d.candidates ?? []) };
  if ("color" in m) return { color: m.color };
  if ("player" in m) return { player: m.player };
  if ("cancel" in m) return { cancel: true };
  if ("default" in m) return d.default ?? null;
  return null;
}

function actionOf(s: GameState, m: Move, seat: Seat): Action | null {
  if ("cast" in m) return { kind: "cast", object: find(s, m.cast, seat, ["hand", "graveyard", "exile"]), ...(m.face !== undefined ? { face: m.face } : {}), ...(m.via ? { via: m.via } : {}) };
  if ("play" in m) return { kind: "playLand", object: find(s, m.play, seat, ["hand"]), ...(m.face !== undefined ? { face: m.face } : {}) };
  if ("activate" in m) return { kind: "activate", object: find(s, m.activate, seat, ["battlefield", "hand", "graveyard"]), ability: m.ability ?? 0 };
  if ("mana" in m) return { kind: "activateMana", object: find(s, m.mana, seat, ["battlefield"]), ability: m.ability ?? 0, ...(m.color ? { color: m.color } : {}) };
  if ("pass" in m) return { kind: "pass" };
  if ("concede" in m) return { kind: "concede" };
  return null;
}

function send(s: GameState, seat: Seat, action: Action, events: GameEvent[], where: string): GameState {
  const r = step(s, seat, action);
  if (r.error) throw new Error(`refused: ${r.error}`);
  events.push(...r.events);
  const bad = checkInvariants(r.state);
  if (bad.length) throw new Error(`invariants: ${bad.join("; ")} (${where})`);
  return r.state;
}

function play(s0: GameState, m: Move, events: GameEvent[], failures: string[], where: string): GameState {
  let s = s0;
  const d = s.pendingDecision;
  if (!d) throw new Error("nothing is pending (the game is over?)");
  const seat: Seat = m.seat ?? d.seat;

  if (m.refused) {
    const inner = m.refused as Move;
    const action = actionOf(s, inner, seat) ?? { kind: "answer" as const, decision: d.id, choice: answerOf(s, inner)! };
    const r = step(s, seat, action);
    if (!r.error) failures.push(`${where}: expected a refusal, but it was accepted`);
    else if (m.match && !new RegExp(m.match, "i").test(r.error)) failures.push(`${where}: refused with "${r.error}", expected /${m.match}/`);
    if (r.state !== s) failures.push(`${where}: a refused action changed the state`);
    return s;
  }

  if (m.resolve) {
    // everyone passes until the top of the stack resolves (or something asks a question)
    const n = s.zones.stack.length;
    if (n === 0) throw new Error("the stack is empty");
    for (let i = 0; i < 20 && s.zones.stack.length >= n && s.pendingDecision?.kind === "priority"; i++) s = send(s, s.pendingDecision.seat, { kind: "pass" }, events, where);
    return s;
  }

  if (m.passTo) {
    const want = m.passTo as { seat: Seat; step: string };
    for (let i = 0; i < 200; i++) {
      const p = s.pendingDecision;
      if (!p || (s.turn.activeSeat === want.seat && s.turn.step === want.step && p.kind === "priority")) break;
      if (p.kind === "chooseObjects" && p.purpose === "discard" && !s.resolving) s = send(s, p.seat, { kind: "answer", decision: p.id, choice: p.default ?? { objects: (p.candidates ?? []).slice(0, p.min) } }, events, where);
      else if (p.kind === "priority") s = send(s, p.seat, { kind: "pass" }, events, where);
      else throw new Error(`passTo stopped at a ${p.kind} decision`);
    }
    return s;
  }

  const action = actionOf(s, m, seat);
  if (action) s = send(s, seat, action, events, where);
  else {
    const choice = answerOf(s, m);
    if (!choice) throw new Error("unknown move");
    s = send(s, d.seat, { kind: "answer", decision: d.id, choice }, events, where);
  }
  // a cast that reaches payment pays automatically unless the move says hold
  if (!m.hold && s.pendingDecision?.kind === "payCost") s = send(s, s.pendingDecision.seat, { kind: "answer", decision: s.pendingDecision.id, choice: { pay: "auto" } }, events, where);
  return s;
}

// ---------------------------------------------------------------- checks

function check(s: GameState, events: GameEvent[], checks: Check[], where: string): string[] {
  const out: string[] = [];
  const fail = (c: Check, msg: string) => out.push(`${where} ${JSON.stringify(c)}: ${msg}`);
  const objsIn = (zone: string, seat: Seat | undefined): GameObject[] => {
    const ids: ObjectId[] =
      zone === "battlefield" || zone === "stack" || zone === "exile" || zone === "command"
        ? (s.zones as any)[zone]
        : seat === undefined
          ? s.seatOrder.flatMap((x) => (s.zones as any)[zone][x] ?? [])
          : (s.zones as any)[zone][seat] ?? [];
    return ids.map((id) => pmapGet(s.objects, id)!).filter((o) => seat === undefined || zone === "stack" || (zone === "battlefield" ? o.controller === seat : o.owner === seat));
  };
  const one = (c: Check, name: string): GameObject | null => {
    const [n, at] = name.split("@");
    const all = (["battlefield", "stack", "exile", "hand", "graveyard", "library", "command"] as const).flatMap((z) => objsIn(z, at === undefined ? undefined : Number(at)));
    const o = all.find((x) => named(x, n));
    if (!o) fail(c, `${name} isn't anywhere`);
    return o ?? null;
  };
  for (const c of checks) {
    if (c.zone) {
      const objs = objsIn(c.zone, c.seat);
      for (const n of c.has ?? []) if (!objs.some((o) => named(o, n))) fail(c, `${n} isn't there (has ${objs.map((o) => o.def.faces[0].name).join(", ") || "nothing"})`);
      for (const n of c.lacks ?? []) if (objs.some((o) => named(o, n))) fail(c, `${n} is there`);
      if (c.count !== undefined && objs.length !== c.count) fail(c, `${objs.length} objects, not ${c.count}`);
    } else if (c.life !== undefined) {
      const lives = s.seatOrder.map((x) => s.seats[x].life);
      if (Array.isArray(c.life)) {
        if (JSON.stringify(lives) !== JSON.stringify(c.life)) fail(c, `life is ${JSON.stringify(lives)}`);
      } else if (s.seats[c.seat ?? 0].life !== c.life) fail(c, `life is ${s.seats[c.seat ?? 0].life}`);
    } else if (c.handSize !== undefined) {
      const n = s.zones.hand[c.seat ?? 0].length;
      if (n !== c.handSize) fail(c, `hand has ${n}`);
    } else if (c.librarySize !== undefined) {
      const n = s.zones.library[c.seat ?? 0].length;
      if (n !== c.librarySize) fail(c, `library has ${n}`);
    } else if (c.tapped !== undefined) {
      const o = one(c, c.tapped);
      if (o && o.status.tapped !== (c.is ?? true)) fail(c, `tapped is ${o.status.tapped}`);
    } else if (c.counters !== undefined) {
      const o = one(c, c.counters);
      if (o && (o.counters[c.kind] ?? 0) !== c.is) fail(c, `${o.counters[c.kind] ?? 0} ${c.kind} counters`);
    } else if (c.pool !== undefined) {
      const p = s.seats[c.seat ?? 0].pool;
      for (const [k, v] of Object.entries(c.pool)) if (p[k as keyof typeof p] !== v) fail(c, `pool is ${JSON.stringify(p)}`);
    } else if (c.decision !== undefined) {
      const d = s.pendingDecision;
      if (c.decision === null ? d !== null : d?.kind !== c.decision) fail(c, `pending is ${d?.kind ?? "nothing"}`);
      else if (d && c.seat !== undefined && d.seat !== c.seat) fail(c, `asked of seat ${d.seat}`);
      if (d && c.purpose && d.purpose !== c.purpose) fail(c, `purpose is ${d.purpose}`);
    } else if (c.choices !== undefined || c.notChoices !== undefined) {
      const d = s.pendingDecision;
      const refs: Ref[] = [...(d?.refs ?? []), ...(d?.candidates ?? []).map((o) => ({ o }))];
      const label = (r: Ref) => ("p" in r ? `player:${r.p}` : pmapGet(s.objects, r.o) ? nameOf(pmapGet(s.objects, r.o)!) : []);
      const has = (n: string) => refs.some((r) => ("p" in r ? `player:${r.p}` === n : (label(r) as string[]).includes(n.split("@")[0])));
      for (const n of c.choices ?? []) if (!has(n)) fail(c, `${n} isn't offered`);
      for (const n of c.notChoices ?? []) if (has(n)) fail(c, `${n} is offered`);
      if (c.count !== undefined && refs.length !== c.count) fail(c, `${refs.length} choices offered`);
    } else if (c.keywords !== undefined) {
      const o = one(c, c.keywords);
      if (o) {
        const k = chars(s, o.id).keywords.map((x) => x.keyword);
        for (const n of c.has ?? []) if (!k.includes(n)) fail(c, `no ${n} (has ${k.join(", ")})`);
        for (const n of c.lacks ?? []) if (k.includes(n)) fail(c, `has ${n}`);
      }
    } else if (c.chars !== undefined) {
      const o = one(c, c.chars);
      if (o) {
        const ch = chars(s, o.id) as any;
        for (const k of ["power", "toughness", "name", "manaValue", "controller"]) if (k in c && ch[k] !== c[k]) fail(c, `${k} is ${ch[k]}`);
        for (const t of c.types ?? []) if (!ch.types.includes(t)) fail(c, `isn't a ${t} (${ch.types.join(" ")})`);
      }
    } else if (c.damage !== undefined) {
      const o = one(c, c.damage);
      if (o && o.damage !== c.is) fail(c, `damage is ${o.damage}`);
    } else if (c.attached !== undefined) {
      const o = one(c, c.attached);
      if (o) {
        if (c.to === null) {
          if (o.attachedTo !== null) fail(c, "is attached");
        } else {
          const host = typeof o.attachedTo === "number" ? pmapGet(s.objects, o.attachedTo) : undefined;
          if (!host || !named(host, c.to)) fail(c, `attached to ${host ? host.def.faces[0].name : "nothing"}`);
        }
      }
    } else if (c.lost !== undefined) {
      const lost = s.seatOrder.filter((x) => s.seats[x].lost);
      if (JSON.stringify(lost) !== JSON.stringify(c.lost)) fail(c, `lost: ${JSON.stringify(lost)}`);
    } else if (c.winner !== undefined) {
      if (s.winner !== c.winner || !s.over) fail(c, `winner ${s.winner}, over ${s.over}`);
    } else if (c.turn !== undefined) {
      if (c.turn.seat !== undefined && s.turn.activeSeat !== c.turn.seat) fail(c, `active seat ${s.turn.activeSeat}`);
      if (c.turn.number !== undefined && s.turn.number !== c.turn.number) fail(c, `turn ${s.turn.number}`);
      if (c.turn.step !== undefined && s.turn.step !== c.turn.step) fail(c, `step ${s.turn.step}`);
    } else if (c.top !== undefined) {
      const lib = s.zones.library[c.seat ?? 0];
      const top = (c.top as string[]).map((_, i) => pmapGet(s.objects, lib[lib.length - 1 - i]));
      (c.top as string[]).forEach((n, i) => {
        if (!top[i] || !named(top[i]!, n)) fail(c, `card ${i + 1} from the top is ${top[i]?.def.faces[0].name ?? "nothing"}`);
      });
    } else if (c.bottom !== undefined) {
      const lib = s.zones.library[c.seat ?? 0];
      const o = pmapGet(s.objects, lib[0]);
      if (!o || !named(o, c.bottom)) fail(c, `bottom card is ${o?.def.faces[0].name ?? "nothing"}`);
    } else if (c.event !== undefined) {
      const hits = events.filter((e) => e.type === c.event && (c.block === undefined || (e as any).block === c.block));
      if (c.times !== undefined ? hits.length !== c.times : hits.length === 0) fail(c, `${hits.length} ${c.event} events`);
    } else if (c.noEvent !== undefined) {
      if (events.some((e) => e.type === c.noEvent)) fail(c, `there was a ${c.noEvent} event`);
    } else if (c.stack !== undefined) {
      if (s.zones.stack.length !== c.stack) fail(c, `stack has ${s.zones.stack.length}`);
    } else if (c.face !== undefined) {
      const o = one(c, c.face);
      if (o && o.status.upFace !== c.is) fail(c, `face ${o.status.upFace}`);
    } else if (c.activations !== undefined) {
      const o = one(c, c.activations);
      if (o && activatedAbilitiesOf(o).length !== c.is) fail(c, `${activatedAbilitiesOf(o).length} activated abilities`);
    } else if (c.legal !== undefined) {
      // an action is (or isn't) among the priority options
      const d = s.pendingDecision;
      const kinds = (d?.options ?? []).filter((a) => a.kind === c.legal.kind && (!("object" in a) || pmapGet(s.objects, (a as { object: number }).object)?.def.faces.some((f) => f.name === c.legal.card)) && (c.legal.via === undefined || (a as { via?: string }).via === c.legal.via));
      if ((c.is ?? true) !== kinds.length > 0) fail(c, `${kinds.length} matching options`);
    } else fail(c, "unknown check");
  }
  return out;
}
