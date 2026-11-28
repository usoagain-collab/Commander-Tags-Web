// The engine's data shapes (engine-design.md sections 1-4). Everything here is plain data: no classes,
// no functions, nothing that can't go into JSON (the persistent map is plain nested arrays).
// States are never changed in place; every step returns a new state that shares unchanged parts.

import type { PMap } from "./pmap";
import type { RngState } from "./rng";
import type { CardScript, Ref, Step as ScriptStep, Val } from "./lang/script-types";

export type { Ref, Val } from "./lang/script-types";

export type Seat = number;
export type ObjectId = number;
export type CardInstanceId = number;
export type DecisionId = number;

// ---------- printed cards ----------

export type Layout =
  | "normal"
  | "split"
  | "flip"
  | "transform"
  | "modal_dfc"
  | "adventure"
  | "room"
  | "meld"
  | "prototype"
  | "saga"
  | "class"
  | "case"
  | "leveler"
  | "omen"
  | "token"
  | "emblem";

export type Color = "W" | "U" | "B" | "R" | "G";

/** One face's printed facts (from `card_faces` once that table exists). */
export type FaceDef = {
  name: string;
  manaCost: string | null; // "{2}{W}{W}"; null when the face has no mana cost (lands, many back faces)
  typeLine: string;
  supertypes: string[]; // Legendary, Basic, Snow...
  types: string[]; // Creature, Land, Instant...
  subtypes: string[]; // Elf, Forest, Aura...
  oracleText: string;
  power: string | null; // text, because "*" and "1+*" exist
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  colors: Color[];
};

/** Printed facts about a card, never changed by the game. */
export type CardDef = {
  oracleId: string;
  layout: Layout;
  faces: FaceDef[];
  script: CardScript | null; // null = manual card (plays by hand, PR 5)
};

// ---------- game objects ----------

export type ZoneName = "library" | "hand" | "graveyard" | "battlefield" | "stack" | "exile" | "command";

export type FaceDownKind = "morph" | "manifest" | "cloak" | "disguise" | "foretell" | "other";

export type ObjectStatus = {
  tapped: boolean;
  flipped: boolean;
  faceDown: FaceDownKind | null;
  phasedOut: boolean;
  upFace: number; // which face is up (transform, modal DFC)
  transformed: boolean;
};

/** How a spell was cast; stays on the permanent it becomes. */
export type CastInfo = {
  face: number; // face cast (MDFC back, adventure, split half)
  fromZone: ZoneName;
  turn: number;
  /** How it was cast: "flashback", "overload", or a cost ability's name (an alternative cost, 118.9). */
  via?: string;
  kicked?: boolean;
  x?: number;
  modes?: number[];
};

/** An activated or loyalty ability on the stack (602.2a). It isn't a card; it ceases to exist when it leaves. */
export type StackAbility = {
  source: ObjectId; // the permanent (or card) it came from, as it was when activated
  sourceCard: CardInstanceId;
  face: number;
  index: number; // index into that face's script abilities
};

export type GameObject = {
  id: ObjectId;
  cardId: CardInstanceId; // the physical card; stays the same across zone changes (400.7 gives a new id)
  def: CardDef;
  owner: Seat;
  controller: Seat; // base controller, before layer 2
  zone: ZoneName;
  status: ObjectStatus;
  counters: Record<string, number>;
  damage: number;
  deathtouchHit: boolean;
  summoningSick: boolean; // true until its controller's next turn starts (302.6)
  attachedTo: ObjectId | Seat | null;
  timestamp: number;
  castInfo?: CastInfo;
  isCommander?: boolean;
  isToken?: boolean;
  ability?: StackAbility;
  /** Chosen targets of a spell or ability on the stack, by target id (601.2c). */
  targets?: Record<string, Ref[]>;
  /** Divided amounts (601.2d), by target id, in the same order as `targets`. */
  divide?: Record<string, number[]>;
  /** A card exiled by its own Adventure (715.4): its owner may cast the creature half from exile. */
  onAdventure?: boolean;
};

// ---------- derived characteristics ----------

/** What the game sees after layers. In PR 1 there are no continuous effects yet, so this is the printed face. */
export type Characteristics = {
  name: string;
  manaCost: string | null;
  manaValue: number;
  colors: Color[];
  supertypes: string[];
  types: string[];
  subtypes: string[];
  power: number | null;
  toughness: number | null;
  loyalty: number | null;
  controller: Seat;
  /** Keyword abilities (702), as script keyword entries ({ keyword, cost?, from? ... }). */
  keywords: KeywordAbility[];
};

export type KeywordAbility = { keyword: string; [field: string]: unknown };

// ---------- players and turns ----------

export type ManaType = Color | "C";
export type ManaPool = Record<ManaType, number>;

export type PlayerState = {
  seat: Seat;
  life: number;
  poison: number;
  pool: ManaPool;
  commanderDamage: Record<CardInstanceId, number>;
  drewFromEmpty: boolean; // 704.5b, checked at the next state check
  lost: boolean;
  lossReason: string | null;
  maxHandSize: number;
};

export type Step =
  | "untap"
  | "upkeep"
  | "draw"
  | "main1"
  | "beginCombat"
  | "declareAttackers"
  | "declareBlockers"
  | "combatDamage"
  | "endCombat"
  | "main2"
  | "end"
  | "cleanup";

export type Phase = "beginning" | "precombatMain" | "combat" | "postcombatMain" | "ending";

export type TurnState = {
  number: number; // 1-based, counts every player's turns
  activeSeat: Seat;
  step: Step;
  attackersDeclared: boolean; // PR 3; while false, blockers and damage are skipped (508.8)
};

export type TurnMemory = {
  landsPlayed: Record<Seat, number>;
  spellsCast: Record<Seat, number>;
  /** Planeswalkers that used a loyalty ability this turn (606.3). */
  loyaltyUsed: ObjectId[];
  /** "Activate only once each turn" uses, as "objectId:ability". */
  activated: string[];
};

export type GameMemory = {
  commanderCasts: Record<CardInstanceId, number>; // shape for PR 3 (tax)
  firstSeat: Seat;
  turnsTaken: Record<Seat, number>;
  /** Extra turns to take, next first (500.7: the most recently created is taken first). */
  extraTurns: Seat[];
  /** While extra turns run: whose regular turn came before them, so play resumes after that seat. */
  resumeAfter?: Seat;
};

export type TableRules = {
  mode: "solo" | "private" | "strict" | "loose";
  startingLife: number;
  startingHand: number;
};

/** Shape only: filled by later PRs (resolved effects 611, replacements 614, delayed and pending triggers 603). */
export type ContinuousEffect = { readonly kind: "notYet" };
export type ReplacementInstance = { readonly kind: "notYet" };
export type DelayedTrigger = { readonly kind: "notYet" };
export type PendingTrigger = { readonly kind: "notYet" };

/**
 * A spell being cast (601.2) or an ability being activated (602.2). Choices are made one decision at a
 * time; if it can't finish, the game goes back to `checkpoint` exactly (733).
 */
export type CastInProgress = {
  kind: "spell" | "ability";
  object: ObjectId; // the spell or ability, already on the stack (601.2a, 602.2a)
  seat: Seat;
  cost: string; // the total mana cost, worked out once every choice is made (601.2f)
  checkpoint: GameState;
  face: number;
  via?: string;
  modes?: number[];
  kicked?: boolean;
  x?: number;
  targets: Record<string, Ref[]>;
  divide: Record<string, number[]>;
  /** Objects chosen to pay non-mana costs: sacrifice, discard, crew. */
  costObjects?: ObjectId[];
  /** Life and other non-mana costs, paid when the cast completes (601.2h). */
  lifeCost?: number;
  ready?: boolean; // every choice made; only payment is left
};

/** A spell or ability resolving (608.2), paused while someone answers a choice. */
export type Resolution = {
  object: ObjectId; // the stack object resolving
  controller: Seat;
  self: ObjectId; // what "self" means: the spell, or the ability's source
  todo: Task[];
  vars: Record<string, Val>;
  castWith: string[];
  x: number;
  divide: Record<string, number[]>;
  /** Objects that moved during this resolution: old id -> new id (for `follow`). */
  moved: Record<number, number>;
  waiting: { step: ScriptStep; data: Val | null } | null;
};

export type Task = { step: ScriptStep } | { bind: string; value: Val };

export type GameState = {
  engineVersion: string;
  scriptsManifest: string;
  rng: RngState;
  nextObjectId: number;
  nextCardId: number;
  nextTimestamp: number;
  nextDecisionId: number;
  seatOrder: Seat[]; // turn order
  turn: TurnState;
  priority: { seat: Seat | null; passedInRow: Seat[] };
  seats: Record<Seat, PlayerState>;
  objects: PMap<GameObject>;
  zones: {
    library: Record<Seat, ObjectId[]>; // top = last
    hand: Record<Seat, ObjectId[]>;
    graveyard: Record<Seat, ObjectId[]>; // top = last
    battlefield: ObjectId[];
    stack: ObjectId[]; // top = last
    exile: ObjectId[];
    command: ObjectId[];
  };
  lki: PMap<Characteristics>; // last known characteristics of objects that left the battlefield or stack
  effects: ContinuousEffect[];
  replacements: ReplacementInstance[];
  delayedTriggers: DelayedTrigger[];
  pendingTriggers: PendingTrigger[];
  turnMemory: TurnMemory;
  gameMemory: GameMemory;
  casting: CastInProgress | null;
  resolving: Resolution | null;
  pendingDecision: Decision | null;
  loopGuard: { seen: string[] };
  table: TableRules;
  winner: Seat | null;
  over: boolean;
};

// ---------- actions ----------

/** 116.2b-m. Only playLand (116.2a) works in PR 1; it has its own action kind. */
export type SpecialKind =
  | "turnFaceUp" // 116.2b
  | "endEffect" // 116.2c
  | "ignoreStatic" // 116.2d
  | "circlingVultures" // 116.2e
  | "suspend" // 116.2f
  | "companion" // 116.2g
  | "foretell" // 116.2h
  | "planarDie" // 116.2i
  | "conspiracy" // 116.2j
  | "plot" // 116.2k
  | "unlockRoom"; // 116.2m

export type Choice =
  | { pay: "auto" } // auto-pay: tap what's needed, then pay from the pool
  | { pay: "pool" } // pay from the pool only
  | { pay: "decline" } // "unless that player pays": don't pay
  | { cancel: true }
  | { objects: ObjectId[] } // in order, when the order matters
  | { targets: Ref[] }
  | { modes: number[] }
  | { number: number }
  | { yes: boolean }
  | { amounts: number[] }
  | { piles: ObjectId[][] }
  | { pile: number }
  | { top: ObjectId[]; bottom: ObjectId[] } // scry, surveil: top first
  | { color: ManaType }
  | { player: Seat };

export type Action =
  | { kind: "pass" }
  | { kind: "playLand"; object: ObjectId; face?: number }
  | { kind: "cast"; object: ObjectId; face?: number; via?: string }
  | { kind: "activate"; object: ObjectId; ability: number }
  | { kind: "activateMana"; object: ObjectId; ability: number; color?: ManaType }
  | { kind: "special"; special: SpecialKind; object?: ObjectId }
  | { kind: "answer"; decision: DecisionId; choice: Choice }
  | { kind: "concede" }
  | { kind: "manual"; edit: unknown; suppressTriggers?: boolean } // PR 5
  | { kind: "rewind"; toAction: number }; // PR 5

// ---------- decisions ----------

export type DecisionKind =
  | "priority"
  | "mulligan"
  | "bottomCards"
  | "chooseFace"
  | "chooseModes"
  | "chooseX"
  | "chooseTargets"
  | "divide"
  | "payCost"
  | "orderTriggers"
  | "orderReplacements"
  | "chooseObjects"
  | "chooseOpponent"
  | "yesNo"
  | "payOrNot"
  | "splitPiles"
  | "choosePile"
  | "declareAttackers"
  | "declareBlockers"
  | "orderBlockers"
  | "commanderToCommandZone"
  | "legendRule"
  | "arrange"
  | "chooseColor"
  | "chooseNumber";

export type Decision = {
  id: DecisionId;
  seat: Seat;
  kind: DecisionKind;
  prompt: string;
  source?: ObjectId;
  /** For priority: every legal starting action. For others: the choices that can be sent as an answer. */
  options: Action[];
  min?: number;
  max?: number;
  default?: Choice;
  hiddenFromOthers: boolean;
  /** chooseObjects / arrange / yesNo: what the choice is for. */
  purpose?: "discard" | "sacrifice" | "search" | "choose" | "scry" | "surveil" | "kicker" | "may" | "crew" | "cost" | "unless";
  candidates?: ObjectId[];
  /** chooseTargets: every legal target (objects and players). */
  refs?: Ref[];
  /** chooseObjects: the order of the answer matters (first = top of library). */
  ordered?: boolean;
  /** chooseTargets with division (601.2d): the total to divide. */
  total?: number;
  /** crew: total power needed. */
  power?: number;
};

// ---------- events ----------

export type GameEvent =
  | { type: "gameStart"; seats: Seat[] }
  | { type: "shuffle"; seat: Seat }
  | { type: "turnBegin"; turn: number; seat: Seat }
  | { type: "stepBegin"; step: Step }
  | { type: "zoneChange"; card: CardInstanceId; oldId: ObjectId; newId: ObjectId; from: ZoneName; to: ZoneName; owner: Seat }
  | { type: "draw"; seat: Seat; card: CardInstanceId; object: ObjectId }
  | { type: "tap"; object: ObjectId }
  | { type: "untap"; object: ObjectId }
  | { type: "manaAdded"; seat: Seat; mana: ManaType; amount: number }
  | { type: "manaSpent"; seat: Seat; mana: Partial<ManaPool> }
  | { type: "manaEmptied"; seat: Seat }
  | { type: "landPlayed"; seat: Seat; object: ObjectId }
  | { type: "cast"; seat: Seat; object: ObjectId; face: number }
  | { type: "castRolledBack"; seat: Seat; reason: string }
  | { type: "resolve"; object: ObjectId }
  | { type: "priority"; seat: Seat }
  | { type: "discard"; seat: Seat; object: ObjectId }
  | { type: "damageRemoved" }
  | { type: "lose"; seat: Seat; reason: string }
  | { type: "gameOver"; winner: Seat | null }
  | { type: "activate"; seat: Seat; object: ObjectId; source: ObjectId }
  | { type: "fizzle"; object: ObjectId } // 608.2b: every target illegal
  | { type: "countered"; object: ObjectId }
  | { type: "cantBeCountered"; object: ObjectId }
  | { type: "reveal"; seat: Seat; objects: ObjectId[] }
  | { type: "look"; seat: Seat; objects: ObjectId[] } // seen only by `seat` (views, PR 5)
  | { type: "searched"; seat: Seat; library: Seat; found: number }
  | { type: "damage"; source: ObjectId; to: Ref; amount: number }
  | { type: "lifeGain"; seat: Seat; amount: number }
  | { type: "lifeLoss"; seat: Seat; amount: number }
  | { type: "counters"; object: ObjectId | null; seat?: Seat; kind: string; amount: number } // amount < 0: removed
  | { type: "tokenCreated"; object: ObjectId; name: string }
  | { type: "attached"; object: ObjectId; to: ObjectId | null }
  | { type: "transformed"; object: ObjectId; face: number }
  | { type: "extraTurn"; seat: Seat }
  | { type: "ceased"; object: ObjectId } // a token off the battlefield (704.5d) or an ability leaving the stack
  | { type: "notYet"; block: string; runs: string; object: ObjectId }; // a step this engine version doesn't run yet

export type StepResult = {
  state: GameState;
  events: GameEvent[];
  decision: Decision | null;
  /** Set when the action was refused; `state` is then the same object that came in. */
  error?: string;
};
