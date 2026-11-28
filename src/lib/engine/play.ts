// Casting spells (601.2) and activating abilities (602.2), one decision at a time, with mana abilities
// (605) and the mana sources auto-pay may tap. Every choice made while casting can be undone: when a cast
// can't finish, the game goes back to the checkpoint taken before it began (733).
//
// Order of choices, as 601.2b-h lays it out: modes, then kicker (an optional additional cost) and X, then
// targets and how to divide, then the objects that pay non-mana costs, then the mana. Costs are paid at the
// end, all together (601.2h).
/* eslint-disable @typescript-eslint/no-explicit-any -- scripts are checked by validate.ts before they get here */

import { castableFaces } from "./cards";
import { chars, hasKeyword } from "./chars";
import { addGeneric, costWithX, isFreeCost, parseCost, payFromPool, planAutoPay, poolTotal, type ManaSource } from "./mana";
import { pmapSet } from "./pmap";
import { activatedAbilitiesOf, costAbilities, costParts, faceKeyword, manaAbilitiesOf, manaPart, spellAbility, type Activatable, type CostPart } from "./lang/abilities";
import { charsOf, matches, numberOf, refKey, selectAll, test, valRefs, type EvalCtx } from "./lang/eval";
import { protectedFrom, tapPlan } from "./lang/run";
import type { Json, Step } from "./lang/script-types";
import { freshStatus, maybeObj, moveObject, nextDecisionId, obj, setObj, setSeat, setTapped } from "./state";
import type { Action, CastInProgress, Choice, Decision, GameEvent, GameObject, GameState, ManaType, ObjectId, Ref, Seat } from "./types";

const isMain = (s: GameState) => s.turn.step === "main1" || s.turn.step === "main2";
const sorceryTime = (s: GameState, seat: Seat) => s.turn.activeSeat === seat && isMain(s) && s.zones.stack.length === 0;

// ---------------------------------------------------------------- mana sources and mana abilities

/** Can this permanent pay a {T} or {Q} cost now? (302.6: a creature needs haste or to have been there since the turn began.) */
export function canTapForCost(s: GameState, id: ObjectId): boolean {
  const o = obj(s, id);
  if (!chars(s, id).types.includes("Creature")) return true;
  return !o.summoningSick || hasKeyword(s, id, "haste");
}

const tapOnly = (parts: CostPart[]) => parts.length > 0 && parts.every((p) => "tap" in p);

/**
 * What auto-pay may tap for the seat: untapped permanents with mana abilities whose only cost is {T}
 * (it never sacrifices a Treasure on its own). With `convoke`, untapped creatures can be tapped too.
 */
export function manaSources(s: GameState, seat: Seat, convoke = false, except: ObjectId[] = []): ManaSource[] {
  const out: ManaSource[] = [];
  for (const id of s.zones.battlefield) {
    const o = obj(s, id);
    if (o.controller !== seat || o.status.tapped || except.includes(id)) continue;
    const c = chars(s, id);
    const options = canTapForCost(s, id)
      ? manaAbilitiesOf(o, c.subtypes)
          .filter((m) => tapOnly(m.parts))
          .flatMap((m) => m.options.map((bundle) => ({ ability: m.index, bundle })))
      : [];
    const src: ManaSource = { object: id, options };
    if (convoke && c.types.includes("Creature")) src.convoke = c.colors.slice();
    if (options.length || src.convoke) out.push(src);
  }
  return out;
}

/** Mana abilities the seat can activate right now, one action per color it can choose. */
export function manaActions(s: GameState, seat: Seat): Action[] {
  const out: Action[] = [];
  for (const id of s.zones.battlefield) {
    const o = obj(s, id);
    if (o.controller !== seat) continue;
    for (const m of manaAbilitiesOf(o, chars(s, id).subtypes)) {
      if (manaCostRefusal(s, id, m.parts)) continue;
      const colors = [...new Set(m.options.map((b) => b[0]))];
      if (m.options.length > 1) for (const color of colors) out.push({ kind: "activateMana", object: id, ability: m.index, color });
      else out.push({ kind: "activateMana", object: id, ability: m.index });
    }
  }
  return out;
}

function manaCostRefusal(s: GameState, id: ObjectId, parts: CostPart[]): string | null {
  const o = obj(s, id);
  for (const p of parts) {
    if ("tap" in p && (o.status.tapped || !canTapForCost(s, id))) return o.status.tapped ? "it's already tapped" : "it arrived this turn (no haste)";
    if ("untap" in p && !o.status.tapped) return "it isn't tapped";
    if ("mana" in p) return "not yet: mana abilities that cost mana";
    if ("sacrifice" in p && (p.sacrifice as any).object !== "self") return "not yet: mana abilities that sacrifice another permanent";
    if ("payLife" in p) return "not yet: mana abilities that cost life";
  }
  return null;
}

/** Activates a mana ability (605.3: it resolves at once, without the stack). A string is a refusal. */
export function activateManaAbility(s0: GameState, ev: GameEvent[], seat: Seat, id: ObjectId, ability: number, color?: ManaType): GameState | string {
  const o = maybeObj(s0, id);
  if (!o || o.zone !== "battlefield") return "that isn't on the battlefield";
  if (o.controller !== seat) return "you don't control that";
  const m = manaAbilitiesOf(o, chars(s0, id).subtypes).find((x) => x.index === ability);
  if (!m) return "no such mana ability";
  const why = manaCostRefusal(s0, id, m.parts);
  if (why) return why;
  let bundle = m.options[0];
  if (m.options.length > 1) {
    const pick = m.options.find((b) => b[0] === color);
    if (!pick) return `choose a color: ${[...new Set(m.options.map((b) => b[0]))].join(", ")}`;
    bundle = pick;
  }
  let s = s0;
  for (const p of m.parts) {
    if ("tap" in p) s = setTapped(s, ev, id, true);
    if ("untap" in p) s = setTapped(s, ev, id, false);
  }
  s = tapPlan(s, ev, seat, [{ object: id, ability, bundle }].map((x) => ({ ...x }))); // adds the mana
  // tapPlan taps too, which is harmless when {T} was already paid; a sacrifice-only ability untaps nothing
  if (m.parts.some((p) => "sacrifice" in p)) [s] = moveObject(s, ev, id, "graveyard");
  return s;
}

// ---------------------------------------------------------------- what can be cast and activated

/** The ways a card can be cast now (601.3), as actions. Payment isn't checked: an unpayable cast rolls back. */
export function castActions(s: GameState, seat: Seat): Action[] {
  const out: Action[] = [];
  const tryCast = (id: ObjectId, face: number, via?: string) => {
    if (!castRefusal(s, seat, id, face, via)) out.push({ kind: "cast", object: id, face, ...(via ? { via } : {}) });
  };
  for (const id of s.zones.hand[seat] ?? []) {
    const o = obj(s, id);
    for (const face of castableFaces(o.def)) {
      tryCast(id, face);
      if (faceKeyword(o, face, "overload")) tryCast(id, face, "overload");
      for (const c of costAbilities(o, face)) if (c.alternative !== undefined && typeof c.name === "string") tryCast(id, face, c.name);
    }
  }
  for (const id of s.zones.graveyard[seat] ?? []) {
    const o = obj(s, id);
    for (const face of castableFaces(o.def)) if (faceKeyword(o, face, "flashback")) tryCast(id, face, "flashback");
  }
  for (const id of s.zones.exile) {
    const o = obj(s, id);
    if (o.onAdventure && o.owner === seat) tryCast(id, 0);
  }
  return out;
}

export function castRefusal(s: GameState, seat: Seat, id: ObjectId, face?: number, via?: string): string | null {
  const o = maybeObj(s, id);
  if (!o) return "no such card";
  const faces = castableFaces(o.def);
  if (faces.length === 0) return "that card can't be cast";
  if (face !== undefined && !faces.includes(face)) return "that face can't be cast";
  if (face === undefined && faces.length > 1) return "choose which face to cast";
  const fi = face ?? faces[0];
  // Where it can be cast from (601.3).
  if (via === "flashback") {
    if (o.zone !== "graveyard" || o.owner !== seat) return "flashback casts a card from your graveyard";
    if (!faceKeyword(o, fi, "flashback")) return "that card has no flashback";
  } else if (o.zone === "exile") {
    if (!o.onAdventure || o.owner !== seat || fi !== 0) return "that card can't be cast from exile";
  } else if (o.zone !== "hand" || o.owner !== seat) return "that card isn't in your hand";
  if (via === "overload" && !faceKeyword(o, fi, "overload")) return "that card has no overload";
  if (via && via !== "flashback" && via !== "overload") {
    const alt = costAbilities(o, fi).find((c) => c.name === via && c.alternative !== undefined);
    if (!alt) return `that card has no alternative cost "${via}"`;
    if (alt.if !== undefined && !test(s, { controller: seat, self: id, vars: {}, x: 0, castWith: [via] }, alt.if as Json)) return `you can't use "${via}" now`;
  }
  const f = o.def.faces[fi];
  if (!via && f.manaCost === null) return "a card with no mana cost can't be cast without another way to pay";
  const cost = parseCost(f.manaCost);
  if (cost.unsupported.length) return `not yet: costs with ${cost.unsupported.join(" ")}`;
  const instant = f.types.includes("Instant") || !!faceKeyword(o, fi, "flash");
  // 307.1, 702.8a: sorcery timing unless it's an instant or has flash.
  if (!instant && !sorceryTime(s, seat)) return "that can only be cast in your main phase with an empty stack";
  return null;
}

/** Activated abilities the seat could start activating, as actions (602.1). */
export function activateActions(s: GameState, seat: Seat): Action[] {
  const out: Action[] = [];
  const ids = [...s.zones.battlefield, ...(s.zones.hand[seat] ?? []), ...(s.zones.graveyard[seat] ?? [])];
  for (const id of ids) {
    const o = obj(s, id);
    activatedAbilitiesOf(o).forEach((_, ability) => {
      if (!activateRefusal(s, seat, id, ability)) out.push({ kind: "activate", object: id, ability });
    });
  }
  return out;
}

export function activateRefusal(s: GameState, seat: Seat, id: ObjectId, ability: number): string | null {
  const o = maybeObj(s, id);
  if (!o) return "no such object";
  const a = activatedAbilitiesOf(o)[ability];
  if (!a) return "no such ability";
  if (a.zone !== o.zone) return a.zone === "hand" ? "that ability works from your hand" : `that ability works on the ${a.zone}`;
  if (o.zone === "battlefield" ? o.controller !== seat : o.owner !== seat) return "you don't control that";
  if (a.sorcery && !sorceryTime(s, seat)) return "that can only be activated in your main phase with an empty stack";
  if (a.kind === "loyalty") {
    if (s.turnMemory.loyaltyUsed.includes(id)) return "this planeswalker already used a loyalty ability this turn (606.3)";
    if ((a.loyalty ?? 0) < 0 && (o.counters.loyalty ?? 0) < -(a.loyalty ?? 0)) return "not enough loyalty";
  }
  if (a.oncePerTurn && s.turnMemory.activated.includes(`${o.cardId}:${a.face}:${a.index}`)) return "only once each turn";
  for (const p of a.parts) {
    if ("tap" in p && (o.status.tapped || !canTapForCost(s, id))) return o.status.tapped ? "it's already tapped" : "it arrived this turn (no haste)";
    if ("untap" in p && !o.status.tapped) return "it isn't tapped";
    if ("removeCounters" in p) {
      const r = p.removeCounters as any;
      if ((o.counters[r.kind] ?? 0) < (typeof r.amount === "number" ? r.amount : 1)) return `not enough ${r.kind} counters`;
    }
    if ("tapCreatures" in p) {
      const need = Number((p.tapCreatures as any).power ?? 0);
      const total = crewCandidates(s, seat, id).reduce((n, c) => n + Math.max(0, chars(s, c).power ?? 0), 0);
      if (total < need) return `crew needs untapped creatures with total power ${need}`;
    }
  }
  return null;
}

const crewCandidates = (s: GameState, seat: Seat, self: ObjectId) =>
  s.zones.battlefield.filter((id) => id !== self && obj(s, id).controller === seat && !obj(s, id).status.tapped && chars(s, id).types.includes("Creature"));

// ---------------------------------------------------------------- beginning a cast or an activation

export function beginCast(s0: GameState, ev: GameEvent[], seat: Seat, id: ObjectId, face: number, via?: string): GameState {
  const o = obj(s0, id);
  // 601.2a: the card moves to the stack. Its upFace says which face is being cast (712.8f).
  const [s, spell] = moveObject({ ...s0, pendingDecision: null }, ev, id, "stack", {
    controller: seat,
    upFace: o.def.layout === "modal_dfc" ? face : 0,
    castInfo: { face, fromZone: o.zone, turn: s0.turn.number, ...(via ? { via } : {}) },
  });
  const casting: CastInProgress = { kind: "spell", object: spell, seat, cost: "", checkpoint: s0, face, targets: {}, divide: {}, ...(via ? { via } : {}) };
  return nextCastStep({ ...s, casting }, ev);
}

export function beginActivation(s0: GameState, ev: GameEvent[], seat: Seat, id: ObjectId, ability: number): GameState {
  const src = obj(s0, id);
  const a = activatedAbilitiesOf(src)[ability];
  // 602.2a: the ability is created on the stack. It isn't a card; it has its source's text (113.7).
  const abilityId = s0.nextObjectId;
  const o: GameObject = {
    id: abilityId,
    cardId: src.cardId,
    def: src.def,
    owner: seat,
    controller: seat,
    zone: "stack",
    status: freshStatus(src.status.upFace),
    counters: {},
    damage: 0,
    deathtouchHit: false,
    summoningSick: false,
    attachedTo: null,
    timestamp: s0.nextTimestamp,
    ability: { source: id, sourceCard: src.cardId, face: a.face, index: a.index },
  };
  const s: GameState = {
    ...s0,
    pendingDecision: null,
    nextObjectId: abilityId + 1,
    nextTimestamp: s0.nextTimestamp + 1,
    objects: pmapSet(s0.objects, abilityId, o),
    zones: { ...s0.zones, stack: [...s0.zones.stack, abilityId] },
  };
  const casting: CastInProgress = { kind: "ability", object: abilityId, seat, cost: "", checkpoint: s0, face: a.face, targets: {}, divide: {} };
  return nextCastStep({ ...s, casting }, ev);
}

// ---------------------------------------------------------------- what the spell or ability needs

type TargetSpec = { id: string; select: any; min: number; max: number; divide?: number; differentFrom?: Json; prompt?: string };

/** The activated ability behind a stack ability, from its source's script. */
export function stackActivatable(o: GameObject): Activatable | null {
  if (!o.ability) return null;
  const all = activatedAbilitiesOf({ ...o, zone: "battlefield", status: { ...o.status, faceDown: null } });
  return all.find((a) => a.face === o.ability!.face && a.index === o.ability!.index) ?? null;
}

/** What "self" means for a stack object: the spell itself, or the ability's source (602.2a, 113.7a). */
export const selfOf = (o: GameObject): ObjectId => o.ability?.source ?? o.id;

/** The words a script's `castWith` condition can check (601.2b-f): how it was cast and what was paid. */
export function castWords(info: { via?: string; kicked?: boolean } | undefined): string[] {
  const out: string[] = [];
  if (info?.via) out.push(info.via);
  if (info?.kicked) out.push("kicker", "kicked");
  return out;
}

type Plan = {
  modes?: { min: number; max: number; options: any[] };
  kicker?: Json;
  hasX: boolean;
  effect: Step[];
  specs: TargetSpec[];
};

/** Everything the stack object will need chosen, given the choices made so far. */
export function planFor(s: GameState, o: GameObject, c: { seat: Seat; face: number; via?: string; modes?: number[]; kicked?: boolean; x?: number; targets: Record<string, Ref[]> }): Plan {
  const ctx: EvalCtx = { controller: c.seat, self: selfOf(o), vars: { ...c.targets }, x: c.x ?? 0, castWith: castWords(c) };
  let effect: Step[] = [];
  let topTargets: Json | undefined;
  let modes: Plan["modes"];
  let kicker: Json | undefined;
  let hasX = false;
  if (o.ability) {
    const a = stackActivatable(o);
    effect = a?.effect ?? [];
    topTargets = a?.targets;
  } else {
    const sp = spellAbility(o, c.face);
    kicker = faceKeyword(o, c.face, "kicker")?.cost as Json | undefined;
    hasX = parseCost(o.def.faces[c.face].manaCost).x > 0;
    if (sp?.modes) {
      const m = sp.modes as any;
      const n = m.count;
      const min = typeof n === "object" ? numberOf(s, ctx, n.min ?? 1) : numberOf(s, ctx, n ?? 1);
      const max = typeof n === "object" ? numberOf(s, ctx, n.max ?? n.min ?? 1) : min;
      modes = { min, max, options: m.options };
      effect = (c.modes ?? []).flatMap((i) => (m.options[i]?.effect as Step[]) ?? []);
    } else effect = (sp?.effect as Step[]) ?? [];
    topTargets = sp?.targets;
    if (!topTargets) {
      // 303.4a: an Aura spell targets what it can enchant.
      const en = faceKeyword(o, c.face, "enchant");
      if (en) topTargets = [{ id: "enchant", select: en.select as Json }];
    }
  }
  const raw: any[] = [...((topTargets as any[]) ?? [])];
  if (modes) for (const i of c.modes ?? []) raw.push(...((modes.options[i]?.targets as any[]) ?? []));
  collectTargets(s, ctx, effect, raw);
  const specs = raw.map((t): TargetSpec => {
    const n = t.count;
    const min = n === undefined ? 1 : typeof n === "object" ? numberOf(s, ctx, n.min ?? 0) : numberOf(s, ctx, n);
    const max = n === undefined ? 1 : typeof n === "object" ? numberOf(s, ctx, n.max ?? n.min ?? 1) : min;
    return { id: t.id, select: t.select, min, max, divide: t.divide === undefined ? undefined : numberOf(s, ctx, t.divide), differentFrom: t.differentFrom, prompt: t.prompt };
  });
  return { modes, kicker, hasX, effect, specs };
}

/** `targets` steps inside the effect, following `if` branches decided by how it was cast (Cyclonic Rift). */
function collectTargets(s: GameState, ctx: EvalCtx, steps: Step[], out: any[]) {
  for (const st of steps ?? []) {
    if ("if" in st) {
      collectTargets(s, ctx, ((test(s, ctx, st.if as Json) ? st.then : st.else) as Step[]) ?? [], out);
      continue;
    }
    if ("targets" in st) out.push(...((st.targets as any[]) ?? []));
  }
}

/** 115, 702.11b, 702.16b: can this be chosen as a target of the spell or ability? */
export function legalTarget(s: GameState, ctx: EvalCtx, stackObj: ObjectId, spec: { select: any; differentFrom?: Json }, ref: Ref): boolean {
  if (!matches(s, ctx, ref, spec.select)) return false;
  if ("o" in ref) {
    if (ref.o === stackObj) return false; // 115.5: a spell or ability can't target itself
    const c = chars(s, ref.o);
    // 113.6: a permanent card's hexproof and protection work only on the battlefield
    const onField = maybeObj(s, ref.o)?.zone === "battlefield";
    if (onField && c.keywords.some((k) => k.keyword === "hexproof") && c.controller !== ctx.controller) return false;
    const src = charsOf(s, ctx.self);
    if (onField && src && protectedFrom(c.keywords, src.colors)) return false;
  }
  if (spec.differentFrom !== undefined) {
    const other = typeof spec.differentFrom === "string" && spec.differentFrom.startsWith("$") ? valRefs(ctx.vars[spec.differentFrom.slice(1)]) : [];
    if (other.some((r) => refKey(r) === refKey(ref))) return false;
  }
  return true;
}

function legalTargets(s: GameState, ctx: EvalCtx, stackObj: ObjectId, spec: TargetSpec): Ref[] {
  return selectAll(s, ctx, spec.select).filter((r) => legalTarget(s, ctx, stackObj, spec, r));
}

// ---------------------------------------------------------------- the next choice

function ask(s0: GameState, d: Omit<Decision, "id" | "seat" | "hiddenFromOthers" | "options"> & Partial<Pick<Decision, "options" | "hiddenFromOthers">>): GameState {
  const c = s0.casting!;
  const [s, id] = nextDecisionId(s0);
  const options: Action[] = d.options ?? [];
  return { ...s, pendingDecision: { hiddenFromOthers: false, ...d, options: [...options, { kind: "answer", decision: id, choice: { cancel: true } }], id, seat: c.seat, source: c.object } };
}

function castCtx(s: GameState, c: CastInProgress): EvalCtx {
  return { controller: c.seat, self: selfOf(obj(s, c.object)), vars: { ...c.targets }, x: c.x ?? 0, castWith: castWords(c) };
}

/** Asks for the next thing the cast or activation needs, or finishes it. */
export function nextCastStep(s: GameState, ev: GameEvent[]): GameState {
  const c = s.casting!;
  const o = obj(s, c.object);
  const plan = planFor(s, o, c);
  const name = chars(s, c.object).name;
  if (plan.modes && c.modes === undefined) {
    const { min, max } = plan.modes;
    return ask(s, { kind: "chooseModes", prompt: `Choose ${min === max ? min : `${min} to ${max}`} for ${name}`, min, max, default: { modes: Array.from({ length: min }, (_, i) => i) } });
  }
  if (plan.kicker !== undefined && c.kicked === undefined) return ask(s, { kind: "yesNo", purpose: "kicker", prompt: `Kick ${name}?`, default: { yes: false } });
  if (plan.hasX && c.x === undefined) return ask(s, { kind: "chooseX", prompt: `Choose X for ${name}`, min: 0, max: 99, default: { number: 0 } });
  const ctx = castCtx(s, c);
  for (const spec of plan.specs) {
    if (!(spec.id in c.targets)) {
      const refs = legalTargets(s, ctx, c.object, spec);
      // 601.2c: a spell needs legal targets; with too few, the cast can't be made.
      if (refs.length < spec.min) return rollback(s, ev, `no legal target for ${name}`);
      return ask(s, { kind: "chooseTargets", prompt: spec.prompt ?? `Choose ${spec.min === spec.max ? spec.min : `${spec.min} to ${spec.max}`} target${spec.max === 1 ? "" : "s"} for ${name}`, refs, min: spec.min, max: Math.min(spec.max, refs.length), default: { targets: refs.slice(0, Math.max(spec.min, 1)) } });
    }
    if (spec.divide !== undefined && !(spec.id in c.divide)) {
      const chosen = c.targets[spec.id];
      if (chosen.length <= 1) {
        return nextCastStep({ ...s, casting: { ...c, divide: { ...c.divide, [spec.id]: chosen.length ? [spec.divide] : [] } } }, ev);
      }
      const even = chosen.map((_, i) => Math.floor(spec.divide! / chosen.length) + (i < spec.divide! % chosen.length ? 1 : 0));
      return ask(s, { kind: "divide", prompt: `Divide ${spec.divide} among the targets`, refs: chosen, total: spec.divide, default: { amounts: even } });
    }
  }
  const parts = costPartsOf(s, c, o);
  if (c.costObjects === undefined) {
    const need = costChoice(s, c, parts);
    if (need) return ask(s, need);
    return nextCastStep({ ...s, casting: { ...c, costObjects: [] } }, ev);
  }
  const why = nonManaRefusal(s, c, parts);
  if (why) return rollback(s, ev, why);
  const cost = manaCostOf(s, c, o, parts);
  const ready: GameState = { ...s, casting: { ...s.casting!, cost, ready: true } };
  if (isFreeCost(parseCost(cost))) return completeCast(ready, ev, []);
  return askPayment(ready);
}

/** Every cost part, before X and reductions (601.2f). */
function costPartsOf(s: GameState, c: CastInProgress, o: GameObject): CostPart[] {
  if (o.ability) {
    const a = stackActivatable(o);
    return a?.parts ?? [];
  }
  const f = c.face;
  let base: CostPart[];
  if (c.via === "flashback") base = costParts(faceKeyword(o, f, "flashback")?.cost as Json);
  else if (c.via === "overload") base = costParts(faceKeyword(o, f, "overload")?.cost as Json);
  else if (c.via) base = costParts(costAbilities(o, f).find((a) => a.name === c.via)?.alternative as Json);
  else base = costParts(o.def.faces[f].manaCost ?? "");
  const extra: CostPart[] = [];
  for (const a of costAbilities(o, f)) {
    if (a.additional === undefined || a.optional) continue;
    if (a.if !== undefined && !test(s, castCtx(s, c), a.if as Json)) continue;
    extra.push(...costParts(a.additional as Json));
  }
  if (c.kicked) extra.push(...costParts(faceKeyword(o, f, "kicker")?.cost as Json));
  return [...base, ...extra];
}

function manaCostOf(s: GameState, c: CastInProgress, o: GameObject, parts: CostPart[]): string {
  let cost = manaPart(parts);
  if (parseCost(cost).x) cost = costWithX(cost, c.x ?? 0);
  if (!o.ability) {
    // 702.41a: affinity for [text] costs {1} less for each one you control.
    const aff = faceKeyword(o, c.face, "affinity");
    if (aff) {
      const n = selectAll(s, castCtx(s, c), { ...(aff.for as object), controller: "you" }).length;
      cost = addGeneric(cost, -n);
    }
  }
  return cost;
}

/** A cost that needs objects chosen: sacrifice or discard something, or tap creatures to crew. */
function costChoice(s: GameState, c: CastInProgress, parts: CostPart[]): Parameters<typeof ask>[1] | null {
  const self = selfOf(obj(s, c.object));
  for (const p of parts) {
    if ("tapCreatures" in p) {
      const need = Number((p.tapCreatures as any).power ?? 0);
      const candidates = crewCandidates(s, c.seat, self);
      return { kind: "chooseObjects", purpose: "crew", prompt: `Tap creatures with total power ${need} or more`, candidates, min: 1, max: candidates.length, power: need, default: { objects: candidates } };
    }
    for (const k of ["sacrifice", "discard", "exile"] as const) {
      if (!(k in p)) continue;
      const spec = (p as any)[k];
      if (spec.object === "self" || spec.select === undefined) continue;
      const ctx = castCtx(s, c);
      const pool = k === "discard" ? s.zones.hand[c.seat] : k === "exile" ? [...s.zones.graveyard[c.seat], ...s.zones.battlefield] : s.zones.battlefield;
      const candidates = pool.filter((id) => (k !== "sacrifice" || obj(s, id).controller === c.seat) && matches(s, ctx, { o: id }, spec.select));
      const n = typeof spec.count === "number" ? spec.count : 1;
      return { kind: "chooseObjects", purpose: "cost", prompt: `Choose ${n} to ${k}`, candidates, min: n, max: n, default: { objects: candidates.slice(0, n) } };
    }
  }
  return null;
}

/** Non-mana costs that can't be paid make the cast roll back (601.2h, 119.4). */
function nonManaRefusal(s: GameState, c: CastInProgress, parts: CostPart[]): string | null {
  const life = parts.reduce((n, p) => n + ("payLife" in p ? Number(p.payLife) : 0), 0);
  if (life > s.seats[c.seat].life) return `you can't pay ${life} life`;
  return null;
}

// ---------------------------------------------------------------- answers

const CAST_KINDS = new Set(["chooseModes", "yesNo", "chooseX", "chooseTargets", "divide", "chooseObjects", "payCost"]);
export const isCastDecision = (s: GameState) => !!s.casting && !!s.pendingDecision && CAST_KINDS.has(s.pendingDecision.kind);

/** Takes an answer to a casting question. A string is a refusal (the question stays). */
export function answerCast(s0: GameState, ev: GameEvent[], choice: Choice): GameState | string {
  const c = s0.casting!;
  const d = s0.pendingDecision!;
  if ("cancel" in choice) return rollback(s0, ev, "cancelled");
  const s = { ...s0, pendingDecision: null };
  const go = (patch: Partial<CastInProgress>) => nextCastStep({ ...s, casting: { ...c, ...patch } }, ev);
  switch (d.kind) {
    case "chooseModes": {
      if (!("modes" in choice)) return "choose modes";
      const m = choice.modes;
      const plan = planFor(s, obj(s, c.object), c);
      if (new Set(m).size !== m.length) return "a mode can't be chosen twice (700.2d)";
      if (m.length < (d.min ?? 1) || m.length > (d.max ?? 1)) return `choose ${d.min === d.max ? d.min : `${d.min} to ${d.max}`} modes`;
      if (!m.every((i) => Number.isInteger(i) && i >= 0 && i < (plan.modes?.options.length ?? 0))) return "no such mode";
      return go({ modes: [...m].sort((a, b) => a - b) });
    }
    case "yesNo":
      if (!("yes" in choice)) return "answer yes or no";
      return go({ kicked: choice.yes });
    case "chooseX":
      if (!("number" in choice) || !Number.isInteger(choice.number) || choice.number < 0 || choice.number > 99) return "choose a whole number from 0 to 99";
      return go({ x: choice.number });
    case "chooseTargets": {
      if (!("targets" in choice)) return "choose targets";
      const t = choice.targets;
      const keys = t.map(refKey);
      if (new Set(keys).size !== keys.length) return "the same target was chosen twice (115.3)";
      if (t.length < (d.min ?? 1) || t.length > (d.max ?? 1)) return `choose ${d.min === d.max ? d.min : `${d.min} to ${d.max}`} targets`;
      const legal = new Set((d.refs ?? []).map(refKey));
      if (!keys.every((k) => legal.has(k))) return "that isn't a legal target";
      const spec = planFor(s, obj(s, c.object), c).specs.find((x) => !(x.id in c.targets))!;
      return go({ targets: { ...c.targets, [spec.id]: t } });
    }
    case "divide": {
      if (!("amounts" in choice)) return "give an amount for each target";
      const a = choice.amounts;
      const refs = d.refs ?? [];
      if (a.length !== refs.length || a.some((n) => !Number.isInteger(n) || n < 1)) return "each target gets at least 1 (601.2d)";
      if (a.reduce((x, y) => x + y, 0) !== d.total) return `the amounts must add up to ${d.total}`;
      const spec = planFor(s, obj(s, c.object), c).specs.find((x) => x.divide !== undefined && !(x.id in c.divide))!;
      return go({ divide: { ...c.divide, [spec.id]: a } });
    }
    case "chooseObjects": {
      if (!("objects" in choice)) return "choose the objects";
      const picked = choice.objects;
      if (new Set(picked).size !== picked.length) return "an object was chosen twice";
      if (!picked.every((id) => d.candidates?.includes(id))) return "that can't be chosen";
      if (picked.length < (d.min ?? 0) || picked.length > (d.max ?? Infinity)) return `choose ${d.min === d.max ? d.min : `${d.min} to ${d.max}`}`;
      if (d.purpose === "crew") {
        const total = picked.reduce((n, id) => n + Math.max(0, chars(s, id).power ?? 0), 0);
        if (total < (d.power ?? 0)) return `those have total power ${total}; crew needs ${d.power}`;
      }
      return go({ costObjects: picked });
    }
    case "payCost":
      return payOrRollback(s, ev, choice);
    default:
      return "not a casting question";
  }
}

// ---------------------------------------------------------------- paying (601.2g-h)

export function askPayment(s0: GameState): GameState {
  const c = s0.casting!;
  const cost = parseCost(c.cost);
  const pool = s0.seats[c.seat].pool;
  const sources = paySources(s0, c);
  const options: Action[] = [];
  const [, nextId] = nextDecisionId(s0);
  if (planAutoPay(pool, cost, sources)) options.push({ kind: "answer", decision: nextId, choice: { pay: "auto" } });
  if (payFromPool(pool, cost)) options.push({ kind: "answer", decision: nextId, choice: { pay: "pool" } });
  options.push(...manaActions(s0, c.seat).filter((a) => a.kind === "activateMana" && !reservedForCost(s0, c).includes(a.object)));
  return ask(s0, { kind: "payCost", prompt: `Pay ${c.cost} for ${chars(s0, c.object).name}`, options, default: { pay: "auto" } });
}

/** Objects the cost itself taps, sacrifices or discards: auto-pay leaves them alone. */
function reservedForCost(s: GameState, c: CastInProgress): ObjectId[] {
  const o = obj(s, c.object);
  const parts = costPartsOf(s, c, o);
  const self = selfOf(o);
  const out = [...(c.costObjects ?? [])];
  if (parts.some((p) => "tap" in p || "sacrifice" in p)) out.push(self);
  return out;
}

function paySources(s: GameState, c: CastInProgress): ManaSource[] {
  const o = obj(s, c.object);
  const convoke = !o.ability && !!faceKeyword(o, c.face, "convoke");
  return manaSources(s, c.seat, convoke, reservedForCost(s, c));
}

export function rollback(s: GameState, ev: GameEvent[], reason: string): GameState {
  const c = s.casting;
  if (!c) throw new Error("rollback without a spell being cast");
  // 733: everything goes back to how it was before the cast began, including mana abilities used during it.
  // Their events were already sent with earlier steps; castRolledBack tells a screen to drop them.
  ev.push({ type: "castRolledBack", seat: c.seat, reason });
  return c.checkpoint;
}

function payOrRollback(s: GameState, ev: GameEvent[], choice: Choice): GameState | string {
  const c = s.casting!;
  if (!("pay" in choice) || choice.pay === "decline") return rollback(s, ev, "no payment given");
  const cost = parseCost(c.cost);
  const pool = s.seats[c.seat].pool;
  if (choice.pay === "pool") {
    if (!payFromPool(pool, cost)) return rollback(s, ev, `can't pay ${c.cost} from the mana pool`);
    return completeCast(s, ev, []);
  }
  const plan = planAutoPay(pool, cost, paySources(s, c));
  if (!plan) return rollback(s, ev, `can't pay ${c.cost}`);
  return completeCast(s, ev, plan);
}

/** Pays everything (601.2h), puts the finished spell or ability in place, and gives priority back (601.2i). */
export function completeCast(s0: GameState, ev: GameEvent[], plan: ReturnType<typeof planAutoPay> & object): GameState {
  const c = s0.casting!;
  let s = s0;
  // Mana: convoke creatures tap and pay (702.51a); other sources tap for mana.
  for (const step of plan) {
    if (step.convoke) {
      s = setTapped(s, ev, step.object, true);
      s = setSeat(s, c.seat, { pool: { ...s.seats[c.seat].pool, [step.bundle[0]]: s.seats[c.seat].pool[step.bundle[0]] + 1 } });
    } else s = tapPlan(s, ev, c.seat, [step]);
  }
  const before = s.seats[c.seat].pool;
  const after = payFromPool(before, parseCost(c.cost));
  if (!after) throw new Error("payment plan didn't cover the cost");
  if (poolTotal(before) !== poolTotal(after)) {
    const spent = Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v - after[k as keyof typeof after]]).filter(([, v]) => v));
    ev.push({ type: "manaSpent", seat: c.seat, mana: spent });
  }
  s = setSeat(s, c.seat, { pool: after });
  s = payNonMana(s, ev, c);
  let o = obj(s, c.object);
  o = { ...o, targets: c.targets, divide: c.divide };
  if (!o.ability) o = { ...o, castInfo: { ...o.castInfo!, ...(c.modes ? { modes: c.modes } : {}), ...(c.kicked ? { kicked: true } : {}), ...(c.x !== undefined ? { x: c.x } : {}) } };
  s = { ...setObj(s, o), casting: null, pendingDecision: null };
  if (o.ability) {
    const a = stackActivatable(o)!;
    const tm = s.turnMemory;
    s = {
      ...s,
      turnMemory: {
        ...tm,
        loyaltyUsed: a.kind === "loyalty" ? [...tm.loyaltyUsed, o.ability.source] : tm.loyaltyUsed,
        activated: a.oncePerTurn ? [...tm.activated, `${o.ability.sourceCard}:${a.face}:${a.index}`] : tm.activated,
      },
    };
    ev.push({ type: "activate", seat: c.seat, object: o.id, source: o.ability.source });
  } else {
    const spellsCast = { ...s.turnMemory.spellsCast, [c.seat]: (s.turnMemory.spellsCast[c.seat] ?? 0) + 1 };
    s = { ...s, turnMemory: { ...s.turnMemory, spellsCast } };
    ev.push({ type: "cast", seat: c.seat, object: o.id, face: o.castInfo?.face ?? 0 });
  }
  return s;
}

function payNonMana(s0: GameState, ev: GameEvent[], c: CastInProgress): GameState {
  let s = s0;
  const o = obj(s, c.object);
  const parts = costPartsOf(s, c, o);
  const self = selfOf(o);
  let chosen = c.costObjects ?? [];
  for (const p of parts) {
    if ("tap" in p) s = setTapped(s, ev, self, true);
    else if ("untap" in p) s = setTapped(s, ev, self, false);
    else if ("payLife" in p) {
      const n = Number(p.payLife);
      s = setSeat(s, c.seat, { life: s.seats[c.seat].life - n });
      ev.push({ type: "lifeLoss", seat: c.seat, amount: n });
    } else if ("tapCreatures" in p) {
      for (const id of chosen) s = setTapped(s, ev, id, true);
      chosen = [];
    } else if ("removeCounters" in p) {
      const r = p.removeCounters as any;
      const now = obj(s, self);
      const n = typeof r.amount === "number" ? r.amount : 1;
      const counters: Record<string, number> = { ...now.counters, [r.kind]: (now.counters[r.kind] ?? 0) - n };
      if (counters[r.kind] <= 0) delete counters[r.kind];
      s = setObj(s, { ...now, counters });
      ev.push({ type: "counters", object: self, kind: r.kind, amount: -n });
    } else {
      for (const k of ["sacrifice", "discard", "exile"] as const) {
        if (!(k in p)) continue;
        const spec = (p as any)[k];
        const ids = spec.object === "self" ? [self] : chosen;
        if (spec.object !== "self") chosen = [];
        for (const id of ids) {
          if (!maybeObj(s, id)) continue;
          let nid: ObjectId;
          [s, nid] = moveObject(s, ev, id, k === "exile" ? "exile" : "graveyard");
          if (k === "discard") ev.push({ type: "discard", seat: c.seat, object: nid });
        }
      }
    }
  }
  // 606.4: a loyalty ability's cost adds or removes loyalty counters.
  const a = o.ability ? stackActivatable(o) : null;
  if (a?.kind === "loyalty" && a.loyalty) {
    const pw = obj(s, self);
    s = setObj(s, { ...pw, counters: { ...pw.counters, loyalty: (pw.counters.loyalty ?? 0) + a.loyalty } });
    ev.push({ type: "counters", object: self, kind: "loyalty", amount: a.loyalty });
  }
  return s;
}

// ---------------------------------------------------------------- targets on resolution (608.2b)

/** The stack object's targets that are still legal, and whether it had any. */
export function recheckTargets(s: GameState, o: GameObject): { vars: Record<string, Ref[]>; had: boolean; anyLegal: boolean } {
  const chosen = o.targets ?? {};
  const info = o.castInfo;
  const plan = planFor(s, o, { seat: o.controller, face: o.ability ? o.ability.face : info?.face ?? 0, via: info?.via, modes: info?.modes, kicked: info?.kicked, x: info?.x, targets: chosen });
  const ctx: EvalCtx = { controller: o.controller, self: selfOf(o), vars: { ...chosen }, x: info?.x ?? 0, castWith: castWords(info) };
  const vars: Record<string, Ref[]> = {};
  let had = false;
  let anyLegal = false;
  for (const [id, refs] of Object.entries(chosen)) {
    const spec = plan.specs.find((x) => x.id === id);
    const still = refs.filter((r) => {
      if ("o" in r && !maybeObj(s, r.o)) return false; // it changed zones: a new object (400.7)
      return !spec || legalTarget(s, ctx, o.id, spec, r);
    });
    if (refs.length) had = true;
    if (still.length) anyLegal = true;
    vars[id] = still;
  }
  return { vars, had, anyLegal };
}
