// The card language's building blocks, as data (docs/card-language.md). One table says, for every block:
// the rule it implements, which fields it takes, and when the engine runs it. The schema check reads the
// field lists; the coverage proof reads `core`; the "not yet" events read `runs`.
//
// "now" = this engine version runs it. "PR 3" / "PR 4a" / "PR 4b" / "PR 4c" = the language has it (scripts
// using it pass the schema check today) and that PR makes the engine do it. Until then a step that isn't
// run yet is skipped with a `notYet` event, so a game never crashes on it (the player finishes it by hand
// once manual moves exist, PR 5).

export type Runs = "now" | "PR 3" | "PR 4a" | "PR 4b" | "PR 4c" | "later";

/** What a field holds. The schema check knows each of these. */
export type FieldKind =
  | "objects" // a reference to objects: "$x", "self", a list, { select }, { minus }, { topOf } ...
  | "player" // one player: "you", "$p", { controllerOf }, { ownerOf }, "active"
  | "players" // a set of players: "each", "opponent", "you", "$p"
  | "number" // a number expression
  | "count" // a number, or { min, max }
  | "zone"
  | "steps" // a list of effect steps
  | "condition"
  | "selector"
  | "bind" // a new variable name (without the $)
  | "mana" // "{G}{G}", { anyColor: 1 }, { oneOf: ["G", "U"] }
  | "cost" // a cost: "{3}", "tap", { payLife: 4 }, or a list of those
  | "token" // "Treasure", a token id from the script's `tokens`, or an inline token
  | "bool"
  | "string"
  | "any"; // checked by the block's own rule (layers, events)

export type Field = { kind: FieldKind; required?: boolean; values?: readonly string[] };

export type BlockDef = {
  name: string;
  group: "cards" | "moving" | "making" | "numbers" | "state" | "game" | "choices" | "flow" | "lasting" | "delayed" | "structure";
  rule: string; // Comprehensive Rules number(s), June 19, 2026 rules
  runs: Runs;
  /** Part of the PR 2 core set: run now, and the hand-written cards must use every one (PR 2 gate). */
  core: boolean;
  fields: Record<string, Field>;
  /** When the step's value isn't an object, it fills this field: `{ draw: 2 }` = `{ draw: { amount: 2 } }`. */
  shorthand?: string;
  /** At least one of these fields must be given. */
  oneOf?: string[];
};

const ZONES = ["library", "hand", "graveyard", "battlefield", "stack", "exile", "command"] as const;

const f = (kind: FieldKind, required = false, values?: readonly string[]): Field => ({ kind, required, values });
const OBJ = { object: f("objects"), objects: f("objects"), select: f("selector") };
const AS = { as: f("bind") };

function block(
  name: string,
  group: BlockDef["group"],
  rule: string,
  runs: Runs,
  fields: Record<string, Field>,
  extra: Partial<Pick<BlockDef, "shorthand" | "oneOf" | "core">> = {},
): BlockDef {
  return { name, group, rule, runs, core: extra.core ?? runs === "now", fields, shorthand: extra.shorthand, oneOf: extra.oneOf };
}

export const BLOCKS: BlockDef[] = [
  // ---- cards
  block("draw", "cards", "121.1", "now", { amount: f("number", true), player: f("player") }, { shorthand: "amount" }),
  block("discard", "cards", "701.9", "now", { amount: f("number"), all: f("bool"), player: f("player"), random: f("bool"), ...OBJ, ...AS }, { shorthand: "amount" }),
  block("mill", "cards", "701.17", "now", { amount: f("number", true), player: f("player"), ...AS }, { shorthand: "amount" }),
  block("reveal", "cards", "701.20", "now", { ...OBJ, player: f("player"), zone: f("zone"), top: f("number"), ...AS }, { oneOf: ["object", "objects", "top"] }),
  block("look", "cards", "701.20", "now", { ...OBJ, player: f("player"), zone: f("zone"), top: f("number"), ...AS }, { oneOf: ["object", "objects", "top"] }),
  block(
    "search",
    "cards",
    "701.23",
    "now",
    { player: f("player"), zone: f("zone"), select: f("selector", true), min: f("number"), max: f("number"), count: f("count"), reveal: f("bool"), ...AS },
  ),
  block("shuffle", "cards", "701.24", "now", { player: f("player") }, { shorthand: "player" }),
  block("scry", "cards", "701.22", "now", { amount: f("number", true), player: f("player") }, { shorthand: "amount" }),
  block("surveil", "cards", "701.25", "now", { amount: f("number", true), player: f("player") }, { shorthand: "amount" }),
  block("putOnTop", "cards", "401.4", "now", { ...OBJ }, { shorthand: "objects", oneOf: ["object", "objects"] }),
  block("putOnBottom", "cards", "401.4", "now", { ...OBJ, random: f("bool") }, { shorthand: "objects", oneOf: ["object", "objects"] }),

  // ---- moving
  block(
    "move",
    "moving",
    "400.7",
    "now",
    { ...OBJ, to: f("zone", true), tapped: f("bool"), faceDown: f("bool"), underControlOf: f("player"), position: f("string", false, ["top", "bottom"]), ...AS },
    { oneOf: ["object", "objects", "select"] },
  ),
  block("destroy", "moving", "701.8", "now", { ...OBJ, ...AS }, { shorthand: "object", oneOf: ["object", "objects", "select"] }),
  block("exile", "moving", "406.2", "now", { ...OBJ, faceDown: f("bool"), ...AS }, { shorthand: "object", oneOf: ["object", "objects", "select"] }),
  block("sacrifice", "moving", "701.21", "now", { ...OBJ, count: f("count"), player: f("player"), ...AS }, { shorthand: "object", oneOf: ["object", "objects", "select"] }),
  block("bounce", "moving", "400.7", "now", { ...OBJ }, { shorthand: "object", oneOf: ["object", "objects", "select"] }),
  block("returnToBattlefield", "moving", "400.7", "now", { ...OBJ, tapped: f("bool"), underControlOf: f("player"), ...AS }, { shorthand: "object", oneOf: ["object", "objects"] }),
  block("counter", "moving", "701.6", "now", { ...OBJ }, { shorthand: "object", oneOf: ["object", "objects"] }),

  // ---- making
  block("createToken", "making", "111.2, 701.7", "now", { token: f("token", true), count: f("number"), controller: f("player"), tapped: f("bool"), ...AS }, { shorthand: "token" }),
  block("copy", "making", "707", "PR 4c", { ...OBJ, count: f("number"), ...AS }),
  block("createEmblem", "making", "114", "PR 4c", { abilities: f("any", true) }),

  // ---- numbers
  block("gainLife", "numbers", "119.3", "now", { amount: f("number", true), player: f("player"), players: f("players") }, { shorthand: "amount" }),
  block("loseLife", "numbers", "119.3", "now", { amount: f("number", true), player: f("player"), players: f("players"), ...AS }, { shorthand: "amount" }),
  block("dealDamage", "numbers", "120", "now", { amount: f("number"), divided: f("bool"), to: f("objects", true), source: f("objects") }),
  block("addCounters", "numbers", "122.1", "now", { kind: f("string", true), amount: f("number"), on: f("objects", true) }),
  block("removeCounters", "numbers", "122.1", "now", { kind: f("string", true), amount: f("number"), on: f("objects", true) }),
  block("addMana", "numbers", "106.4", "now", { mana: f("mana", true), player: f("player") }, { shorthand: "mana" }),
  block("payLife", "numbers", "119.4", "now", { amount: f("number", true), player: f("player"), ...AS }, { shorthand: "amount" }),

  // ---- state
  block("fight", "state", "701.14", "now", { object: f("objects", true), with: f("objects", true) }),
  block("tap", "state", "701.26", "now", { ...OBJ }, { shorthand: "object", oneOf: ["object", "objects", "select"] }),
  block("untap", "state", "701.26", "now", { ...OBJ }, { shorthand: "object", oneOf: ["object", "objects", "select"] }),
  block("attach", "state", "701.3", "now", { object: f("objects", true), to: f("objects", true) }),
  block("transform", "state", "701.28", "now", { ...OBJ }, { shorthand: "object", oneOf: ["object", "objects"] }),
  block("phaseOut", "state", "702.26", "PR 4c", { ...OBJ }, { shorthand: "object" }),
  block("exchangeControl", "state", "701.12", "PR 4c", { objects: f("objects", true), ...AS }),
  block("gainControl", "state", "613.1b", "PR 4c", { ...OBJ, player: f("player"), duration: f("string") }),
  block("turnFaceUp", "state", "708.8", "later", { ...OBJ }, { shorthand: "object" }),

  // ---- game
  block("winGame", "game", "104.2a", "now", { player: f("player") }, { shorthand: "player" }),
  block("loseGame", "game", "104.3", "now", { player: f("player") }, { shorthand: "player" }),
  block("extraTurn", "game", "500.7", "now", { player: f("player") }, { shorthand: "player" }),
  block("skipStep", "game", "614.10", "PR 4c", { step: f("string", true), player: f("player") }),

  // ---- choices
  block("may", "choices", "608.2d", "now", { do: f("steps", true), player: f("player"), prompt: f("string"), ...AS }),
  block("unless", "choices", "118.12", "now", { player: f("player", true), pay: f("cost", true), then: f("steps", true), ...AS }),
  block(
    "choose",
    "choices",
    "608.2d",
    "now",
    {
      from: f("objects"),
      select: f("selector"),
      min: f("number"),
      max: f("number"),
      count: f("count"),
      ordered: f("bool"),
      opponent: f("bool"),
      number: f("count"),
      color: f("bool"),
      player: f("player"),
      prompt: f("string"),
      as: f("bind", true),
    },
    { oneOf: ["from", "select", "opponent", "number", "color"] },
  ),
  block("splitPiles", "choices", "700.3", "now", { objects: f("objects", true), player: f("player"), piles: f("number"), as: f("bind", true) }),
  block("choosePile", "choices", "700.3", "now", { from: f("objects", true), player: f("player"), as: f("bind", true), other: f("bind") }),
  block("vote", "choices", "701.38", "later", { options: f("any", true), as: f("bind", true) }),

  // ---- control flow (if is written { if, then, else })
  block("if", "flow", "608.2c", "now", { if: f("condition", true), then: f("steps", true), else: f("steps") }),
  block("forEach", "flow", "608.2c", "now", { over: f("objects"), player: f("players"), select: f("selector"), as: f("bind"), do: f("steps", true) }, { oneOf: ["over", "player", "select"] }),
  block("repeat", "flow", "608.2c", "later", { times: f("number", true), do: f("steps", true) }),

  // ---- lasting effects (the layer system, replacement effects)
  block("continuous", "lasting", "611, 613", "PR 4c", {
    layer: f("string"),
    affects: f("any"),
    player: f("player"),
    do: f("any", true),
    duration: f("string"),
    lockSet: f("bool"),
  }),
  block("ruleEffect", "lasting", "613.10", "PR 4c", { any: f("any") }),
  block("grantPermission", "lasting", "601.3", "PR 4c", { any: f("any") }),
  block("addReplacement", "lasting", "614", "PR 4b", { any: f("any") }),
  block("enterTapped", "lasting", "614.1c", "PR 4b", { any: f("any") }),
  block("multiplyCount", "lasting", "614.1a", "PR 4b", { any: f("any") }),
  block("delayed", "delayed", "603.7", "PR 4a", { when: f("any", true), effect: f("steps", true) }),
  block("link", "delayed", "607", "PR 4a", { name: f("string", true), objects: f("objects", true) }),

  // ---- structure (not effects; never counted in the core set)
  block("let", "structure", "608.2", "now", {}, { core: false }),
  block("targets", "structure", "601.2c", "now", {}, { core: false }),
];

export const BLOCK_BY_NAME: Record<string, BlockDef> = Object.fromEntries(BLOCKS.map((b) => [b.name, b]));
export const CORE_BLOCKS = BLOCKS.filter((b) => b.core).map((b) => b.name);
export const ZONE_NAMES: readonly string[] = ZONES;

/** Blocks that are also cost parts; a script that pays them as a cost counts as using the block. */
export const COST_BLOCKS = ["tap", "untap", "sacrifice", "discard", "payLife", "removeCounters", "exile"] as const;

// ---------------------------------------------------------------- ability kinds

export type AbilityKindDef = { rule: string; runs: Runs; fields: Record<string, Field> };

const TARGETS = { targets: f("any"), resolvesWithoutTargets: f("bool") };

export const ABILITY_KINDS: Record<string, AbilityKindDef> = {
  keyword: { rule: "702", runs: "now", fields: {} }, // fields depend on the keyword (KEYWORDS below)
  spell: { rule: "608", runs: "now", fields: { effect: f("steps"), modes: f("any"), ...TARGETS } },
  activated: {
    rule: "602",
    runs: "now",
    fields: { cost: f("cost", true), effect: f("steps", true), timing: f("string", false, ["sorcery", "instant"]), limit: f("string", false, ["oncePerTurn"]), ...TARGETS },
  },
  mana: { rule: "605", runs: "now", fields: { cost: f("cost", true), add: f("mana", true) } },
  loyalty: { rule: "606", runs: "now", fields: { loyalty: f("number", true), effect: f("steps", true), ...TARGETS } },
  triggered: {
    rule: "603",
    runs: "PR 4a",
    fields: { when: f("any", true), if: f("condition"), effect: f("steps"), modes: f("any"), optional: f("bool"), link: f("string"), ...TARGETS },
  },
  static: { rule: "604", runs: "PR 4c", fields: { effects: f("any", true) } },
  replacement: { rule: "614", runs: "PR 4b", fields: { replaces: f("any", true), with: f("any", true), self: f("bool") } },
  cda: { rule: "604.3", runs: "PR 4c", fields: { do: f("any", true) } },
  cost: {
    rule: "118.9, 601.2f",
    runs: "now",
    fields: { alternative: f("cost"), additional: f("cost"), optional: f("bool"), if: f("condition"), name: f("string") },
  },
};

/** Fields every ability may have. */
export const ABILITY_COMMON: Record<string, Field> = { kind: f("string", true), id: f("string"), zone: f("zone"), notes: f("string") };

// ---------------------------------------------------------------- keywords

export type KeywordDef = {
  rule: string;
  runs: Runs;
  /** What "runs" means for this keyword, in plain words (shown in the coverage report). */
  what: string;
  fields: Record<string, Field>;
};

const kw = (rule: string, runs: Runs, what: string, fields: Record<string, Field> = {}): KeywordDef => ({ rule, runs, what, fields });

/** The 30 keywords of dg-card/1 v1 (docs/card-language.md, "Keywords"). */
export const KEYWORDS: Record<string, KeywordDef> = {
  flying: kw("702.9", "PR 3", "blocking restriction (combat)"),
  "first strike": kw("702.7", "PR 3", "first-strike damage step (combat)"),
  "double strike": kw("702.4", "PR 3", "deals damage in both damage steps (combat)"),
  deathtouch: kw("702.2", "now", "any damage it deals to a creature destroys it (704.5h)"),
  lifelink: kw("702.15", "now", "damage it deals also gains its controller that much life"),
  trample: kw("702.19", "PR 3", "excess combat damage to the player (combat)"),
  vigilance: kw("702.20", "PR 3", "doesn't tap to attack (combat)"),
  haste: kw("702.10", "now", "can use {T} abilities the turn it arrives (attacking is PR 3)"),
  reach: kw("702.17", "PR 3", "can block flyers (combat)"),
  menace: kw("702.110", "PR 3", "needs two blockers (combat)"),
  hexproof: kw("702.11", "now", "opponents' spells and abilities can't target it"),
  indestructible: kw("702.12", "now", "destroy and lethal damage don't put it in the graveyard"),
  flash: kw("702.8", "now", "cast any time you could cast an instant"),
  defender: kw("702.3", "PR 3", "can't attack (combat)"),
  ward: kw("702.21", "PR 4a", "a triggered counter-unless-pay", { cost: f("cost", true) }),
  protection: kw("702.16", "now", "can't be targeted by, and damage is prevented from, what it has protection from (blocking and enchanting: PR 3 / 4c)", {
    from: f("any", true),
  }),
  flashback: kw("702.34", "now", "cast from your graveyard for its flashback cost, then exile it", { cost: f("cost", true) }),
  cycling: kw("702.29", "now", "pay and discard it from hand: draw a card, or search (typecycling)", { cost: f("cost", true), search: f("selector") }),
  kicker: kw("702.33", "now", "optional additional cost the effect can check", { cost: f("cost", true) }),
  convoke: kw("702.51", "now", "creatures you tap help pay"),
  overload: kw("702.96", "now", "alternative cost that changes target to each", { cost: f("cost", true) }),
  cascade: kw("702.85", "PR 4a", "a cast trigger"),
  equip: kw("702.6", "now", "sorcery-speed: attach to a creature you control", { cost: f("cost", true) }),
  enchant: kw("702.5", "now", "an Aura spell targets what it can enchant; it falls off otherwise (704.5m)", { select: f("selector", true) }),
  landfall: kw("207.2c", "PR 4a", "ability word: a trigger when a land enters under your control", { effect: f("steps", true), targets: f("any") }),
  affinity: kw("702.41", "now", "costs {1} less for each matching permanent you control", { for: f("selector") }),
  storm: kw("702.40", "PR 4a", "a cast trigger that copies the spell"),
  crew: kw("702.122", "now", "tap creatures with total power N (the cost runs now; becoming a creature is a layer 4 effect, PR 4c)", {
    amount: f("number", true),
  }),
  partner: kw("702.124", "PR 3", "two commanders (partner, partner with, friends forever, choose a Background, Doctor's companion)", {
    variant: f("string", false, ["partner", "with", "friendsForever", "chooseBackground", "doctorsCompanion", "background"]),
    with: f("string"),
  }),
  companion: kw("702.139", "PR 3", "deck condition and the {3} special action (116.2g); the condition is written and schema-checked now", { condition: f("any", true) }),
};

export const KEYWORD_NAMES = Object.keys(KEYWORDS);

/** Where a continuous effect's `do` belongs (613.1): the schema refuses `setBasePT` in layer 4 and so on. */
export const LAYER_OF_DO: Record<string, string[]> = {
  copyOf: ["1"],
  setController: ["2"],
  changeText: ["3"],
  addTypes: ["4"],
  removeTypes: ["4"],
  setLandSubtypes: ["4"],
  addSubtypes: ["4"],
  setColors: ["5"],
  addColors: ["5"],
  gainAbility: ["6"],
  removeAbility: ["6"],
  removeAllAbilities: ["6"],
  setBasePT: ["7a", "7b"],
  modifyPT: ["7c"],
  switchPT: ["7d"],
};
