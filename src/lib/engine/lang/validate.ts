// The schema check for card scripts (docs/card-language.md). Every script goes through here before the
// engine reads it. A bad script is refused with a list of clear errors, each with the path to the problem
// ("faces[0].abilities[1].effect[2].draw.player: ..."). It checks:
//   - the language version, the top-level shape, one entry per printed face;
//   - every ability kind and keyword, and the fields each one takes;
//   - every effect step against the block table (`blocks.ts`): known block, known fields, required fields;
//   - expressions, selectors, conditions, costs and mana;
//   - bound variables: a `$name` must be bound earlier (targets, `as:`, trigger bindings, `let`, forEach);
//   - continuous effects: each `do` is in its own layer (613.1).

import { ABILITY_COMMON, ABILITY_KINDS, BLOCK_BY_NAME, KEYWORDS, LAYER_OF_DO, ZONE_NAMES, type Field } from "./blocks";
import { SUPPORTED_LANGUAGES, type CardScript, type Json, type JsonObject } from "./script-types";

export type ScriptError = { path: string; message: string };
export type ValidateResult = { ok: true; script: CardScript; errors: [] } | { ok: false; errors: ScriptError[] };

/** What the printed card says, to check the script against (number of faces, name). */
export type PrintedFacts = { name: string; faces: number };

type Scope = Set<string>;

const isObj = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);
const VAR = /^\$[A-Za-z_][A-Za-z0-9_]*$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MANA_STRING = /^(\{([WUBRGCSX]|\d+|[WUBRG]\/[WUBRGP]|T|Q)\})+$/;
const COLORS_WORDS = ["white", "blue", "black", "red", "green", "W", "U", "B", "R", "G", "colorless", "multicolored", "monocolored"];
const KIND_WORDS = ["permanent", "card", "spell", "ability", "token", "player", "nontoken"];
const PLAYER_REL = ["you", "opponent", "notYou", "any"];
const EVENTS = [
  "zoneChange",
  "enters",
  "dies",
  "cast",
  "draw",
  "discard",
  "beginStep",
  "attacks",
  "blocks",
  "attacksOrBlocks",
  "createTokens",
  "putCounters",
  "lifeChange",
  "damage",
  "tapForMana",
];

export function validateScript(input: unknown, printed?: PrintedFacts): ValidateResult {
  const v = new Checker();
  v.script(input, printed);
  if (v.errors.length) return { ok: false, errors: v.errors };
  return { ok: true, script: input as CardScript, errors: [] };
}

/** One readable line per error, for test output and the compiler's retry prompt. */
export function formatErrors(errors: ScriptError[]): string {
  return errors.map((e) => `${e.path}: ${e.message}`).join("\n");
}

class Checker {
  errors: ScriptError[] = [];
  private tokenIds = new Set<string>();

  err(path: string, message: string) {
    this.errors.push({ path, message });
  }

  private fields(path: string, o: JsonObject, allowed: Record<string, Field>, scope: Scope, what: string) {
    for (const k of Object.keys(o)) {
      if (!(k in allowed)) this.err(`${path}.${k}`, `unknown field "${k}" in ${what} (allowed: ${Object.keys(allowed).join(", ") || "none"})`);
    }
    for (const [k, spec] of Object.entries(allowed)) {
      if (spec.required && !(k in o)) this.err(path, `${what} needs "${k}"`);
    }
    // binds come last so a block can't read the variable it is about to bind
    const order = Object.keys(o).sort((a, b) => Number(allowed[a]?.kind === "bind") - Number(allowed[b]?.kind === "bind"));
    for (const k of order) {
      const spec = allowed[k];
      if (spec) this.value(`${path}.${k}`, o[k], spec, scope);
    }
  }

  private value(path: string, v: Json, spec: Field, scope: Scope) {
    switch (spec.kind) {
      case "objects":
        return this.objects(path, v, scope);
      case "player":
        return this.player(path, v, scope);
      case "players":
        return this.players(path, v, scope);
      case "number":
        return this.number(path, v, scope);
      case "count":
        return this.count(path, v, scope);
      case "zone":
        if (typeof v !== "string" || !ZONE_NAMES.includes(v)) this.err(path, `"${String(v)}" is not a zone (${ZONE_NAMES.join(", ")})`);
        return;
      case "steps":
        return void this.steps(path, v, scope);
      case "condition":
        return this.condition(path, v, scope);
      case "selector":
        return this.selector(path, v, scope);
      case "bind":
        if (typeof v !== "string" || !NAME.test(v)) this.err(path, `"${String(v)}" is not a variable name (letters, digits and _, without the $)`);
        else scope.add(v);
        return;
      case "mana":
        return this.mana(path, v, scope);
      case "cost":
        return this.cost(path, v, scope);
      case "token":
        return this.token(path, v);
      case "bool":
        if (typeof v !== "boolean") this.err(path, "should be true or false");
        return;
      case "string":
        if (typeof v !== "string") this.err(path, "should be text");
        else if (spec.values && !spec.values.includes(v)) this.err(path, `"${v}" isn't one of ${spec.values.join(", ")}`);
        return;
      case "any":
        return;
    }
  }

  // ---------------------------------------------------------------- top level

  script(input: unknown, printed?: PrintedFacts) {
    if (!isObj(input as Json)) return this.err("(script)", "a card script is a JSON object");
    const s = input as JsonObject;
    const allowed = ["schema", "oracleId", "name", "oracleHash", "faces", "tokens", "notes"];
    for (const k of Object.keys(s)) if (!allowed.includes(k)) this.err(k, `unknown top-level field "${k}" (allowed: ${allowed.join(", ")})`);
    if (typeof s.schema !== "string") this.err("schema", 'missing the language version, e.g. "schema": "dg-card/1"');
    else if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(s.schema))
      this.err("schema", `this engine runs ${SUPPORTED_LANGUAGES.join(", ")}, not "${s.schema}" (the card plays by hand until the engine supports it)`);
    if (typeof s.oracleId !== "string" || !/^[0-9a-f-]{8,}$/i.test(s.oracleId)) this.err("oracleId", "needs the card's Scryfall oracle id");
    if (typeof s.name !== "string" || !s.name) this.err("name", "needs the card's name");
    else if (printed && s.name !== printed.name) this.err("name", `says "${s.name}" but the printed card is "${printed.name}"`);
    if ("notes" in s && typeof s.notes !== "string") this.err("notes", "should be text");
    if ("tokens" in s) this.tokens(s.tokens);
    if (!Array.isArray(s.faces) || s.faces.length === 0) return this.err("faces", "needs one entry per face");
    if (printed && s.faces.length !== printed.faces)
      this.err("faces", `has ${s.faces.length} entr${s.faces.length === 1 ? "y" : "ies"} but the printed card has ${printed.faces} face(s)`);
    s.faces.forEach((face, i) => {
      const p = `faces[${i}]`;
      if (!isObj(face)) return this.err(p, "a face is an object with an abilities list");
      for (const k of Object.keys(face)) if (k !== "abilities") this.err(`${p}.${k}`, `unknown field "${k}" in a face (allowed: abilities)`);
      if (!Array.isArray(face.abilities)) return this.err(`${p}.abilities`, "should be a list (empty for a card with no abilities)");
      face.abilities.forEach((a, j) => this.ability(`${p}.abilities[${j}]`, a));
    });
  }

  private tokens(v: Json) {
    if (!Array.isArray(v)) return this.err("tokens", "should be a list of token definitions");
    v.forEach((t, i) => {
      const p = `tokens[${i}]`;
      if (!isObj(t)) return this.err(p, "a token definition is an object");
      if (typeof t.id !== "string" || !NAME.test(t.id)) this.err(`${p}.id`, "needs an id (letters and digits) the script refers to");
      else this.tokenIds.add(t.id);
      this.tokenBody(p, t);
    });
  }

  private tokenBody(p: string, t: JsonObject) {
    const allowed = ["id", "name", "types", "subtypes", "supertypes", "colors", "pt", "abilities"];
    for (const k of Object.keys(t)) if (!allowed.includes(k)) this.err(`${p}.${k}`, `unknown field "${k}" in a token (allowed: ${allowed.join(", ")})`);
    if (typeof t.name !== "string") this.err(`${p}.name`, "a token needs a name");
    if (!Array.isArray(t.types) || t.types.length === 0) this.err(`${p}.types`, "a token needs its card types, e.g. [creature]");
    if ("pt" in t && !(Array.isArray(t.pt) && t.pt.length === 2 && t.pt.every((n) => typeof n === "number"))) this.err(`${p}.pt`, "should be [power, toughness]");
    if ("abilities" in t) {
      if (!Array.isArray(t.abilities)) this.err(`${p}.abilities`, "should be a list");
      else t.abilities.forEach((a, j) => this.ability(`${p}.abilities[${j}]`, isObj(a) && !("kind" in a) && "keyword" in a ? { kind: "keyword", ...a } : a));
    }
  }

  // ---------------------------------------------------------------- abilities

  private ability(path: string, a: Json) {
    if (!isObj(a)) return this.err(path, "an ability is an object with a kind");
    const kind = a.kind;
    if (typeof kind !== "string" || !(kind in ABILITY_KINDS))
      return this.err(`${path}.kind`, `"${String(kind)}" is not an ability kind (${Object.keys(ABILITY_KINDS).join(", ")})`);
    const scope: Scope = new Set();
    if (kind === "keyword") return this.keyword(path, a, scope);
    const def = ABILITY_KINDS[kind];
    const allowed: Record<string, Field> = { ...ABILITY_COMMON, ...def.fields };
    for (const k of Object.keys(a)) if (!(k in allowed)) this.err(`${path}.${k}`, `unknown field "${k}" in a ${kind} ability (allowed: ${Object.keys(allowed).join(", ")})`);
    for (const [k, spec] of Object.entries(allowed)) if (spec.required && !(k in a)) this.err(path, `a ${kind} ability needs "${k}"`);
    if (kind === "triggered" && a.when !== undefined) this.eventPattern(`${path}.when`, a.when, scope);
    if (kind === "replacement" && a.replaces !== undefined) this.eventPattern(`${path}.replaces`, a.replaces, scope);
    if (a.targets !== undefined) this.targets(`${path}.targets`, a.targets, scope);
    if (a.cost !== undefined) this.cost(`${path}.cost`, a.cost, scope);
    if (kind === "mana" && a.add !== undefined) this.mana(`${path}.add`, a.add, scope);
    if (kind === "loyalty" && a.loyalty !== undefined && typeof a.loyalty !== "number" && a.loyalty !== "-X")
      this.err(`${path}.loyalty`, 'a loyalty cost is a number (+2 is 2, −1 is -1) or "-X"');
    if (kind === "cost") {
      if (!("alternative" in a) && !("additional" in a)) this.err(path, 'a cost ability needs "alternative" or "additional"');
      for (const k of ["alternative", "additional"]) if (a[k] !== undefined) this.cost(`${path}.${k}`, a[k], scope);
      if (a.if !== undefined) this.condition(`${path}.if`, a.if, scope);
    }
    if (a.if !== undefined && kind === "triggered") this.condition(`${path}.if`, a.if, scope);
    if (kind === "spell") {
      if (a.modes !== undefined) this.modes(`${path}.modes`, a.modes, scope);
      else if (a.effect === undefined) this.err(path, 'a spell ability needs "effect" (or "modes")');
    }
    if (a.effect !== undefined) this.steps(`${path}.effect`, a.effect, scope);
    if (kind === "static") this.staticEffects(`${path}.effects`, a.effects, scope);
    if (kind === "replacement" && a.with !== undefined) {
      if (Array.isArray(a.with)) this.steps(`${path}.with`, a.with, scope);
      else if (!isObj(a.with)) this.err(`${path}.with`, "should be a list of steps or a replacement object");
    }
    if ("zone" in a) this.value(`${path}.zone`, a.zone, { kind: "zone" }, scope);
  }

  private keyword(path: string, a: JsonObject, scope: Scope) {
    const name = a.keyword;
    if (typeof name !== "string" || !(name in KEYWORDS))
      return this.err(`${path}.keyword`, `"${String(name)}" is not a dg-card/1 keyword (${Object.keys(KEYWORDS).join(", ")})`);
    const def = KEYWORDS[name];
    const allowed: Record<string, Field> = { ...ABILITY_COMMON, keyword: { kind: "string", required: true }, ...def.fields };
    for (const k of Object.keys(a)) if (!(k in allowed)) this.err(`${path}.${k}`, `unknown field "${k}" for ${name} (allowed: ${Object.keys(allowed).join(", ")})`);
    for (const [k, spec] of Object.entries(allowed)) if (spec.required && !(k in a)) this.err(path, `${name} needs "${k}"`);
    if (a.targets !== undefined) this.targets(`${path}.targets`, a.targets, scope);
    for (const [k, spec] of Object.entries(def.fields)) if (k in a && k !== "targets") this.value(`${path}.${k}`, a[k], spec, scope);
    if (name === "protection" && a.from !== undefined) {
      const from = a.from;
      const ok =
        from === "everything" ||
        (Array.isArray(from) && from.every((c) => typeof c === "string" && COLORS_WORDS.includes(c))) ||
        isObj(from);
      if (!ok) this.err(`${path}.from`, 'protection "from" is a list of colors, "everything", or a selector');
      if (isObj(from)) this.selector(`${path}.from`, from, scope);
    }
    if (name === "companion" && a.condition !== undefined) this.deckCondition(`${path}.condition`, a.condition, scope);
  }

  private deckCondition(path: string, v: Json, scope: Scope) {
    if (!isObj(v) || Object.keys(v).length !== 1 || !("everyCard" in v)) return this.err(path, 'a companion condition is { everyCard: <selector> }');
    this.selector(`${path}.everyCard`, v.everyCard, scope);
  }

  private modes(path: string, v: Json, scope: Scope) {
    if (!isObj(v)) return this.err(path, "modes is { count, options: [ { effect } ... ] }");
    for (const k of Object.keys(v)) if (!["count", "options"].includes(k)) this.err(`${path}.${k}`, `unknown field "${k}" in modes (allowed: count, options)`);
    if (v.count === undefined) this.err(path, 'modes needs "count" (how many to choose)');
    else this.count(`${path}.count`, v.count, scope);
    if (!Array.isArray(v.options) || v.options.length < 2) return this.err(`${path}.options`, "a modal spell has two or more options");
    v.options.forEach((m, i) => {
      const p = `${path}.options[${i}]`;
      if (!isObj(m)) return this.err(p, "a mode is { targets?, effect }");
      for (const k of Object.keys(m)) if (!["targets", "effect", "text"].includes(k)) this.err(`${p}.${k}`, `unknown field "${k}" in a mode (allowed: targets, effect, text)`);
      const inner = new Set(scope);
      if (m.targets !== undefined) this.targets(`${p}.targets`, m.targets, inner);
      if (m.effect === undefined) this.err(p, 'a mode needs "effect"');
      else this.steps(`${p}.effect`, m.effect, inner);
    });
  }

  private targets(path: string, v: Json, scope: Scope) {
    if (!Array.isArray(v)) return this.err(path, "targets is a list of { id, select, count? }");
    v.forEach((t, i) => {
      const p = `${path}[${i}]`;
      if (!isObj(t)) return this.err(p, "a target is { id, select, count? }");
      for (const k of Object.keys(t))
        if (!["id", "select", "count", "divide", "prompt", "differentFrom"].includes(k)) this.err(`${p}.${k}`, `unknown field "${k}" in a target (allowed: id, select, count, divide, prompt, differentFrom)`);
      if (typeof t.id !== "string" || !NAME.test(t.id)) this.err(`${p}.id`, "a target needs an id (it is bound as $id)");
      if (t.select === undefined) this.err(p, 'a target needs "select"');
      else this.selector(`${p}.select`, t.select, scope);
      if (t.count !== undefined) this.count(`${p}.count`, t.count, scope);
      if (t.divide !== undefined) this.number(`${p}.divide`, t.divide, scope);
      if (t.differentFrom !== undefined) this.objects(`${p}.differentFrom`, t.differentFrom, scope);
      if (typeof t.id === "string") scope.add(t.id);
    });
  }

  private staticEffects(path: string, v: Json, scope: Scope) {
    if (!Array.isArray(v)) return this.err(path, "a static ability's effects is a list");
    v.forEach((e, i) => {
      const p = `${path}[${i}]`;
      if (!isObj(e) || Object.keys(e).length !== 1) return this.err(p, "each static effect is { continuous }, { ruleEffect } or { permission }");
      const [k] = Object.keys(e);
      if (k === "continuous") this.continuous(`${p}.continuous`, e[k], scope);
      else if (k !== "ruleEffect" && k !== "permission") this.err(p, `"${k}" isn't a static effect (continuous, ruleEffect, permission)`);
      else if (!isObj(e[k])) this.err(`${p}.${k}`, "should be an object");
    });
  }

  private continuous(path: string, v: Json, scope: Scope) {
    if (!isObj(v)) return this.err(path, "a continuous effect is an object");
    const allowed = ["layer", "affects", "player", "do", "duration", "lockSet"];
    for (const k of Object.keys(v)) if (!allowed.includes(k)) this.err(`${path}.${k}`, `unknown field "${k}" in a continuous effect (allowed: ${allowed.join(", ")})`);
    if (!isObj(v.do)) return this.err(`${path}.do`, "a continuous effect needs do: { ... }");
    const layer = v.layer === undefined ? undefined : String(v.layer);
    for (const k of Object.keys(v.do)) {
      const layers = LAYER_OF_DO[k];
      if (!layers) this.err(`${path}.do.${k}`, `"${k}" isn't a continuous-effect action (${Object.keys(LAYER_OF_DO).join(", ")})`);
      else if (layer !== undefined && !layers.includes(layer)) this.err(`${path}.do.${k}`, `${k} belongs in layer ${layers.join(" or ")}, not layer ${layer} (613.1)`);
    }
    if (v.affects !== undefined && typeof v.affects !== "string") this.selectorOrObjects(`${path}.affects`, v.affects, scope);
  }

  private selectorOrObjects(path: string, v: Json, scope: Scope) {
    if (isObj(v) && Object.keys(v).some((k) => ["minus", "union", "select", "topOf", "follow", "attachedTo", "linked"].includes(k))) return this.objects(path, v, scope);
    if (isObj(v)) return this.selector(path, v, scope);
    return this.objects(path, v, scope);
  }

  private eventPattern(path: string, v: Json, scope: Scope) {
    if (!isObj(v)) return this.err(path, "an event pattern is { event, ... }");
    if (typeof v.event !== "string" || !EVENTS.includes(v.event)) this.err(`${path}.event`, `"${String(v.event)}" is not an event (${EVENTS.join(", ")})`);
    if (v.as !== undefined) {
      if (!isObj(v.as)) this.err(`${path}.as`, "as: binds what the trigger saw, e.g. { player: p, object: o }");
      else
        for (const [k, name] of Object.entries(v.as)) {
          if (typeof name !== "string" || !NAME.test(name)) this.err(`${path}.as.${k}`, "should be a variable name");
          else scope.add(name);
        }
    }
  }

  // ---------------------------------------------------------------- steps

  /** Checks a list of steps; returns the scope after them (later steps may read what earlier ones bound). */
  steps(path: string, v: Json, scope0: Scope): Scope {
    const scope = scope0;
    if (!Array.isArray(v)) {
      this.err(path, "should be a list of steps");
      return scope;
    }
    v.forEach((st, i) => this.step(`${path}[${i}]`, st, scope));
    return scope;
  }

  private step(path: string, st: Json, scope: Scope) {
    if (!isObj(st)) return this.err(path, "a step is an object like { draw: 1 }");
    const keys = Object.keys(st);
    if ("if" in st) {
      for (const k of keys) if (!["if", "then", "else"].includes(k)) this.err(`${path}.${k}`, `unknown field "${k}" in an if step (allowed: if, then, else)`);
      this.condition(`${path}.if`, st.if, scope);
      if (st.then === undefined) this.err(path, 'an if step needs "then"');
      else this.steps(`${path}.then`, st.then, new Set(scope));
      if (st.else !== undefined) this.steps(`${path}.else`, st.else, new Set(scope));
      return;
    }
    if (keys.length !== 1) return this.err(path, `a step has exactly one block, found ${keys.length ? keys.join(", ") : "none"}`);
    const name = keys[0];
    const def = BLOCK_BY_NAME[name];
    if (!def) return this.err(`${path}.${name}`, `"${name}" is not a dg-card/1 block`);
    const p = `${path}.${name}`;
    let args = st[name];
    if (name === "let") {
      if (!isObj(args) || Object.keys(args).length === 0) return this.err(p, "let is { name: <number expression> }");
      for (const [k, e] of Object.entries(args)) {
        if (!NAME.test(k)) this.err(`${p}.${k}`, "should be a variable name");
        this.number(`${p}.${k}`, e, scope);
        scope.add(k);
      }
      return;
    }
    if (name === "targets") return this.targets(p, args, scope);
    if (!isObj(args)) {
      if (!def.shorthand) return this.err(p, `${name} takes an object of fields (${Object.keys(def.fields).join(", ")})`);
      args = { [def.shorthand]: args };
    }
    const inner = def.group === "flow" || def.name === "may" || def.name === "unless" ? new Set(scope) : scope;
    if (def.name === "forEach") {
      const as = typeof args.as === "string" ? args.as : "each";
      inner.add(as);
    }
    this.fields(p, args, def.fields, inner, name);
    if (def.oneOf && !def.oneOf.some((k) => k in (args as JsonObject))) this.err(p, `${name} needs one of: ${def.oneOf.join(", ")}`);
    if (def.name === "continuous") this.continuous(p, args, scope);
    // a may / unless step's own `as` is visible after it
    if ((def.name === "may" || def.name === "unless") && typeof args.as === "string") scope.add(args.as);
  }

  // ---------------------------------------------------------------- expressions

  private ref(path: string, v: string, scope: Scope): boolean {
    if (!VAR.test(v)) return false;
    if (!scope.has(v.slice(1))) this.err(path, `${v} is used before anything binds it (bind it with a target id, as:, let, or forEach)`);
    return true;
  }

  private objects(path: string, v: Json, scope: Scope): void {
    if (typeof v === "string") {
      if (v === "self" || v === "it") return;
      if (!this.ref(path, v, scope)) this.err(path, `"${v}" is not an object reference ("self", "$name", { select }, { minus }, ...)`);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => this.objects(`${path}[${i}]`, x, scope));
    if (!isObj(v) || Object.keys(v).length === 0) return this.err(path, "should be an object reference");
    const keys = Object.keys(v);
    const k = keys[0];
    switch (k) {
      case "select":
        if (keys.length > 1) this.err(path, "{ select } takes nothing else");
        return this.selector(`${path}.select`, v.select, scope);
      case "minus":
      case "union":
        if (!Array.isArray(v[k]) || (v[k] as Json[]).length < 2) return this.err(`${path}.${k}`, `${k} takes a list of two or more references`);
        return (v[k] as Json[]).forEach((x, i) => this.objects(`${path}.${k}[${i}]`, x, scope));
      case "topOf": {
        const t = v.topOf;
        if (!isObj(t)) return this.err(`${path}.topOf`, "topOf is { library: <player>, count? }");
        if (t.library !== undefined) this.player(`${path}.topOf.library`, t.library, scope);
        if (t.count !== undefined) this.number(`${path}.topOf.count`, t.count, scope);
        return;
      }
      case "follow":
        if (typeof v.follow !== "string" || !this.ref(`${path}.follow`, v.follow, scope)) this.err(`${path}.follow`, "follow takes a $variable");
        for (const x of keys) if (!["follow", "to", "in"].includes(x)) this.err(`${path}.${x}`, `unknown field "${x}" in follow (allowed: to, in)`);
        return;
      case "attachedTo":
        return this.objects(`${path}.attachedTo`, v.attachedTo, scope);
      case "linked":
        if (typeof v.linked !== "string") this.err(`${path}.linked`, "linked takes the link's name");
        return;
      case "first":
        return this.objects(`${path}.first`, v.first, scope);
      default:
        this.err(path, `"${k}" isn't an object reference (select, minus, union, topOf, follow, attachedTo, linked, first)`);
    }
  }

  private player(path: string, v: Json, scope: Scope) {
    if (typeof v === "string") {
      if (["you", "active", "defending"].includes(v)) return;
      if (this.ref(path, v, scope)) return;
      return this.err(path, `"${v}" is not one player (use you, active, $name, { controllerOf }, { ownerOf }; for "each opponent" use forEach)`);
    }
    if (isObj(v) && Object.keys(v).length === 1 && ("controllerOf" in v || "ownerOf" in v)) {
      const k = Object.keys(v)[0];
      return this.objects(`${path}.${k}`, v[k], scope);
    }
    this.err(path, "should be a player");
  }

  private players(path: string, v: Json, scope: Scope) {
    if (typeof v === "string" && ["each", "opponent", "opponents", "you", "others"].includes(v)) return;
    if (Array.isArray(v)) return v.forEach((x, i) => this.player(`${path}[${i}]`, x, scope));
    return this.player(path, v, scope);
  }

  private number(path: string, v: Json, scope: Scope) {
    if (typeof v === "number") return Number.isInteger(v) ? undefined : this.err(path, "numbers are whole numbers");
    if (typeof v === "string") {
      if (!this.ref(path, v, scope)) this.err(path, `"${v}" is not a number or a $variable`);
      return;
    }
    if (!isObj(v)) return this.err(path, "should be a number expression");
    const keys = Object.keys(v);
    const main = keys.filter((k) => k !== "lki");
    if (main.length !== 1) return this.err(path, `a number expression has one operation, found ${main.join(", ") || "none"}`);
    const k = main[0];
    const arg = v[k];
    switch (k) {
      case "count":
        return this.selectorOrObjects(`${path}.count`, arg, scope);
      case "devotion":
        if (typeof arg !== "string" || !COLORS_WORDS.includes(arg)) this.err(`${path}.devotion`, "devotion takes a color");
        return;
      case "x":
        if (arg !== true) this.err(`${path}.x`, "use { x: true } for the X paid");
        return;
      case "power":
      case "toughness":
      case "manaValue":
        if ("lki" in v && typeof v.lki !== "boolean") this.err(`${path}.lki`, "lki is true or false");
        return this.objects(`${path}.${k}`, arg, scope);
      case "add":
      case "times":
      case "minus":
      case "min":
      case "max":
        if (!Array.isArray(arg) || arg.length < 2) return this.err(`${path}.${k}`, `${k} takes a list of two or more numbers`);
        return arg.forEach((x, i) => this.number(`${path}.${k}[${i}]`, x, scope));
      case "librarySize":
      case "handSize":
      case "life":
        return this.player(`${path}.${k}`, arg, scope);
      case "counters":
        if (!isObj(arg) || typeof arg.kind !== "string" || arg.on === undefined) return this.err(`${path}.counters`, "counters is { on, kind }");
        return this.objects(`${path}.counters.on`, arg.on, scope);
      case "spellsCast":
        return this.player(`${path}.spellsCast`, arg, scope);
      default:
        this.err(path, `"${k}" isn't a number operation (count, devotion, x, power, toughness, manaValue, add, times, minus, min, max, librarySize, handSize, life, counters, spellsCast)`);
    }
  }

  private count(path: string, v: Json, scope: Scope) {
    if (isObj(v) && ("min" in v || "max" in v) && Object.keys(v).every((k) => k === "min" || k === "max")) {
      if (v.min !== undefined) this.number(`${path}.min`, v.min, scope);
      if (v.max !== undefined) this.number(`${path}.max`, v.max, scope);
      return;
    }
    this.number(path, v, scope);
  }

  private condition(path: string, v: Json, scope: Scope): void {
    if (typeof v === "string") {
      if (!this.ref(path, v, scope)) this.err(path, `"${v}" is not a condition`);
      return;
    }
    if (!isObj(v) || Object.keys(v).length !== 1) return this.err(path, "a condition has one operation (compare, exists, zoneOf, castWith, isTurnOf, and, or, not)");
    const [k] = Object.keys(v);
    const arg = v[k];
    switch (k) {
      case "compare": {
        if (!Array.isArray(arg) || arg.length !== 3) return this.err(`${path}.compare`, 'compare is [number, "op", number]');
        const [a, op, b] = arg;
        if (typeof op !== "string" || !["<", "<=", ">", ">=", "==", "!="].includes(op)) this.err(`${path}.compare[1]`, `"${String(op)}" is not a comparison (<, <=, >, >=, ==, !=)`);
        this.number(`${path}.compare[0]`, a, scope);
        this.number(`${path}.compare[2]`, b, scope);
        return;
      }
      case "exists":
        return this.selector(`${path}.exists`, arg, scope);
      case "zoneOf":
        if (!isObj(arg)) return this.err(`${path}.zoneOf`, "zoneOf is { object, is }");
        this.objects(`${path}.zoneOf.object`, arg.object, scope);
        this.value(`${path}.zoneOf.is`, arg.is, { kind: "zone" }, scope);
        return;
      case "castWith":
        if (typeof arg !== "string") this.err(`${path}.castWith`, "castWith names a cast choice (overload, kicker, flashback, or a cost ability's name)");
        return;
      case "isTurnOf":
        return this.player(`${path}.isTurnOf`, arg, scope);
      case "and":
      case "or":
        if (!Array.isArray(arg) || arg.length < 2) return this.err(`${path}.${k}`, `${k} takes a list of two or more conditions`);
        return arg.forEach((c, i) => this.condition(`${path}.${k}[${i}]`, c, scope));
      case "not":
        return this.condition(`${path}.not`, arg, scope);
      default:
        this.err(path, `"${k}" isn't a condition (compare, exists, zoneOf, castWith, isTurnOf, and, or, not)`);
    }
  }

  private selector(path: string, v: Json, scope: Scope) {
    if (!isObj(v)) return this.err(path, "a selector is an object like { type: creature, controller: you }");
    const words = (x: Json) => (Array.isArray(x) ? x : [x]).every((w) => typeof w === "string" && w.length > 0);
    for (const [k, x] of Object.entries(v)) {
      const p = `${path}.${k}`;
      switch (k) {
        case "type":
        case "subtype":
        case "supertype":
        case "name":
          if (!words(x)) this.err(p, `${k} takes a word or a list of words`);
          break;
        case "color":
          if (!words(x) || !(Array.isArray(x) ? x : [x]).every((c) => COLORS_WORDS.includes(c as string))) this.err(p, `color takes ${COLORS_WORDS.join(", ")}`);
          break;
        case "controller":
        case "owner":
          if (typeof x !== "string" || !(PLAYER_REL.includes(x) || this.ref(p, x, scope))) this.err(p, `${k} is you, opponent, notYou, any, or a $player`);
          break;
        case "player":
          if (typeof x !== "string" || !(["any", "you", "opponent", "each"].includes(x) || this.ref(p, x, scope))) this.err(p, "player is any, you, opponent, or a $player");
          break;
        case "zone":
          this.value(p, x, { kind: "zone" }, scope);
          break;
        case "kind":
          if (typeof x !== "string" || !KIND_WORDS.includes(x)) this.err(p, `kind is ${KIND_WORDS.join(", ")}`);
          break;
        case "manaValue":
        case "power":
        case "toughness":
          if (isObj(x)) {
            for (const [op, n] of Object.entries(x)) {
              if (!["<", "<=", ">", ">=", "==", "!="].includes(op)) this.err(`${p}.${op}`, `"${op}" is not a comparison`);
              this.number(`${p}.${op}`, n, scope);
            }
          } else this.number(p, x, scope);
          break;
        case "tapped":
        case "other":
        case "self":
          if (typeof x !== "boolean") this.err(p, "should be true or false");
          break;
        case "not":
          this.selector(p, x, scope);
          break;
        case "anyOf":
        case "allOf":
          if (!Array.isArray(x) || x.length < 1) this.err(p, `${k} takes a list of selectors`);
          else x.forEach((s, i) => this.selector(`${p}[${i}]`, s, scope));
          break;
        case "with":
          if (!isObj(x) || !(typeof x.keyword === "string" || typeof x.counter === "string")) this.err(p, "with is { keyword } or { counter }");
          else if (typeof x.keyword === "string" && !(x.keyword in KEYWORDS)) this.err(`${p}.keyword`, `"${x.keyword}" is not a keyword`);
          break;
        case "attachedTo":
        case "is":
          this.objects(p, x, scope);
          break;
        case "linked":
          if (typeof x !== "string") this.err(p, "linked takes a link name");
          break;
        default:
          this.err(
            p,
            `unknown selector field "${k}" (type, subtype, supertype, color, controller, owner, player, zone, kind, name, manaValue, power, toughness, tapped, other, self, not, anyOf, allOf, with, attachedTo, is)`,
          );
      }
    }
  }

  private mana(path: string, v: Json, scope: Scope) {
    if (typeof v === "string") {
      if (!/^(\{[WUBRGC]\})+$/.test(v)) this.err(path, `"${v}" isn't mana to add (like "{G}" or "{C}{C}")`);
      return;
    }
    if (isObj(v)) {
      if ("anyColor" in v && Object.keys(v).length === 1) return this.number(`${path}.anyColor`, v.anyColor, scope);
      if ("oneOf" in v) {
        if (!Array.isArray(v.oneOf) || !v.oneOf.every((c) => typeof c === "string" && /^[WUBRGC]$/.test(c))) this.err(`${path}.oneOf`, 'oneOf is a list of mana letters, like ["G", "U"]');
        if (v.amount !== undefined) this.number(`${path}.amount`, v.amount, scope);
        return;
      }
    }
    this.err(path, 'mana is "{G}{G}", { anyColor: 1 } or { oneOf: [...] }');
  }

  private cost(path: string, v: Json, scope: Scope) {
    if (Array.isArray(v)) return v.forEach((x, i) => this.cost(`${path}[${i}]`, x, scope));
    if (typeof v === "string") {
      if (v === "tap" || v === "untap" || v === "") return;
      if (!MANA_STRING.test(v)) this.err(path, `"${v}" isn't a cost (a mana cost like "{2}{U}", or tap)`);
      return;
    }
    if (!isObj(v) || Object.keys(v).length !== 1) return this.err(path, "a cost part is a mana string, tap, or one of { payLife }, { sacrifice }, { discard }, { removeCounters }, { exile }, { tapCreatures }");
    const [k] = Object.keys(v);
    const arg = v[k];
    switch (k) {
      case "payLife":
      case "life":
        return this.number(`${path}.${k}`, arg, scope);
      case "sacrifice":
      case "discard":
      case "exile":
        if (!isObj(arg)) return this.err(`${path}.${k}`, `${k} is { object: self } or { select, count }`);
        for (const x of Object.keys(arg)) if (!["object", "select", "count"].includes(x)) this.err(`${path}.${k}.${x}`, `unknown field "${x}" (allowed: object, select, count)`);
        if (arg.object !== undefined) this.objects(`${path}.${k}.object`, arg.object, scope);
        if (arg.select !== undefined) this.selector(`${path}.${k}.select`, arg.select, scope);
        if (arg.count !== undefined) this.number(`${path}.${k}.count`, arg.count, scope);
        if (arg.object === undefined && arg.select === undefined) this.err(`${path}.${k}`, `${k} needs object or select`);
        return;
      case "removeCounters":
        if (!isObj(arg) || typeof arg.kind !== "string") return this.err(`${path}.removeCounters`, "removeCounters is { kind, amount }");
        if (arg.amount !== undefined) this.number(`${path}.removeCounters.amount`, arg.amount, scope);
        return;
      case "tapCreatures":
        if (!isObj(arg) || arg.power === undefined) return this.err(`${path}.tapCreatures`, "tapCreatures is { power } (crew)");
        return this.number(`${path}.tapCreatures.power`, arg.power, scope);
      default:
        this.err(path, `"${k}" isn't a cost part (payLife, sacrifice, discard, exile, removeCounters, tapCreatures)`);
    }
  }

  private token(path: string, v: Json) {
    if (typeof v === "string") {
      if (v !== "Treasure" && !this.tokenIds.has(v)) this.err(path, `"${v}" isn't a built-in token (Treasure) or a token id in this script's tokens`);
      return;
    }
    if (isObj(v)) return this.tokenBody(path, v);
    this.err(path, 'token is "Treasure", a token id, or a token definition');
  }
}
